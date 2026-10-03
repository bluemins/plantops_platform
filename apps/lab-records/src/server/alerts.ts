// WhatsApp alerts (CLAUDE.md: a failed test alerts the tenant_admin). Every message goes into the
// lab_records.alerts outbox first, then a sender delivers it:
//   * WhatsApp Cloud API when WHATSAPP_TOKEN + WHATSAPP_PHONE_ID + WHATSAPP_TEMPLATE are set (the template is
//     approved by Meta, with one body variable that receives the message text);
//   * otherwise the message is marked "skipped - WhatsApp is not set up yet" (screens show that).
// Who: the plant's owners and lab leads with a mobile number (from the platform, never stored here).
import { and, asc, eq } from "drizzle-orm";
import { fetchAlertContacts } from "@plantops/auth";
import type { RoleId } from "@plantops/types";
import { FORMS } from "@/lib/forms";
import type { HoldNotice } from "./approval";
import { schema, withTenant } from "./db";
import type { EntryView } from "./entries";
import { env } from "./env";
import { branding, creds } from "./platform";

const { alerts } = schema;
const ALERT_ROLES: RoleId[] = ["tenant_admin", "lab_lead"];

export type AlertView = { recipient_name: string; status: "pending" | "sent" | "failed" | "skipped"; error: string | null; message: string; created_at: string };

/** "+91 98765 43210" / "098765 43210" / "9876543210" -> "919876543210" (WhatsApp wants country code, digits only). */
export function whatsappNumber(phone: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** Puts one message per owner / lab lead into the outbox, then tries to deliver straight away. */
export async function queueAlert(tenantId: string, kind: string, batchId: string | null, text: string) {
  const plant = (await branding(tenantId))?.name ?? "your plant";
  const message = `PlantOps · ${plant}: ${text}`;
  const contacts = await fetchAlertContacts(creds(), tenantId).catch(() => null);
  type Row = { recipientName: string; phone: string | null; status: "pending" | "skipped" | "failed"; error: string | null };
  const rows: Row[] = contacts
    ? contacts
        .filter((c) => c.roles.some((r) => ALERT_ROLES.includes(r)))
        .map((c) => {
          const phone = whatsappNumber(c.phone);
          return phone
            ? { recipientName: c.display_name, phone, status: "pending" as const, error: null }
            : { recipientName: c.display_name, phone: null, status: "skipped" as const, error: "No mobile number saved for this person" };
        })
    : [{ recipientName: "Plant owner", phone: null, status: "failed" as const, error: "Couldn't reach PlantOps to look up who to alert" }];
  if (!rows.length) rows.push({ recipientName: "Plant owner", phone: null, status: "skipped", error: "No owner or lab lead to alert" });
  await withTenant(tenantId, (tx) => tx.insert(alerts).values(rows.map((r) => ({ ...r, tenantId, kind, batchId, message }))));
  await deliverPending(tenantId).catch((err) => console.error("[lab-records] alert delivery failed:", (err as Error).message));
}

export const notifyHold = (tenantId: string, hold: HoldNotice) =>
  queueAlert(tenantId, "batch_held", hold.batchId, `Batch ${hold.batchNo} ON HOLD${hold.wasApproved ? " (was approved)" : ""} – ${hold.reason}. Dispatch is blocked until it is released.`);

export const notifyFormFailure = (tenantId: string, entry: EntryView) =>
  queueAlert(tenantId, "form_failed", null, `${FORMS[entry.form].short}: outcome FAIL (${String(entry.current.data.source_of_water ?? entry.current.data.packaging_type ?? "")}). Please check.`);

export const notifyBatchDecision = (tenantId: string, d: { batchId: string; batchNo: string; text: string }) => queueAlert(tenantId, "batch_rejected", d.batchId, d.text);

// ---------- delivery ----------

export type SendResult = { ok: true } | { ok: false; error: string };
export type Sender = { configured: boolean; send: (to: string, message: string) => Promise<SendResult> };

/** The real WhatsApp Cloud API sender, or "not configured". */
export function whatsappSender(): Sender {
  const { whatsappToken: token, whatsappPhoneId: phoneId, whatsappTemplate: template } = env;
  if (!token || !phoneId || !template) return { configured: false, send: async () => ({ ok: false, error: "WhatsApp is not set up yet" }) };
  return {
    configured: true,
    async send(to, message) {
      try {
        const res = await fetch(`${env.whatsappApiUrl}/${phoneId}/messages`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: { name: template, language: { code: env.whatsappLanguage }, components: [{ type: "body", parameters: [{ type: "text", text: message.slice(0, 1000) }] }] },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { ok: true };
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return { ok: false, error: `WhatsApp said ${res.status}: ${body?.error?.message ?? "error"}`.slice(0, 300) };
      } catch (err) {
        return { ok: false, error: `WhatsApp unreachable: ${(err as Error).message}`.slice(0, 300) };
      }
    },
  };
}

/** Sends this plant's waiting messages. Failed ones stay "failed" (shown on screen); not retried endlessly. */
export async function deliverPending(tenantId: string, sender: Sender = whatsappSender()) {
  const waiting = await withTenant(tenantId, (tx) =>
    tx.select().from(alerts).where(and(eq(alerts.tenantId, tenantId), eq(alerts.status, "pending"))).orderBy(asc(alerts.createdAt)).limit(50),
  );
  let sent = 0;
  for (const a of waiting) {
    const r = sender.configured && a.phone ? await sender.send(a.phone, a.message) : ({ ok: false, error: "WhatsApp is not set up yet" } as const);
    const status = r.ok ? "sent" : sender.configured ? "failed" : "skipped";
    if (r.ok) sent++;
    await withTenant(tenantId, (tx) =>
      tx.update(alerts).set({ status, error: r.ok ? null : r.error, sentAt: r.ok ? new Date() : null }).where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, a.id))),
    );
  }
  return { sent, processed: waiting.length };
}

/** Messages about one batch, newest first (batch page). */
export function batchAlerts(tenantId: string, batchId: string): Promise<AlertView[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(alerts).where(and(eq(alerts.tenantId, tenantId), eq(alerts.batchId, batchId))).orderBy(asc(alerts.createdAt));
    return rows.reverse().map((a) => ({ recipient_name: a.recipientName, status: a.status, error: a.error, message: a.message, created_at: a.createdAt.toISOString() }));
  });
}

// WhatsApp thank-you to the customer when an order is marked delivered (owner, 2026-10-14). Sent automatically
// through the owner's Twilio account with the plant's own approved template ({{1}} = the customer's name); the
// customer's reply goes to that Twilio number, outside PlantOps.
//   * Config (environment only): TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_SENDERS = JSON
//     {"<plant id>": {"from": "whatsapp:+91…", "content_sid": "HX…"}}. A plant not listed has no tick box.
//   * deliverOrder writes the 'pending' row in its own transaction (queueThanks); the route sends it after the answer,
//     so a delivery never waits for or fails because of WhatsApp.
//   * Twilio refuses (4xx) → 'failed' with its reason, not retried. Unreachable / 5xx → stays 'pending' and the daily
//     job tries again; given up after MAX_TRIES tries or MAX_AGE (a late thank-you is worse than none).
//   * One thank-you per order ever (unique in the database).
import { and, asc, eq, sql } from "drizzle-orm";
import { orderDb, schema, withTenant, type OcTx } from "./db";
import { env } from "./env";
import type { MessageStatus } from "./schema";

const { customerMessages: messages, orders } = schema;

export const MAX_TRIES = 3;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface Sender {
  from: string;
  contentSid: string;
  /** the plant's approved reorder-reminder template (WhatsApp Step 4); null = no reminders for this plant */
  reminderContentSid?: string | null;
}

/** The plant's Twilio sender, or null (not set up, or the settings are broken: logged, never thrown). */
export function senderFor(tenantId: string): Sender | null {
  if (!env.twilioAccountSid || !env.twilioAuthToken || !env.twilioWhatsappSenders) return null;
  let all: unknown;
  try {
    all = JSON.parse(env.twilioWhatsappSenders);
  } catch {
    console.error("[order-capture] TWILIO_WHATSAPP_SENDERS is not valid JSON; WhatsApp thank-you is off");
    return null;
  }
  const s = (all as Record<string, { from?: unknown; content_sid?: unknown; reminder_content_sid?: unknown }> | null)?.[tenantId];
  if (!s || typeof s.from !== "string" || typeof s.content_sid !== "string") return null;
  if (!/^(whatsapp:\+\d{8,15}|MG[0-9a-f]{32})$/i.test(s.from) || !/^HX[0-9a-f]{32}$/i.test(s.content_sid)) {
    console.error(`[order-capture] TWILIO_WHATSAPP_SENDERS entry for ${tenantId} is invalid; WhatsApp thank-you is off`);
    return null;
  }
  const reminder = typeof s.reminder_content_sid === "string" && /^HX[0-9a-f]{32}$/i.test(s.reminder_content_sid) ? s.reminder_content_sid : null;
  return { from: s.from, contentSid: s.content_sid, reminderContentSid: reminder };
}

/** What the order page shows about this order's thank-you. */
export interface ThanksView {
  /** the plant has a Twilio sender (the "Delivered" panel shows the tick box) */
  available: boolean;
  message: { status: Exclude<MessageStatus, "skipped">; error: string | null; at: string; sent_at: string | null; by: string } | null;
}

export async function thanksOf(tx: OcTx, tenantId: string, orderId: string): Promise<ThanksView> {
  const [m] = await tx.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.orderId, orderId), eq(messages.kind, "delivery_thanks")));
  return {
    available: senderFor(tenantId) !== null,
    message: m ? { status: m.status as Exclude<MessageStatus, "skipped">, error: m.error, at: m.createdAt.toISOString(), sent_at: m.sentAt?.toISOString() ?? null, by: m.requestedByName } : null,
  };
}

/** Inside deliverOrder's transaction: one 'pending' row, unless this order already had its thank-you. */
export async function queueThanks(tx: OcTx, who: { tenantId: string; userId: string; name: string }, orderId: string, phone: string) {
  const rows = await tx
    .insert(messages)
    .values({ tenantId: who.tenantId, orderId, kind: "delivery_thanks", toPhone: phone, requestedBy: who.userId, requestedByName: who.name })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  return rows.length > 0;
}

// ---------- sending ----------
export type SendResult = { ok: true; sid: string } | { ok: false; retry: boolean; error: string };

/** The thank-you: the plant's template with {{1}} = the customer's name. Never throws. */
export const twilioSend = (sender: Sender, phone: string, name: string) => twilioTemplate(sender, phone, { "1": name });

/** One template message through Twilio's Messages API (`sender.contentSid` = the template). Never throws. */
export async function twilioTemplate(sender: Sender, phone: string, variables: Record<string, string>): Promise<SendResult> {
  const body = new URLSearchParams({ To: `whatsapp:+91${phone}`, ContentSid: sender.contentSid, ContentVariables: JSON.stringify(variables) });
  body.set(sender.from.startsWith("MG") ? "MessagingServiceSid" : "From", sender.from);
  try {
    const res = await fetch(`${env.twilioApiUrl}/2010-04-01/Accounts/${encodeURIComponent(env.twilioAccountSid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;
    if (res.ok && json?.sid) return { ok: true, sid: json.sid.slice(0, 64) };
    const why = `Twilio said ${res.status}${json?.code ? ` (${json.code})` : ""}: ${json?.message ?? "error"}`.slice(0, 300);
    return { ok: false, retry: res.status >= 500 || res.status === 429, error: why };
  } catch (err) {
    return { ok: false, retry: true, error: `Twilio unreachable: ${(err as Error).message}`.slice(0, 300) };
  }
}

/**
 * Sends this plant's waiting thank-yous. Each row is locked while it is sent (skip locked), so the route and the daily
 * job never send the same one twice.
 */
export async function sendPending(tenantId: string, send = twilioSend, now = Date.now()) {
  const sender = senderFor(tenantId);
  const waiting = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.kind, "delivery_thanks"), eq(messages.status, "pending")))
      .orderBy(asc(messages.createdAt))
      .limit(50),
  );
  let sent = 0;
  for (const { id } of waiting) {
    await withTenant(tenantId, async (tx) => {
      const [m] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id), eq(messages.kind, "delivery_thanks"), eq(messages.status, "pending")))
        .for("update", { skipLocked: true });
      if (!m) return;
      const [o] = await tx.select({ name: orders.customerName }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, m.orderId)));
      const set = (v: Partial<typeof messages.$inferInsert>) => tx.update(messages).set(v).where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)));
      if (now - m.createdAt.getTime() > MAX_AGE_MS) return set({ status: "failed", error: `Not sent within 24 hours${m.error ? `: ${m.error}` : ""}`.slice(0, 300) });
      if (!sender) return set({ status: "failed", error: "WhatsApp is no longer set up for this plant" });
      const r = await send(sender, m.toPhone, o!.name);
      if (r.ok) {
        sent++;
        return set({ status: "sent", providerSid: r.sid, error: null, attempts: m.attempts + 1, sentAt: new Date() });
      }
      const attempts = m.attempts + 1;
      return set({ status: r.retry && attempts < MAX_TRIES ? "pending" : "failed", error: r.error, attempts });
    });
  }
  return { sent, processed: waiting.length };
}

/** The daily job: every plant with a thank-you still waiting. Never throws. */
export async function retryThanks(now = Date.now()) {
  try {
    const { rows } = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.message_tenants() t`);
    let sent = 0;
    for (const r of rows) sent += (await sendPending(r.id, twilioSend, now).catch(() => ({ sent: 0 }))).sent;
    return { plants: rows.length, sent };
  } catch (err) {
    console.error("[order-capture] WhatsApp thank-you retry failed:", (err as Error).message);
    return { plants: 0, sent: 0 };
  }
}

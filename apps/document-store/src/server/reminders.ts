// The daily job (POST /api/cron/daily): for each plant, find documents in a reminder stage today (30 / 7 / 1
// days before, on expiry, then weekly while expired), queue one reminder per person per stage (owners + the
// responsible person), then send each person ONE email listing all their due documents.
// The unique (version, stage, person) key means a stage is never sent twice; a renewal starts afresh.
// A failed send (provider down, network blocked) is tried again on each run for up to RETRY_DAYS.
import { and, eq, gt, sql } from "drizzle-orm";
import { fmtDate } from "@plantops/module-kit/format";
import { reminderStage, stageText, todayIst } from "@/lib/expiry";
import { docDb, schema, withTenant } from "./db";
import { listDocuments, type DocumentRow } from "./documents";

import { kit } from "./kit";
import { configuredMailer, looksLikeEmail, type Mailer } from "./mail";
import { systemReader } from "./session";

const { reminders } = schema;

const RETRY_DAYS = 7;

type Due = { doc: DocumentRow; stage: string };

/** Queue today's reminders for one plant. Returns how many new reminder rows were written. */
export async function queueReminders(tenantId: string, today = todayIst()) {
  const contacts = await kit.contacts(tenantId);
  if (!contacts) throw new Error("Couldn't reach PlantOps to look up who to remind"); // nothing queued: next run retries
  const docs = await listDocuments(systemReader(tenantId), { filter: "all" });
  const due: Due[] = docs.flatMap((doc) => {
    const stage = reminderStage(doc.current.expires_on, today);
    return stage ? [{ doc, stage }] : [];
  });
  if (!due.length) return 0;
  const owners = contacts.filter((c) => c.roles.includes("tenant_admin"));
  const rows = due.flatMap(({ doc, stage }) => {
    const people = new Map<string, { name: string; email: string | null }>();
    for (const o of owners) people.set(o.user_id, { name: o.display_name, email: o.email ?? null });
    const resp = contacts.find((c) => c.user_id === doc.responsible_user_id);
    people.set(doc.responsible_user_id, resp ? { name: resp.display_name, email: resp.email ?? null } : { name: doc.responsible_name, email: null });
    return [...people].map(([userId, p]) => ({
      tenantId,
      documentId: doc.id,
      versionId: doc.current.id,
      stage,
      recipientUserId: userId,
      recipientName: p.name,
      email: looksLikeEmail(p.email) ? p.email : null,
      status: looksLikeEmail(p.email) ? ("pending" as const) : ("skipped" as const),
      error: looksLikeEmail(p.email) ? null : resp || owners.some((o) => o.user_id === userId) ? "No email saved for this person" : "No longer an active owner / document keeper / plant staff",
    }));
  });
  const inserted = await withTenant(tenantId, (tx) => tx.insert(reminders).values(rows).onConflictDoNothing().returning({ id: reminders.id }));
  return inserted.length;
}

/** Send this plant's waiting reminders: one email per person, listing all their documents. */
export async function deliverReminders(tenantId: string, mailer: Mailer = configuredMailer(), now = new Date()) {
  if (mailer.configured) {
    const retrySince = new Date(now.getTime() - RETRY_DAYS * 86_400_000);
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(reminders)
        .set({ status: "pending", error: null })
        .where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, "skipped"), eq(reminders.error, "Email is not set up yet")));
      // keep the last error on screen until the retry succeeds or fails again
      await tx
        .update(reminders)
        .set({ status: "pending" })
        .where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, "failed"), gt(reminders.createdAt, retrySince)));
    });
  }
  const waiting = await withTenant(tenantId, (tx) => tx.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, "pending"))));
  if (!waiting.length) return { sent: 0 };
  const docs = await listDocuments(systemReader(tenantId), { filter: "all" });
  const plant = (await kit.branding(tenantId))?.name ?? "your plant";
  const link = process.env.MODULE_URL_DOCUMENT_STORE ? `\n\nOpen Document Store: ${process.env.MODULE_URL_DOCUMENT_STORE}` : "";
  const byEmail = new Map<string, typeof waiting>();
  for (const r of waiting) byEmail.set(r.email!, [...(byEmail.get(r.email!) ?? []), r]);
  let sent = 0;
  for (const [email, list] of byEmail) {
    const lines = list.map((r) => {
      const d = docs.find((x) => x.id === r.documentId);
      if (!d) return null;
      const c = d.current;
      return [
        `• ${c.name}${c.certificate_no ? ` (No. ${c.certificate_no})` : ""} – ${d.expiry.text}${c.expires_on ? ` (${fmtDate(c.expires_on)})` : ""}`,
        c.authority ? `  Authority: ${c.authority}` : null,
        c.support_contact ? `  Contact for renewal: ${c.support_contact}` : null,
        `  Responsible: ${d.responsible_name}`,
      ]
        .filter(Boolean)
        .join("\n");
    });
    const subject = `PlantOps · ${plant}: ${list.length} document${list.length === 1 ? "" : "s"} to renew`;
    const text = `Hello ${list[0]!.recipientName},\n\nThese licences / certificates of ${plant} need attention:\n\n${lines.filter(Boolean).join("\n\n")}${link}\n\n– PlantOps (reminders ${list.map((r) => stageText(r.stage)).filter((v, i, a) => a.indexOf(v) === i).join(", ")})`;
    const r = mailer.configured ? await mailer.send(email, subject, text) : ({ ok: false, error: "Email is not set up yet" } as const);
    if (r.ok) sent++;
    const status = r.ok ? "sent" : mailer.configured ? "failed" : "pending";
    await withTenant(tenantId, (tx) =>
      tx
        .update(reminders)
        .set({ status, error: r.ok ? null : r.error, sentAt: r.ok ? new Date() : null })
        .where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, "pending"), eq(reminders.email, email))),
    );
  }
  return { sent };
}

/** The daily job for every plant that uses Document Store. One plant's problem never stops the others. */
export async function runDaily(now = new Date(), mailer: Mailer = configuredMailer()) {
  const { rows } = await docDb().execute<{ id: string }>(sql`select t as id from document_store.doc_tenants() t`);
  let queued = 0;
  let sent = 0;
  for (const { id } of rows) {
    try {
      queued += await queueReminders(id, todayIst(now));
      sent += (await deliverReminders(id, mailer, now)).sent;
    } catch (err) {
      console.error("[document-store] daily job failed for one plant:", (err as Error).message);
    }
  }
  return { plants: rows.length, queued, sent };
}

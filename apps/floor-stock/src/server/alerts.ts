// Low-stock rows for the plant's owners (approved 2026-10-04):
//   * when a count or correction is saved, every item below its limit is recorded for every owner
//   * once per item per day per owner (unique key in the database): a correction only adds newly low items, and
//     those newly low items are what the owner's app notification reports
//   * email is off in PlantOps (owner, 2026-10-11 for Floor Stock, 2026-10-17 everywhere; STABILITY_PLAN B-02):
//     the rows are then recorded as EMAIL_OFF and nothing is emailed
//   * if email is set up again: store keepers are never emailed; an owner without an email address is "skipped";
//     one email per owner listing all their queued items, sent right after the save and again by the daily job;
//     a failed send stays pending (with the error) and is retried by the daily job for RETRY_DAYS, then failed.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { configuredMailer, EMAIL_OFF, emailIsOn, looksLikeEmail, type Mailer } from "@plantops/module-kit/mail";
import type { AlertContact } from "@plantops/types";
import { fmtDate } from "@plantops/module-kit/format";
import { isLow, qty, sum } from "@/lib/compare";
import { schema, stockDb, withTenant, type StockTx } from "./db";
import { kit } from "./kit";

const { auditLog, countLines, items, lowStockAlerts } = schema;
export const RETRY_DAYS = 7;

/** Owners only (the platform also lists store keepers for this module). */
export const ownersOf = (contacts: AlertContact[]) => contacts.filter((c) => c.roles.includes("tenant_admin"));

/** An item that went below its limit with this count (for the owner's notification). */
export interface LowItem {
  name: string;
  qty: number;
  min: number;
}

/**
 * Inside the count's transaction: the items of this version below their limit, and a row for each of them for each
 * owner (rows already there for that item, day and owner are left alone). Returns how many new rows were added, the
 * items that are NEWLY low (which the app notification reports) and their ids (kept in the count's audit entry).
 *
 * "Newly low" doesn't depend on the owner list (STABILITY_PLAN B-10): when the platform can't be reached at the save,
 * there are no owners and no rows, yet the notification (which then waits in the outbox) must still say "Low stock".
 * An item counts as already reported that day when a row exists for it, or when an earlier save that day listed it
 * in its audit entry (`details.low`), so a correction never repeats it. Each save is judged with the limit of its
 * time, as before.
 */
export async function queueLowStock(tx: StockTx, tenantId: string, date: string, versionId: string, owners: AlertContact[], emailOn = emailIsOn()): Promise<{ rows: number; items: LowItem[]; ids: string[] }> {
  const lines = await tx.select({ itemId: countLines.itemId, name: countLines.itemName, qty: countLines.qty }).from(countLines).where(and(eq(countLines.versionId, versionId), eq(countLines.kind, "stock")));
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (!ids.length) return { rows: 0, items: [], ids: [] };
  const limits = await tx.select({ id: items.id, min: items.minLevel }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)));
  const low: { itemId: string; name: string; closing: number; min: string }[] = [];
  for (const it of limits) {
    if (it.min === null) continue;
    const mine = lines.filter((l) => l.itemId === it.id);
    const closing = sum(mine.map((l) => Number(l.qty)));
    if (isLow(closing, Number(it.min))) low.push({ itemId: it.id, name: mine[0]!.name, closing, min: it.min });
  }
  if (!low.length) return { rows: 0, items: [], ids: [] };

  const lowIds = low.map((c) => c.itemId);
  const reported = new Set<string>();
  const queued = await tx
    .selectDistinct({ itemId: lowStockAlerts.itemId })
    .from(lowStockAlerts)
    .where(and(eq(lowStockAlerts.tenantId, tenantId), eq(lowStockAlerts.countDate, date), inArray(lowStockAlerts.itemId, lowIds)));
  for (const q of queued) reported.add(q.itemId);
  const saves = await tx
    .select({ low: sql<string[] | null>`${auditLog.details} -> 'low'` })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.target, date), inArray(auditLog.action, ["count.submit", "count.correct"])));
  for (const s of saves) for (const id of Array.isArray(s.low) ? s.low : []) reported.add(id);
  const newly = low.filter((c) => !reported.has(c.itemId));

  const rows: (typeof lowStockAlerts.$inferInsert)[] = [];
  for (const c of low) {
    for (const o of owners) {
      const ok = emailOn && looksLikeEmail(o.email);
      rows.push({
        tenantId,
        countDate: date,
        itemId: c.itemId,
        itemName: c.name,
        qty: String(c.closing),
        minLevel: c.min,
        recipientUserId: o.user_id,
        recipientName: o.display_name,
        email: ok ? o.email : null,
        status: ok ? "pending" : "skipped",
        error: ok ? null : emailOn ? "No email address in PlantOps" : EMAIL_OFF,
      });
    }
  }
  const added = rows.length ? await tx.insert(lowStockAlerts).values(rows).onConflictDoNothing().returning({ id: lowStockAlerts.id }) : [];
  return { rows: added.length, items: newly.map((c) => ({ name: c.name, qty: c.closing, min: Number(c.min) })), ids: newly.map((c) => c.itemId) };
}

/** The email for one owner: every queued item, grouped by day. */
export function lowStockEmail(plant: string, alerts: { countDate: string; itemName: string; qty: string; minLevel: string }[], link: string | null) {
  const days = [...new Set(alerts.map((a) => a.countDate))].sort();
  const subject = `Low stock at ${plant}: ${alerts.length} item${alerts.length === 1 ? "" : "s"} below the limit`;
  const body = [
    `These items were counted below their limit at ${plant}:`,
    ...days.flatMap((d) => ["", `Count of ${fmtDate(d)}:`, ...alerts.filter((a) => a.countDate === d).map((a) => `- ${a.itemName}: ${qty(Number(a.qty))} (limit ${qty(Number(a.minLevel))})`)]),
    "",
    link ? `Open Floor Stock: ${link}` : "Open Floor Stock in PlantOps to see the full count.",
    "",
    "You get this email once per item per day. Limits are set by the plant owner in Floor Stock > Sections & items.",
  ];
  return { subject, text: body.join("\n") };
}

/** Sends every pending alert of one plant: one email per owner. Returns what happened. Nothing without email. */
export async function sendPending(tenantId: string, mailer: Mailer = configuredMailer(), now = new Date()) {
  const result = { sent: 0, waiting: 0, failed: 0 };
  if (!mailer.configured) return result;
  const pending = await withTenant(tenantId, (tx) =>
    tx.select().from(lowStockAlerts).where(and(eq(lowStockAlerts.tenantId, tenantId), eq(lowStockAlerts.status, "pending"))).orderBy(asc(lowStockAlerts.countDate), asc(lowStockAlerts.createdAt)),
  );
  if (!pending.length) return result;
  const plant = (await kit.branding(tenantId))?.name ?? "your plant";
  const base = process.env.MODULE_URL_FLOOR_STOCK;
  const byEmail = new Map<string, typeof pending>();
  for (const a of pending) byEmail.set(a.email!, [...(byEmail.get(a.email!) ?? []), a]);

  for (const [email, alerts] of byEmail) {
    const latest = alerts.at(-1)!.countDate;
    const mail = lowStockEmail(plant, alerts, base ? new URL(`/day/${latest}`, base).toString() : null);
    const r = await mailer.send(email, mail.subject, mail.text);
    const ids = alerts.map((a) => a.id);
    // give up on a send that has failed for RETRY_DAYS (by the alert's own age)
    const tooOld = alerts.every((a) => now.getTime() - a.createdAt.getTime() > RETRY_DAYS * 86_400_000);
    const status = r.ok ? "sent" : tooOld ? "failed" : "pending";
    await withTenant(tenantId, (tx) =>
      tx
        .update(lowStockAlerts)
        .set({ status, error: r.ok ? null : r.error, sentAt: r.ok ? now : null })
        .where(inArray(lowStockAlerts.id, ids)),
    );
    if (r.ok) result.sent += alerts.length;
    else if (status === "failed") result.failed += alerts.length;
    else result.waiting += alerts.length;
  }
  return result;
}

/** The daily job: every plant with emails still waiting (ids only, through stock_tenants()). */
export async function runDaily(mailer: Mailer = configuredMailer()) {
  const outbox = await kit.retryOutbox(); // notifications that couldn't reach PlantOps earlier (N4)
  const { rows } = await stockDb().execute<{ id: string }>(sql`select floor_stock.stock_tenants() as id`);
  const total = { plants: rows.length, sent: 0, waiting: 0, failed: 0, errors: 0, outbox };
  for (const { id } of rows) {
    try {
      const r = await sendPending(id, mailer);
      total.sent += r.sent;
      total.waiting += r.waiting;
      total.failed += r.failed;
    } catch (err) {
      total.errors++;
      console.error("[floor-stock] daily job failed for one plant:", (err as Error).message);
    }
  }
  return total;
}

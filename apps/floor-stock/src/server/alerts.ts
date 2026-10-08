// Low-stock email to the plant's owners (approved 2026-10-04):
//   * when a count or correction is saved, every item below its limit is queued for every owner
//   * once per item per day per owner (unique key in the database): a correction only adds newly low items
//   * store keepers are never emailed; an owner without an email address is recorded as "skipped"
//   * one email per owner listing all their queued items; sent right after the save and again by the daily job
//   * email not set up yet: stays pending until it is. A failed send stays pending (with the error) and is retried
//     by the daily job for RETRY_DAYS, then marked failed.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { configuredMailer, looksLikeEmail, type Mailer } from "@plantops/module-kit/mail";
import type { AlertContact } from "@plantops/types";
import { fmtDate } from "@plantops/module-kit/format";
import { isLow, qty, sum } from "@/lib/compare";
import { schema, stockDb, withTenant, type StockTx } from "./db";
import { kit } from "./kit";

const { countLines, items, lowStockAlerts } = schema;
export const RETRY_DAYS = 7;

/** Owners only (the platform also lists store keepers for this module). */
export const ownersOf = (contacts: AlertContact[]) => contacts.filter((c) => c.roles.includes("tenant_admin"));

/**
 * Inside the count's transaction: queue an alert for each item of this version below its limit, for each owner.
 * Rows already queued for that item, day and owner are left alone. Returns how many new rows were added.
 */
export async function queueLowStock(tx: StockTx, tenantId: string, date: string, versionId: string, owners: AlertContact[]) {
  const lines = await tx.select({ itemId: countLines.itemId, name: countLines.itemName, qty: countLines.qty }).from(countLines).where(and(eq(countLines.versionId, versionId), eq(countLines.kind, "stock")));
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (!ids.length || !owners.length) return 0;
  const limits = await tx.select({ id: items.id, min: items.minLevel }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)));
  const rows: (typeof lowStockAlerts.$inferInsert)[] = [];
  for (const it of limits) {
    if (it.min === null) continue;
    const mine = lines.filter((l) => l.itemId === it.id);
    const closing = sum(mine.map((l) => Number(l.qty)));
    if (!isLow(closing, Number(it.min))) continue;
    for (const o of owners) {
      const ok = looksLikeEmail(o.email);
      rows.push({
        tenantId,
        countDate: date,
        itemId: it.id,
        itemName: mine[0]!.name,
        qty: String(closing),
        minLevel: it.min,
        recipientUserId: o.user_id,
        recipientName: o.display_name,
        email: ok ? o.email : null,
        status: ok ? "pending" : "skipped",
        error: ok ? null : "No email address in PlantOps",
      });
    }
  }
  if (!rows.length) return 0;
  const added = await tx.insert(lowStockAlerts).values(rows).onConflictDoNothing().returning({ id: lowStockAlerts.id });
  return added.length;
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

/** Sends every pending alert of one plant: one email per owner. Returns what happened. */
export async function sendPending(tenantId: string, mailer: Mailer = configuredMailer(), now = new Date()) {
  const result = { sent: 0, waiting: 0, failed: 0 };
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
    const status = r.ok ? "sent" : mailer.configured && tooOld ? "failed" : "pending";
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
  const { rows } = await stockDb().execute<{ id: string }>(sql`select floor_stock.stock_tenants() as id`);
  const total = { plants: rows.length, sent: 0, waiting: 0, failed: 0, errors: 0 };
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

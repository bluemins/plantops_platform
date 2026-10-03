// The daily job (morning, triggered by POST /api/cron/daily): for each plant, one WhatsApp reminder to the
// owners and lab leads listing batches on hold for more than 24 hours, and - from the 25th - that the monthly
// Form 1 test hasn't been recorded yet. At most one reminder per plant per day. Also retries waiting alerts.
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { fmtAge } from "@/lib/format";
import { deliverPending, queueAlert } from "./alerts";
import { labDb, schema, withTenant, type LabTx } from "./db";

const { alerts, batches, entries, entryVersions } = schema;

const istParts = (d: Date) => {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d).split("-").map(Number);
  return { y: y!, m: m!, day: day! };
};

/** True if no Form 1 record is dated in this calendar month (India time). */
export async function form1Due(tx: LabTx, tenantId: string, now = new Date()) {
  const { y, m } = istParts(now);
  const start = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .innerJoin(entryVersions, and(eq(entryVersions.entryId, entries.id), eq(entryVersions.version, 1)))
    .where(and(eq(entries.tenantId, tenantId), eq(entries.form, "form1"), sql`${entryVersions.testedAt} >= ${start}`));
  return (row?.n ?? 0) === 0;
}

/** The reminder text for one plant today, or null if there is nothing to remind about / already reminded. */
export async function reminderFor(tenantId: string, now = new Date()) {
  return withTenant(tenantId, async (tx) => {
    const [already] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.tenantId, tenantId),
          eq(alerts.kind, "daily_reminder"),
          sql`(${alerts.createdAt} at time zone 'Asia/Kolkata')::date = (${now}::timestamptz at time zone 'Asia/Kolkata')::date`,
        ),
      )
      .limit(1);
    if (already) return null;
    const held = await tx
      .select({ no: batches.batchNo, since: batches.heldSince })
      .from(batches)
      .where(and(eq(batches.tenantId, tenantId), eq(batches.status, "on_hold"), lt(batches.heldSince, new Date(now.getTime() - 24 * 3_600_000))))
      .orderBy(asc(batches.heldSince));
    const lines: string[] = [];
    if (held.length) {
      lines.push(`${held.length} batch${held.length === 1 ? "" : "es"} on hold for more than a day: ${held.map((b) => `${b.no} (${fmtAge(b.since!.toISOString(), now.getTime())})`).join(", ")}.`);
    }
    if (istParts(now).day >= 25 && (await form1Due(tx, tenantId, now))) lines.push("Form 1 (monthly testing) is not recorded yet this month.");
    return lines.length ? `Daily reminder – ${lines.join(" ")}` : null;
  });
}

/** Runs the daily job for every plant that uses Lab Records. */
export async function runDaily(now = new Date()) {
  const { rows } = await labDb().execute<{ id: string }>(sql`select t as id from lab_records.lab_tenants() t`);
  let reminders = 0;
  let sent = 0;
  for (const { id } of rows) {
    try {
      const text = await reminderFor(id, now);
      if (text) {
        await queueAlert(id, "daily_reminder", null, text);
        reminders++;
      }
      sent += (await deliverPending(id)).sent;
    } catch (err) {
      console.error(`[lab-records] daily job failed for one plant:`, (err as Error).message); // one plant never stops the others
    }
  }
  return { plants: rows.length, reminders, sent };
}

/** For screens: is this month's Form 1 still missing? */
export const form1DueFor = (tenantId: string) => withTenant(tenantId, (tx) => form1Due(tx, tenantId));

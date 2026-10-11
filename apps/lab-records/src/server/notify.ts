// App notifications from Lab Records (docs/notifications.md N2). The platform picks the people: the plant's owners
// (always) + people the owner ticked for Lab Records (+ also_user_ids, e.g. the technicians of an approved batch),
// minus whoever did it. These functions only write the texts. The WhatsApp outbox (alerts.ts) is unchanged and runs
// alongside. Sending never throws and never blocks a save (kit.notify logs failures).
import { and, eq, sql } from "drizzle-orm";
import type { NotificationInput } from "@plantops/types";
import { FORMS } from "@/lib/forms";
import type { HoldNotice } from "./approval";
import { labDb, schema, withTenant, type LabTx } from "./db";
import type { EntryView } from "./entries";
import { kit } from "./kit";
import type { LabUser } from "./session";

const { batchEvents, entries } = schema;
const BODY_MAX = 300;
const clip = (s: string) => (s.length <= BODY_MAX ? s : `${s.slice(0, BODY_MAX - 1)}…`);
const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const istDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
const istHour = (at: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(at));
/** "No lab tests entered today" goes out from this hour (India time); later evening runs add nothing (dedupe). */
export const NO_TESTS_HOUR = 20;

/** Sends one notification; never throws (a notification must never break the action that caused it). */
export const send = (tenantId: string, input: NotificationInput) => kit.notify(tenantId, input);

/** A failing test put the batch ON HOLD (urgent). */
export function holdNotification(user: LabUser, hold: HoldNotice, entryId: string): NotificationInput {
  return {
    kind: "lab_records.batch_held",
    title: `Batch ${hold.batchNo} ON HOLD`,
    body: clip(`${hold.reason}.${hold.wasApproved ? " It was already approved." : ""} Dispatch is blocked until it is released. Entered by ${user.name}.`),
    link: `/batches/${hold.batchId}`,
    level: "push",
    dedupe_key: `held:${hold.batchId}:${entryId}`,
    exclude_user_id: user.userId,
  };
}

/** Form 3 (source water) or Form 4 (plastic containers) recorded as FAIL. */
export function formFailNotification(user: LabUser, entry: EntryView): NotificationInput {
  const what = String(entry.current.data.source_of_water ?? entry.current.data.packaging_type ?? "").trim();
  return {
    kind: "lab_records.form_failed",
    title: `${FORMS[entry.form].short}: FAIL`,
    body: clip(`${what ? `${what}. ` : ""}Recorded by ${user.name}. Please check.`),
    link: `/entries/${entry.id}`,
    level: "push",
    dedupe_key: `formfail:${entry.id}:v${entry.current.version}`,
    exclude_user_id: user.userId,
  };
}

/** A pending batch with at least one test and nothing failing: it can be approved. `round` = holds released so far. */
export function readyNotification(user: LabUser, batch: { id: string; batchNo: string }, tests: number, round: number): NotificationInput {
  return {
    kind: "lab_records.batch_ready",
    title: `Batch ${batch.batchNo} ready for approval`,
    body: `${tests} test${tests === 1 ? "" : "s"} on record, nothing failing. Approve it in Lab Records.`,
    link: `/batches/${batch.id}`,
    level: "push",
    dedupe_key: `ready:${batch.id}:${round}`,
    exclude_user_id: user.userId,
  };
}

/** Approved or rejected: also to the technicians who tested that batch (even if not ticked). */
export function decisionNotification(
  user: LabUser,
  batch: { id: string; batchNo: string },
  decision: "approved" | "rejected",
  technicians: string[],
  reason?: string,
): NotificationInput {
  return {
    kind: `lab_records.batch_${decision}`,
    title: `Batch ${batch.batchNo} ${decision}`,
    body: clip(decision === "approved" ? `Approved by ${user.name}.` : `Rejected by ${user.name}: ${reason ?? ""}`),
    link: `/batches/${batch.id}`,
    level: "push",
    dedupe_key: `decision:${batch.id}`,
    exclude_user_id: user.userId,
    also_user_ids: technicians.filter((t) => t !== user.userId).slice(0, 20),
  };
}

/** A result was corrected (new version with a reason). Bell only: usually a typing fix. */
export function correctionNotification(user: LabUser, entry: EntryView): NotificationInput {
  const on = entry.batch_no ? ` on batch ${entry.batch_no}` : "";
  return {
    kind: "lab_records.entry_corrected",
    title: `Result corrected (v${entry.current.version})`,
    body: clip(`${FORMS[entry.form].short}${on}, by ${user.name}: ${entry.current.reason ?? ""}`),
    link: `/entries/${entry.id}`,
    level: "bell",
    dedupe_key: `corrected:${entry.id}:v${entry.current.version}`,
    exclude_user_id: user.userId,
  };
}

/** The morning reminder (holds older than a day, Form 1 due), the same text as the WhatsApp reminder. */
export function dailyNotification(text: string, now: Date): NotificationInput {
  return {
    kind: "lab_records.daily_reminder",
    title: "Lab Records reminder",
    body: clip(text.replace(/^Daily reminder – /, "")),
    link: "/",
    level: "push",
    dedupe_key: `daily:${istDay(now)}`,
  };
}

/** 8 pm: no daily test recorded today. */
export function noTestsNotification(plant: string, date: string): NotificationInput {
  return {
    kind: "lab_records.no_tests_today",
    title: "No lab tests entered today",
    body: `${plant}: no daily test has been recorded for ${shortDate(date)}.`,
    link: "/tests/new",
    level: "push",
    dedupe_key: `notests:${date}`,
  };
}

// ---------- helpers used inside the actions' transactions ----------

/** Everyone who entered a test on this batch (for "approved / rejected"). */
export async function batchTechnicians(tx: LabTx, tenantId: string, batchId: string) {
  const rows = await tx.selectDistinct({ id: entries.createdBy }).from(entries).where(and(eq(entries.tenantId, tenantId), eq(entries.batchId, batchId)));
  return rows.map((r) => r.id);
}

/** How many times this batch's hold was released (each release starts a new "ready" round). */
export async function releaseRound(tx: LabTx, tenantId: string, batchId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(batchEvents)
    .where(and(eq(batchEvents.tenantId, tenantId), eq(batchEvents.batchId, batchId), eq(batchEvents.event, "released")));
  return row?.n ?? 0;
}

/** Daily tests recorded today (India date) in one plant. */
async function testsToday(tenantId: string, now: Date) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(entries)
      .where(
        and(
          eq(entries.tenantId, tenantId),
          eq(entries.form, "daily"),
          sql`(${entries.createdAt} at time zone 'Asia/Kolkata')::date = (${now}::timestamptz at time zone 'Asia/Kolkata')::date`,
        ),
      );
    return row?.n ?? 0;
  });
}

/**
 * The 8 pm job: every plant using Lab Records with no daily test today gets one reminder (the dedupe key makes a
 * second run harmless). A plant that has switched Lab Records off is skipped quietly.
 */
export async function runEvening(now = new Date(), notify = send) {
  const outbox = await kit.retryOutbox(); // the evening job runs hourly, so a short outage is caught up soon (N4)
  // The job runs every hour from 5 pm (Floor Stock's reminder hours); "no tests today" stays at 8 pm India time.
  if (istHour(now) < NO_TESTS_HOUR) return { plants: 0, reminded: 0, tested: 0, skipped: 0, errors: 0, outbox, waiting_until: `${NO_TESTS_HOUR}:00` };
  const { rows } = await labDb().execute<{ id: string }>(sql`select t as id from lab_records.lab_tenants() t`);
  const total = { plants: rows.length, reminded: 0, tested: 0, skipped: 0, errors: 0, outbox };
  const date = istDay(now);
  for (const { id } of rows) {
    try {
      const plan = await kit.plan(id);
      if (plan && !plan.enabled_modules.includes("lab_records")) {
        total.skipped++;
        continue;
      }
      if ((await testsToday(id, now)) > 0) {
        total.tested++;
        continue;
      }
      const plant = (await kit.branding(id))?.name ?? "Your plant";
      if (await notify(id, noTestsNotification(plant, date))) total.reminded++;
      else total.errors++;
    } catch (err) {
      total.errors++;
      console.error("[lab-records] evening job failed for one plant:", (err as Error).message);
    }
  }
  return total;
}

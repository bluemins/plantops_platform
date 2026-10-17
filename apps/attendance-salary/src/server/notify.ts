// Attendance's app notifications (docs/ATTENDANCE_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people:
// Attendance is an owner-only module (OWNER_ONLY_ALERTS), so ticks are ignored and only owners get alerts about
// others; "corrected" goes to the worker it is about and nobody else. These functions only write the text. None is
// urgent. Never a phone number or a location: "outside" says only the distance.
//   1 corrected (phone + bell): the worker only  ·  2 outside (bell): owners, once per person per day
//   3 no exit (bell): owners, once per plant per day, from the morning job
import { eq, sql } from "drizzle-orm";
import { fmtDateTime } from "@plantops/module-kit/format";
import type { NotificationInput } from "@plantops/types";
import { isEmployee } from "@plantops/types";
import { addDays, fmtMonth, istDay, monthDays } from "@/lib/days";
import { settingFor } from "@/lib/salary";
import { fmtDistance } from "@/lib/geo";
import { fmtTime } from "@/lib/punch";
import { workDays } from "@/lib/sessions";
import { loadClaims } from "./claims";
import { attendDb, schema, withTenant } from "./db";
import { kit } from "./kit";
import { loadMarks } from "./people";
import { readSettings } from "./settings";
import { boardFor } from "./today";
import type { AtUser } from "./session";

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const title = (s: string) => clip(s, 80);
const body = (s: string) => clip(s.replace(/\s+/g, " ").trim(), 300);
/** "14 Oct" */
const shortDay = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/** 1. The owner added or cancelled a mark: to that worker only (never to whoever made the fix). */
export function correctedNotification(fixer: AtUser, workerId: string, date: string, what: string, refId: string): NotificationInput {
  return {
    kind: "attendance_salary.corrected",
    title: title(`Your attendance on ${shortDay(date)} was changed`),
    body: body(what),
    link: `/day/${date}`,
    level: "push",
    dedupe_key: `corrected:${refId}`,
    also_user_ids: [workerId],
    only_listed: true,
    exclude_user_id: fixer.userId,
  };
}

/** "08:02": the time as the supervisors' bell shows it (mock-up 6). */
const hhmm = (at: Date) => fmtTime(at).padStart(5, "0");

/**
 * 11. Any saved IN / OUT, from a scan or "Mark for someone" (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Notifications" #11):
 * bell only, to every active supervisor of the plant and nobody else (never owners), minus whoever marked and the
 * person marked. Sent after the answer; never for a refused scan. Nothing when the plant has no supervisor.
 */
export async function sendScanAlert(tenantId: string, mark: { id: string; kind: "in" | "out"; at: Date; personId: string; personName: string }, marker: AtUser, desk: boolean) {
  const contacts = await kit.contacts(tenantId);
  const supervisors = (contacts ?? []).filter((c) => c.roles.includes("supervisor") && c.user_id !== marker.userId && c.user_id !== mark.personId).map((c) => c.user_id);
  if (!supervisors.length) return;
  await kit.notify(tenantId, {
    kind: "attendance_salary.scan",
    title: title(`${mark.personName} ${mark.kind.toUpperCase()} ${hhmm(mark.at)}`),
    body: desk ? body(`by ${marker.name}`) : "",
    link: "/",
    level: "bell",
    dedupe_key: `scan:${mark.id}`,
    also_user_ids: supervisors,
    only_listed: true,
    exclude_user_id: marker.userId,
  });
}

/**
 * 12. People not marked by the plant's alert hour (#12): phone + bell to the owners and every supervisor, once per plant
 * per day, only when someone is missing. The names are exactly the Today board's "Not marked" list.
 */
export function notMarkedNotification(date: string, hour: number, names: string[], supervisors: string[]): NotificationInput {
  const n = names.length;
  const shown = names.slice(0, 5).join(", ") + (n > 5 ? ` +${n - 5}` : "");
  return {
    kind: "attendance_salary.not_marked",
    title: title(`${n} ${n === 1 ? "person" : "people"} not marked by ${String(hour).padStart(2, "0")}:00`),
    body: body(shown),
    link: "/",
    level: "push",
    dedupe_key: `notmarked:${date}`,
    ...(supervisors.length ? { also_user_ids: supervisors } : {}),
  };
}

/**
 * 10. Office staff added or cancelled a mark (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Notifications" #10): to the owners,
 * bell only. Never for the owner's own fixes (the caller checks that). "Mark for someone" sends nothing.
 */
export function deskFixNotification(office: AtUser, person: { userId: string; name: string }, date: string, what: string, refId: string): NotificationInput {
  return {
    kind: "attendance_salary.desk_fix",
    title: title(`${office.name} changed ${person.name}'s attendance`),
    body: body(`${shortDay(date)}: ${what}`),
    link: `/staff/${person.userId}/${date}`,
    level: "bell",
    dedupe_key: `deskfix:${refId}`,
    exclude_user_id: office.userId,
  };
}

/**
 * 9. Office staff gave an advance (#9): to the owners, phone + bell, so cash given from the office reaches them at
 * once. Never for the owner's own entries.
 */
export function advanceGivenNotification(office: AtUser, person: { userId: string; name: string }, advance: { id: string; onDate: string; amountPaise: number; note: string | null }): NotificationInput {
  return {
    kind: "attendance_salary.advance_given",
    title: title(`Advance ${amountText(advance.amountPaise)} to ${person.name}`),
    body: body(`Given by ${office.name}${advance.note ? ` · ${advance.note}` : ""}`),
    link: `/staff/${person.userId}?m=${advance.onDate.slice(0, 7)}`,
    level: "push",
    dedupe_key: `advance:${advance.id}`,
    exclude_user_id: office.userId,
  };
}

/**
 * 5. A month ticked Paid (docs/SALARY_PHASE_PLAN.md "Notifications" #5): to the worker only, and only when the owner
 * ticked "Can see own salary" for them (the caller checks that). No amount in the text.
 */
export function salaryPaidNotification(payer: AtUser, workerId: string, month: string, paymentId: string): NotificationInput {
  const name = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return {
    kind: "attendance_salary.salary_paid",
    title: title(`Your ${name} salary is paid`),
    body: "Tap to see how it was worked out",
    link: `/my/salary/${month}`,
    level: "push",
    dedupe_key: `paid:${paymentId}`,
    also_user_ids: [workerId],
    only_listed: true,
    exclude_user_id: payer.userId,
  };
}

// ---------- claims (docs/SALARY_EXTRAS_PHASE_PLAN.md "Notifications" #6-#8) ----------

/** "₹450", "₹1,200.50": the amount as typed. */
const amountText = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * 6. A worker sent a claim: to the owners (the platform picks them; Attendance is owner-only). Never for an owner's own
 * entries. The worker typed the amount / km themselves, so they are in the text; no TA / DA rupees.
 */
export function claimNewNotification(worker: AtUser, claim: { id: string; kind: "field_duty" | "expense"; onDate: string; kmTenths: number | null; wantsDa?: boolean | null; amountPaise: number | null; note: string }): NotificationInput {
  return {
    kind: "attendance_salary.claim_new",
    title: title(
      claim.kind === "expense"
        ? `Expense from ${worker.name}: ${amountText(claim.amountPaise ?? 0)}`
        : `Field duty from ${worker.name}: ${shortDay(claim.onDate)}, ${(claim.kmTenths ?? 0) / 10} km${claim.wantsDa === false ? ", no DA" : ""}`,
    ),
    body: body(claim.note),
    link: "/claims?status=waiting",
    level: "push",
    dedupe_key: `claim:${claim.id}`,
    exclude_user_id: worker.userId,
  };
}

/**
 * 7. The owner approved, did not approve or cancelled a worker's claim: to that worker only. "Your expense on 18 Oct
 * was approved"; the amount / km in the body is what they typed themselves; never TA / DA rupees.
 */
export function claimDecidedNotification(
  decider: AtUser,
  claim: { userId: string; kind: "field_duty" | "expense"; onDate: string; kmTenths: number | null; amountPaise: number | null; note: string },
  decision: "approved" | "rejected" | "cancelled",
  reason: string | null,
  decisionId: string,
): NotificationInput {
  const what = claim.kind === "expense" ? "expense" : "field duty";
  const done = decision === "approved" ? "was approved" : decision === "rejected" ? `was not approved: ${reason}` : `was cancelled: ${reason}`;
  const value = claim.kind === "expense" ? amountText(claim.amountPaise ?? 0) : `${(claim.kmTenths ?? 0) / 10} km`;
  return {
    kind: "attendance_salary.claim_decided",
    title: title(`Your ${what} on ${shortDay(claim.onDate)} ${done}`),
    body: body(`${value} · ${claim.note}`),
    link: `/my/claims?m=${claim.onDate.slice(0, 7)}`,
    level: "push",
    dedupe_key: `decision:${decisionId}`,
    also_user_ids: [claim.userId],
    only_listed: true,
    exclude_user_id: decider.userId,
  };
}

/** 8. Bill photos passed 80 % / 95 % of the plan's Attendance storage: to the owners, once per step and plan size. */
export const STORAGE_STEPS = [80, 95] as const;

/** The threshold (80 / 95 %) this upload crossed, or null. */
export function storageStepCrossed(beforeBytes: number, afterBytes: number, limitBytes: number): (typeof STORAGE_STEPS)[number] | null {
  for (const step of [...STORAGE_STEPS].reverse()) {
    const at = (limitBytes * step) / 100;
    if (beforeBytes < at && afterBytes >= at) return step;
  }
  return null;
}

export function storageNotification(step: number, usedBytes: number, limitBytes: number): NotificationInput {
  const mb = (b: number) => Math.round(b / (1024 * 1024));
  return {
    kind: "attendance_salary.storage",
    title: title(`Attendance storage ${step} % full`),
    body: body(`Bill photos use ${mb(usedBytes)} MB of the plan's ${mb(limitBytes)} MB. Ask PlantOps to extend the plan before it is full.`),
    link: "/claims",
    level: "push",
    dedupe_key: `storage:${step}:${mb(limitBytes)}`,
  };
}

/** 2. A mark refused for distance: to the owners, once per person per day. Only the distance, never where. */
export function outsideNotification(worker: AtUser, kind: "in" | "out", distanceM: number, at: Date = new Date()): NotificationInput {
  const date = istDay(at);
  return {
    kind: "attendance_salary.outside",
    title: title(`${worker.name} tried to mark ${kind.toUpperCase()} from ${fmtDistance(distanceM)} away`),
    body: body(fmtDateTime(at.toISOString())),
    link: `/staff/${worker.userId}/${date}`,
    level: "bell",
    dedupe_key: `outside:${worker.userId}:${date}`,
    exclude_user_id: worker.userId,
  };
}

/** 3. People who didn't mark OUT yesterday: to the owners, once per plant per day. */
export function noExitNotification(date: string, names: string[]): NotificationInput {
  const n = names.length;
  return {
    kind: "attendance_salary.no_exit",
    title: title(`${n} ${n === 1 ? "person" : "people"} didn't mark OUT on ${shortDay(date)}`),
    body: body(names.join(", ")),
    link: `/?day=${date}`,
    level: "bell",
    dedupe_key: `no_exit:${date}`,
  };
}

/** Yesterday's "no exit" people of one plant (an IN under 16 hours old is still inside, so not counted). */
export async function noExitYesterday(tenantId: string, now: Date = new Date()) {
  const yesterday = addDays(istDay(now), -1);
  const loaded = await withTenant(tenantId, (tx) => loadMarks(tx, tenantId, yesterday, yesterday));
  const names: string[] = [];
  for (const l of loaded.values()) {
    if (workDays(l.marks, l.cancels, now).get(yesterday)?.blocks.some((b) => b.status === "no_exit")) names.push(l.name);
  }
  return { date: yesterday, names: names.sort((a, b) => a.localeCompare(b)) };
}

/**
 * 4. Month-end salary review (docs/SALARY_PHASE_PLAN.md "Notifications" #4): to the owners, on the month's last day,
 * once per plant per month. Says what is left to fix; never an amount.
 */
export function salaryReviewNotification(month: string, noExitDays: number, noSalary: number | null, claimsWaiting = 0): NotificationInput {
  const parts: string[] = [];
  if (noExitDays > 0) parts.push(`${noExitDays} ${noExitDays === 1 ? "day" : "days"} with no exit to fix`);
  if (noSalary) parts.push(`${noSalary} ${noSalary === 1 ? "person" : "people"} without salary`);
  if (claimsWaiting) parts.push(`${claimsWaiting} ${claimsWaiting === 1 ? "claim" : "claims"} waiting`); // docs/SALARY_EXTRAS_PHASE_PLAN.md
  return {
    kind: "attendance_salary.salary_review",
    title: title(`${fmtMonth(month).split(" ")[0]} salary review today`),
    body: body(parts.length ? parts.join(" · ") : "All set: check the figures and mark them paid"),
    link: `/salary?month=${month}`,
    level: "push",
    dedupe_key: `salary_review:${month}`,
  };
}

/**
 * The review's counts for one plant: days this month (up to yesterday) on which someone on salary has a "no exit",
 * and active Plant staff with no salary setting for the month (null when the platform can't be reached).
 */
export async function salaryReview(tenantId: string, now: Date = new Date()) {
  const today = istDay(now);
  const month = today.slice(0, 7);
  const dates = monthDays(month);
  const { settings, loaded, claims } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(schema.salarySettings).where(eq(schema.salarySettings.tenantId, tenantId));
    return {
      settings: rows.map((r) => ({ ...r, fromMonth: r.fromMonth.slice(0, 7) })),
      loaded: await loadMarks(tx, tenantId, dates[0]!, dates.at(-1)!),
      claims: await loadClaims(tx, tenantId, { from: dates[0], to: dates.at(-1) }),
    };
  });
  const onSalary = new Set([...new Set(settings.map((s) => s.userId))].filter((id) => settingFor(settings.filter((s) => s.userId === id), month)));
  let noExitDays = 0;
  for (const [userId, l] of loaded) {
    if (!onSalary.has(userId)) continue;
    for (const [date, d] of workDays(l.marks, l.cancels, now)) if (date.startsWith(month) && date < today && d.noExit) noExitDays++;
  }
  const contacts = await kit.contacts(tenantId);
  const noSalary = contacts === null ? null : contacts.filter((c) => isEmployee(c.roles) && !onSalary.has(c.user_id)).length;
  return { month, onSalary: onSalary.size, noExitDays, noSalary, claimsWaiting: claims.filter((c) => c.status === "waiting").length };
}

/**
 * The morning job (07:00 IST): first resend what waited in the outbox, then tell each plant's owners who didn't mark
 * OUT yesterday; on the month's last day also the salary review. A second run sends nothing new (same dedupe keys).
 */
/** The hour (0-23) in India now. */
const istHour = (at: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(at));

/**
 * The morning job (hourly 08:00-11:00 IST, docs/ATTENDANCE_ROLES_PHASE_PLAN.md): first resend what waited in the
 * outbox, then for each plant whose alert hour has come (not Off) send "N people not marked by 10:00" once a day, only
 * when the Today board's "Not marked" list isn't empty. A later run the same day sends nothing new (same dedupe key).
 */
export async function runMorning(now: Date = new Date()) {
  const outbox = await kit.retryOutbox();
  const { rows } = await attendDb().execute<{ t: string }>(sql`select t from attendance_salary.attendance_tenants() t`);
  const hourNow = istHour(now);
  let notified = 0;
  for (const { t } of rows) {
    const settings = await withTenant(t, (tx) => readSettings(tx, t));
    const hour = settings ? settings.notMarkedHour : 10; // no settings row yet: the default 10:00
    if (hour == null || hourNow < hour) continue;
    const board = await boardFor(t, now);
    if (board.platformDown || board.notMarked.length === 0) continue;
    const supervisors = ((await kit.contacts(t)) ?? []).filter((c) => c.roles.includes("supervisor")).map((c) => c.user_id);
    await kit.notify(t, notMarkedNotification(board.today, hour, board.notMarked.map((p) => p.name), supervisors));
    notified++;
  }
  return { outbox, not_marked: { plants: rows.length, notified } };
}

export async function runDaily(now: Date = new Date()) {
  const outbox = await kit.retryOutbox();
  const { rows } = await attendDb().execute<{ t: string }>(sql`select t from attendance_salary.attendance_tenants() t`);
  let notified = 0;
  for (const { t } of rows) {
    const { date, names } = await noExitYesterday(t, now);
    if (!names.length) continue;
    await kit.notify(t, noExitNotification(date, names));
    notified++;
  }
  const review = { plants: 0, notified: 0 };
  const today = istDay(now);
  if (today === monthDays(today.slice(0, 7)).at(-1)) {
    const plants = await attendDb().execute<{ t: string }>(sql`select t from attendance_salary.salary_tenants() t`);
    review.plants = plants.rows.length;
    for (const { t } of plants.rows) {
      const r = await salaryReview(t, now);
      if (r.onSalary === 0) continue; // only salaries from a later month: nothing to review yet
      await kit.notify(t, salaryReviewNotification(r.month, r.noExitDays, r.noSalary, r.claimsWaiting));
      review.notified++;
    }
  }
  return { outbox, no_exit: { plants: rows.length, notified }, salary_review: review };
}

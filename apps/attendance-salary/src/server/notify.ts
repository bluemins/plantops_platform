// Attendance's app notifications (docs/ATTENDANCE_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people:
// Attendance is an owner-only module (OWNER_ONLY_ALERTS), so ticks are ignored and only owners get alerts about
// others; "corrected" goes to the worker it is about and nobody else. These functions only write the text. None is
// urgent. Never a phone number or a location: "outside" says only the distance.
//   1 corrected (phone + bell): the worker only  ·  2 outside (bell): owners, once per person per day
//   3 no exit (bell): owners, once per plant per day, from the morning job
import { eq, sql } from "drizzle-orm";
import { fmtDateTime } from "@plantops/module-kit/format";
import type { NotificationInput } from "@plantops/types";
import { roleWorksIn } from "@plantops/types";
import { addDays, fmtMonth, istDay, monthDays } from "@/lib/days";
import { settingFor } from "@/lib/salary";
import { fmtDistance } from "@/lib/geo";
import { workDays } from "@/lib/sessions";
import { attendDb, schema, withTenant } from "./db";
import { kit } from "./kit";
import { loadMarks } from "./people";
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
export function salaryReviewNotification(month: string, noExitDays: number, noSalary: number | null): NotificationInput {
  const parts: string[] = [];
  if (noExitDays > 0) parts.push(`${noExitDays} ${noExitDays === 1 ? "day" : "days"} with no exit to fix`);
  if (noSalary) parts.push(`${noSalary} ${noSalary === 1 ? "person" : "people"} without salary`);
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
  const { settings, loaded } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(schema.salarySettings).where(eq(schema.salarySettings.tenantId, tenantId));
    return { settings: rows.map((r) => ({ ...r, fromMonth: r.fromMonth.slice(0, 7) })), loaded: await loadMarks(tx, tenantId, dates[0]!, dates.at(-1)!) };
  });
  const onSalary = new Set([...new Set(settings.map((s) => s.userId))].filter((id) => settingFor(settings.filter((s) => s.userId === id), month)));
  let noExitDays = 0;
  for (const [userId, l] of loaded) {
    if (!onSalary.has(userId)) continue;
    for (const [date, d] of workDays(l.marks, l.cancels, now)) if (date.startsWith(month) && date < today && d.noExit) noExitDays++;
  }
  const contacts = await kit.contacts(tenantId);
  const noSalary = contacts === null ? null : contacts.filter((c) => c.roles.some((r) => roleWorksIn(r, "attendance_salary")) && !onSalary.has(c.user_id)).length;
  return { month, onSalary: onSalary.size, noExitDays, noSalary };
}

/**
 * The morning job (07:00 IST): first resend what waited in the outbox, then tell each plant's owners who didn't mark
 * OUT yesterday; on the month's last day also the salary review. A second run sends nothing new (same dedupe keys).
 */
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
      await kit.notify(t, salaryReviewNotification(r.month, r.noExitDays, r.noSalary));
      review.notified++;
    }
  }
  return { outbox, no_exit: { plants: rows.length, notified }, salary_review: review };
}

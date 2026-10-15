// Attendance's app notifications (docs/ATTENDANCE_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people:
// Attendance is an owner-only module (OWNER_ONLY_ALERTS), so ticks are ignored and only owners get alerts about
// others; "corrected" goes to the worker it is about and nobody else. These functions only write the text. None is
// urgent. Never a phone number or a location: "outside" says only the distance.
//   1 corrected (phone + bell): the worker only  ·  2 outside (bell): owners, once per person per day
//   3 no exit (bell): owners, once per plant per day, from the morning job
import { sql } from "drizzle-orm";
import { fmtDateTime } from "@plantops/module-kit/format";
import type { NotificationInput } from "@plantops/types";
import { addDays, istDay } from "@/lib/days";
import { fmtDistance } from "@/lib/geo";
import { workDays } from "@/lib/sessions";
import { attendDb, withTenant } from "./db";
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
 * The morning job (07:00 IST): first resend what waited in the outbox, then tell each plant's owners who didn't mark
 * OUT yesterday. A second run sends nothing new (same dedupe key).
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
  return { outbox, no_exit: { plants: rows.length, notified } };
}

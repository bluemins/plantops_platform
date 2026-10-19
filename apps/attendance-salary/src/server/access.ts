// Who may do what in Attendance: ONE table, used by every route and page (docs/ATTENDANCE_PHASE_PLAN.md "Who uses
// it", docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Who sees what"). Checked on the server every time; the screens only hide
// buttons the table already refuses. A worker only ever sees their own attendance; nobody but the owner (and PlantOps
// support, read-only) sees a salary.
import { forbidden, notFound } from "./http";

/**
 * What a person is in Attendance; one person may be several (e.g. Office staff + Plant staff = office + employee):
 * owner = tenant_admin; employee = Plant staff (tracked, paid, marks their own attendance); office = Office staff;
 * supervisor = Supervisor; support = PlantOps, read-only (always alone).
 */
export type Capacity = "owner" | "employee" | "office" | "supervisor" | "support";
/** Every capacity a person has; empty = no Attendance rights at all (e.g. a store keeper only). */
export type Who = readonly Capacity[];

export type Action =
  | "mark" // scan the QR: IN / OUT for yourself
  | "see_own" // your own calendar and days
  | "see_everyone" // the Staff list, anyone's calendar and days
  | "see_today" // the Today board (Supervisor: read-only)
  | "fix" // add a time / cancel a mark, with a reason (Office staff: never their own, checked next to the fix)
  | "day_mark" // mark a person's whole day ON / OFF / Clear, no times (docs/DAY_MARKS_PLAN.md: owner only)
  | "mark_for" // Office staff's "Mark for someone": IN / OUT now for a person without a phone (never yourself)
  | "settings" // plant location, circle, print QR, make a new QR
  | "view_settings" // see the settings page (support: read-only)
  | "export" // month CSV
  | "view_changes" // Recent changes
  | "support_log" // the owner's "Support access" page
  | "salary_view" // Salary tab and the salary sections of a person page (support: read-only)
  | "salary_edit" // salary settings, advance corrections of any age, "Can see own salary"
  | "salary_pay" // mark a month paid / undo paid
  | "salary_export" // salary CSV
  | "see_own_salary" // own salary slips: only with "Can see own salary" AND a paid month (checked in the query)
  | "advance_add" // give an advance (Office staff: not yourself, at most 7 days back; correct own same day)
  | "advance_view" // a person's advances this month + still to recover (never a salary)
  // claims (docs/SALARY_EXTRAS_PHASE_PLAN.md "Who sees what")
  | "claim_own" // send own field-duty / expense claims, add photos, withdraw a waiting one, My claims
  | "claim_view" // the Claims tab: anyone's claims and photos (support: read-only)
  | "claim_decide"; // approve / not approve / cancel; enter a claim for someone

export const ACCESS: Record<Action, readonly Capacity[]> = {
  mark: ["employee"],
  see_own: ["employee"],
  see_everyone: ["owner", "office", "support"],
  see_today: ["owner", "office", "supervisor", "support"],
  fix: ["owner", "office"],
  day_mark: ["owner"],
  mark_for: ["office"],
  settings: ["owner"],
  view_settings: ["owner", "support"],
  export: ["owner"],
  view_changes: ["owner", "support"],
  support_log: ["owner"],
  salary_view: ["owner", "support"],
  salary_edit: ["owner"],
  salary_pay: ["owner"],
  salary_export: ["owner"],
  see_own_salary: ["employee"],
  advance_add: ["owner", "office"],
  advance_view: ["owner", "office", "support"],
  claim_own: ["employee"],
  claim_view: ["owner", "support"],
  claim_decide: ["owner"],
};

/** Salary and claims: Office staff and Supervisors never learn these pages exist ("not found", never "not allowed"). */
const SALARY_ACTIONS: readonly Action[] = ["salary_view", "salary_edit", "salary_pay", "salary_export", "see_own_salary", "claim_own", "claim_view", "claim_decide"];

/** What the user is, for this table. */
export interface Actor {
  who: Who;
}

const has = (user: Actor, c: Capacity) => user.who.includes(c);

export const can = (user: Actor, action: Action) => user.who.some((c) => ACCESS[action].includes(c));

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  // nothing may hint that someone's own salary pages exist: "not found", never "not allowed"
  if (action === "see_own_salary") throw notFound();
  if (has(user, "support")) throw forbidden("PlantOps support view is read-only");
  // a worker never learns that the Claims tab or anyone else's claims exist
  if (action === "claim_view" && has(user, "employee") && !has(user, "owner")) throw notFound();
  // Office staff and Supervisors never learn that salary or claims pages exist
  if (SALARY_ACTIONS.includes(action) && !has(user, "owner") && (has(user, "office") || has(user, "supervisor"))) throw notFound();
  if (has(user, "owner") && action === "mark_for") throw forbidden("Owners use Fix on the person's day to add a time");
  if (has(user, "owner") && (action === "mark" || action === "see_own")) {
    throw forbidden("Owners don't mark attendance. Add Plant staff to yourself on Manage users to mark.");
  }
  if (user.who.length > 0 && !has(user, "owner")) throw forbidden("Only the plant owner can do this");
  throw forbidden("You don't have access to Attendance");
}

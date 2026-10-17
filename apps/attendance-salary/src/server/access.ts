// Who may do what in Attendance: ONE table, used by every route and page (docs/ATTENDANCE_PHASE_PLAN.md "Who uses
// it"). Checked on the server every time; the screens only hide buttons the table already refuses. A worker only
// ever sees their own attendance; nobody but the owner (and PlantOps support, read-only) sees anyone else's.
import { forbidden, notFound } from "./http";

/**
 * owner = tenant_admin; owner_worker = tenant_admin who also holds Plant staff (sees everyone AND marks their own);
 * worker = Plant staff (roleWorksIn); support = PlantOps, read-only
 */
export type Who = "owner" | "owner_worker" | "worker" | "support";

export type Action =
  | "mark" // scan the QR: IN / OUT for yourself
  | "see_own" // your own calendar and days
  | "see_everyone" // Today board, anyone's calendar and days
  | "fix" // add a time / cancel a mark, with a reason
  | "settings" // plant location, circle, print QR, make a new QR
  | "view_settings" // see the settings page (support: read-only)
  | "export" // month CSV
  | "view_changes" // Recent changes
  | "support_log" // the owner's "Support access" page
  | "salary_view" // Salary tab and the salary sections of a person page (support: read-only)
  | "salary_edit" // salary settings, advances, "Can see own salary"
  | "salary_pay" // mark a month paid / undo paid
  | "salary_export" // salary CSV
  | "see_own_salary"; // own salary slips: only with "Can see own salary" AND a paid month (checked in the query)

export const ACCESS: Record<Action, readonly Who[]> = {
  mark: ["owner_worker", "worker"],
  see_own: ["owner_worker", "worker"],
  see_everyone: ["owner", "owner_worker", "support"],
  fix: ["owner", "owner_worker"],
  settings: ["owner", "owner_worker"],
  view_settings: ["owner", "owner_worker", "support"],
  export: ["owner", "owner_worker"],
  view_changes: ["owner", "owner_worker", "support"],
  support_log: ["owner", "owner_worker"],
  salary_view: ["owner", "owner_worker", "support"],
  salary_edit: ["owner", "owner_worker"],
  salary_pay: ["owner", "owner_worker"],
  salary_export: ["owner", "owner_worker"],
  see_own_salary: ["owner_worker", "worker"],
};

/** What the user is, for this table. null = no Attendance rights at all (e.g. a store keeper only). */
export interface Actor {
  who: Who | null;
}

export const can = (user: Actor, action: Action) => user.who !== null && ACCESS[action].includes(user.who);

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  // nothing may hint that someone's own salary pages exist: "not found", never "not allowed"
  if (action === "see_own_salary") throw notFound();
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "owner" && (action === "mark" || action === "see_own")) {
    throw forbidden("Owners don't mark attendance. Add Plant staff to yourself on Manage users to mark.");
  }
  if (user.who === "worker") throw forbidden("Only the plant owner can do this");
  throw forbidden("You don't have access to Attendance");
}

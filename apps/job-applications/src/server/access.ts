// Who may do what in Job applications: ONE table, used by every route and page (docs/JOB_APPLICATIONS_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/** owner = tenant_admin; hr = HR desk (roleWorksIn); support = PlantOps, read-only. Plant staff: nothing. */
export type Who = "owner" | "hr" | "support";

export type Action =
  | "read" // the list, an application, its resume pages
  | "update" // change the status, add a note
  | "view_openings" // see the openings and the page message (support: read-only)
  | "manage_openings" // add / edit / switch openings, the page message
  | "view_changes" // Recent changes
  | "export" // CSV
  | "remove" // "Remove this application now"
  | "support_log"; // the owner's "Support access" page

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "hr", "support"],
  update: ["owner", "hr"],
  view_openings: ["owner", "support"],
  manage_openings: ["owner"],
  view_changes: ["owner", "support"],
  export: ["owner"],
  remove: ["owner"],
  support_log: ["owner"],
};

/** What the user is, for this table. null = no Job applications rights at all (e.g. plant staff, a store keeper). */
export interface Actor {
  who: Who | null;
}

export const can = (user: Actor, action: Action) => user.who !== null && ACCESS[action].includes(user.who);

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "hr") throw forbidden("Only the plant owner can do this");
  throw forbidden("You don't have access to Job applications");
}

// Who may do what in Complaint Box: ONE table, used by every route and page (docs/COMPLAINT_BOX_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/** owner = tenant_admin; staff = complaint desk or plant staff (roleWorksIn); support = PlantOps, read-only */
export type Who = "owner" | "staff" | "support";

export type Action =
  | "read" // the list, a complaint, its photos / video
  | "log" // a new complaint and its files
  | "note" // add a note (with photos) in any status
  | "in_progress" // Open -> In progress
  | "resolve" // with a resolution note
  | "reopen" // with a reason
  | "manage_items" // change the item list
  | "view_items" // see the item list (support: read-only)
  | "view_changes" // Recent changes
  | "export" // CSV
  | "support_log"; // the owner's "Support access" page

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "staff", "support"],
  log: ["owner", "staff"],
  note: ["owner", "staff"],
  in_progress: ["owner", "staff"],
  resolve: ["owner"],
  reopen: ["owner"],
  manage_items: ["owner"],
  view_items: ["owner", "support"],
  view_changes: ["owner", "support"],
  export: ["owner"],
  support_log: ["owner"],
};

/** What the user is, for this table. null = no Complaint Box rights at all (e.g. a store keeper only). */
export interface Actor {
  who: Who | null;
}

export const can = (user: Actor, action: Action) => user.who !== null && ACCESS[action].includes(user.who);

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "staff") throw forbidden("Only the plant owner can do this");
  throw forbidden("You don't have access to Complaint Box");
}

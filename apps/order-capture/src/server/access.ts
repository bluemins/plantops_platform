// Who may do what in Order Capture: ONE table, used by every route and page (docs/ORDER_CAPTURE_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/** owner = tenant_admin; desk = Order desk (plant staff are NOT desk: roleWorksIn); support = PlantOps, read-only */
export type Who = "owner" | "desk" | "support";

export type Action =
  | "read" // the order list, an order, the customer list
  | "enter" // a new order; change the lines of a pending order
  | "customers" // add a customer, edit name / place, switch off / on
  | "deliver" // Pending -> Delivered
  | "cancel" // Pending -> Cancelled, with a reason
  | "undo_delivered" // Delivered -> Pending, with a reason
  | "rates" // set each product's unit and default rate
  | "view_rates" // see the Rates page (support: read-only)
  | "customer_upload" // CSV upload with preview
  | "view_changes" // Recent changes
  | "export" // CSV
  | "pending_summary" // all pending orders added up: total value, quantity / rate / amount per product
  | "support_log"; // the owner's "Support access" page

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "desk", "support"],
  enter: ["owner", "desk"],
  customers: ["owner", "desk"],
  deliver: ["owner", "desk"],
  cancel: ["owner", "desk"],
  undo_delivered: ["owner"],
  rates: ["owner"],
  view_rates: ["owner", "support"],
  customer_upload: ["owner"],
  view_changes: ["owner", "support"],
  export: ["owner"],
  pending_summary: ["owner"],
  support_log: ["owner"],
};

/** What the user is, for this table. null = no Order Capture rights at all (e.g. plant staff or a store keeper). */
export interface Actor {
  who: Who | null;
}

export const can = (user: Actor, action: Action) => user.who !== null && ACCESS[action].includes(user.who);

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "desk") throw forbidden("Only the plant owner can do this");
  throw forbidden("You don't have access to Order Capture");
}

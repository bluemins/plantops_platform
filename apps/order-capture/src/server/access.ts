// Who may do what in Order Capture: ONE table, used by every route and page (docs/ORDER_CAPTURE_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/**
 * owner = tenant_admin; desk = Order desk (plant staff are NOT desk: roleWorksIn); viewer = plant staff without Order
 * desk (viewOnlyIn: sees the orders, never amounts, never writes; owner 2026-10-14); support = PlantOps, read-only
 */
export type Who = "owner" | "desk" | "viewer" | "support";

export type Action =
  | "read" // the order list, an order
  | "see_amounts" // rates, line amounts, order totals (everywhere: list, order page, history, WhatsApp text)
  | "copy_list" // tick pending orders and copy them as a WhatsApp message
  | "view_customers" // the customer list
  | "enter" // a new order; change the lines of a pending order
  | "customers" // add a customer, edit name / place, switch off / on
  | "deliver" // Pending -> Delivered
  | "cancel" // Pending -> Cancelled, with a reason
  | "undo_delivered" // Delivered -> Pending, with a reason
  | "add_note" // a note on a saved order, any status (owner 2026-10-14)
  | "rates" // set each product's unit and default rate
  | "view_rates" // see the Rates page (support: read-only)
  | "customer_upload" // CSV upload with preview
  | "view_changes" // Recent changes
  | "export" // CSV
  | "pending_summary" // all pending orders added up: total value, quantity / rate / amount per product
  | "consent" // tick / untick "Agreed to WhatsApp reminders" on a customer (read out on the phone)
  | "reminder_pilot" // the WhatsApp reminder pilot page
  | "support_log"; // the owner's "Support access" page

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "desk", "viewer", "support"],
  see_amounts: ["owner", "desk", "support"],
  copy_list: ["owner", "desk", "viewer"],
  view_customers: ["owner", "desk", "support"],
  enter: ["owner", "desk"],
  customers: ["owner", "desk"],
  deliver: ["owner", "desk"],
  cancel: ["owner", "desk"],
  undo_delivered: ["owner"],
  add_note: ["owner", "desk"],
  rates: ["owner"],
  view_rates: ["owner", "support"],
  customer_upload: ["owner"],
  view_changes: ["owner", "support"],
  export: ["owner"],
  pending_summary: ["owner"],
  consent: ["owner", "desk"],
  reminder_pilot: ["owner", "support"],
  support_log: ["owner"],
};

/** What the user is, for this table. null = no Order Capture rights at all (e.g. a store keeper). */
export interface Actor {
  who: Who | null;
}

export const can = (user: Actor, action: Action) => user.who !== null && ACCESS[action].includes(user.who);

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "desk") throw forbidden("Only the plant owner can do this");
  if (user.who === "viewer") throw forbidden("You can view orders only. Order desk or the owner does this.");
  throw forbidden("You don't have access to Order Capture");
}

// Who may do what in Order Capture: ONE table, used by every route and page (docs/ORDER_CAPTURE_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/**
 * owner = tenant_admin; desk = Order desk (plant staff are NOT desk: roleWorksIn); viewer = plant staff without Order
 * desk (viewOnlyIn: sees the orders, never amounts, never writes; owner 2026-10-14); delivery = Delivery staff (the
 * Calls tab only, never orders, customers or amounts; docs/CALLS_PHASE_PLAN.md); accounts = Accounts (bills and payments
 * after delivery; orders read-only with amounts; owner 2026-11-06: "only users with Accounts see the Bills section");
 * support = PlantOps, read-only. A person can hold Order desk AND Accounts: `also` adds the second set of rights.
 */
export type Who = "owner" | "desk" | "viewer" | "delivery" | "accounts" | "support";

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
  | "support_log" // the owner's "Support access" page
  | "calls_view" // the Calls tab: waiting numbers, attended today
  | "calls_attend" // mark a number attended, saving a new caller to the customer list
  | "calls_numbers" // the owner's calls numbers page
  | "view_ignored" // the "Not an order number" list (its labels can be private)
  | "calls_ignore" // add / remove a number on that list
  | "zoho_import" // bring Zoho's contacts, invoices and payments into the sales ledger (docs/ZOHO_IMPORT_PHASE_PLAN.md)
  | "zoho_match" // the Match screen: link Zoho contacts to customers, or add them as customers
  | "ledger_view" // bills, payments, a customer's account and statement (amounts)
  | "bill_make" // make a delivered order's bill; the Zoho GST invoice no. on a bill
  | "bill_cancel" // cancel a bill, with a reason
  | "payment_receive" // receive a payment from a customer
  | "payment_cancel" // cancel a payment, with a reason
  | "ledger_export" // bills / payments CSV
  | "ledger_totals" // the plant's totals: still due, overdue bills, received (owner 2026-11-06: owner only)
  | "reports" // Reports: sales by item / customer (owner 2026-11-07: owner only; support reads)
  // customer page Part 2 (docs/CUSTOMER_PAGE_PHASE_PLAN.md, owner 2026-11-07)
  | "customer_edit" // every customer field incl. GST details and the mobile (with a reason); contact persons
  | "customer_comment" // add a comment on a customer (read with ledger_view)
  | "location_view" // a customer's shop location and the Shop locations search (no amounts)
  | "location_save" // "Save my location here" (standing at the shop)
  | "location_clear"; // clear a wrong pin, with a reason

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "desk", "viewer", "accounts", "support"],
  see_amounts: ["owner", "desk", "accounts", "support"],
  copy_list: ["owner", "desk", "viewer"],
  view_customers: ["owner", "desk", "accounts", "support"],
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
  calls_view: ["owner", "desk", "delivery", "support"],
  calls_attend: ["owner", "desk", "delivery"],
  calls_numbers: ["owner", "support"],
  view_ignored: ["owner", "support"],
  calls_ignore: ["owner"],
  zoho_import: ["owner"],
  zoho_match: ["owner"],
  ledger_view: ["owner", "accounts", "support"],
  bill_make: ["owner", "accounts"],
  bill_cancel: ["owner"],
  payment_receive: ["owner", "accounts"],
  payment_cancel: ["owner"],
  ledger_export: ["owner"],
  ledger_totals: ["owner", "support"],
  reports: ["owner", "support"],
  customer_edit: ["owner"],
  customer_comment: ["owner"],
  location_view: ["owner", "desk", "accounts", "delivery", "support"],
  location_save: ["owner", "desk", "accounts", "delivery"],
  location_clear: ["owner", "desk"],
};

/** What the user is, for this table. null = no Order Capture rights at all (e.g. a store keeper). */
export interface Actor {
  who: Who | null;
  /** a second set of rights (Order desk + Accounts) */
  also?: Who[];
}

export const can = (user: Actor, action: Action) =>
  user.who !== null && (ACCESS[action].includes(user.who) || (user.also ?? []).some((w) => ACCESS[action].includes(w)));

const LEDGER: Action[] = ["ledger_view", "bill_make", "payment_receive"];

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (user.who === "desk" && LEDGER.includes(action)) throw forbidden("Bills and payments need the Accounts role. Ask the owner.");
  if (user.who === "desk") throw forbidden("Only the plant owner can do this");
  if (user.who === "viewer") throw forbidden("You can view orders only. Order desk or the owner does this.");
  if (user.who === "delivery") throw forbidden("Delivery staff work in Calls only.");
  if (user.who === "accounts") throw forbidden("Accounts works on bills and payments. Order desk or the owner does this.");
  throw forbidden("You don't have access to Sales");
}

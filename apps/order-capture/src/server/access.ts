// Who may do what in Order Capture: ONE table, used by every route and page (docs/ORDER_CAPTURE_PHASE_PLAN.md
// "Who uses it"). Checked on the server every time; the screens only hide buttons the table already refuses.
import { forbidden } from "./http";

/**
 * owner = tenant_admin; desk = Order desk (plant staff are NOT desk: roleWorksIn); viewer = plant staff without Order
 * desk (viewOnlyIn: sees the orders, never amounts, never writes; owner 2026-10-14); delivery = Delivery staff (the
 * Calls tab only, never orders, customers or amounts; docs/CALLS_PHASE_PLAN.md); accounts = Accounts (bills and payments
 * after delivery; orders read-only with amounts; owner 2026-11-06: "only users with Accounts see the Bills section");
 * support = PlantOps, read-only; marketing = Marketing staff (owner, 2026-11-07: customers and their details incl. the
 * mobile, a customer's bills / payments / statement read-only; never orders; GST details and payment terms owner-only).
 * store = a Store keeper (Floor Stock's role) opening Sales for "Purchases received" only: what was bought, never prices,
 * payments, orders or customers (owner, 2026-11-10; pageViewIn in packages/types).
 * A person can hold Order desk AND Accounts (or Marketing staff): `also` adds the other sets of rights.
 */
export type Who = "owner" | "desk" | "viewer" | "delivery" | "accounts" | "marketing" | "store" | "support";

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
  | "ledger_view" // the Bills section: the plant's Bills / Payments lists, GST invoices to make (amounts)
  | "account_view" // one customer's (or Zoho contact's) page with bills, payments and statement; a bill's page
  | "bill_make" // make a delivered order's bill; the Zoho GST invoice no. on a bill
  | "bill_cancel" // cancel a bill, with a reason
  | "payment_receive" // receive a payment from a customer
  | "payment_cancel" // cancel a payment, with a reason
  | "ledger_export" // bills / payments CSV
  | "ledger_totals" // the plant's totals: still due, overdue bills, received (owner 2026-11-06: owner only)
  | "reports" // Reports: sales by item / customer (owner 2026-11-07: owner only; support reads)
  | "bill_link_view" // the Link bills to orders list (owner 2026-11-10; support reads)
  | "bill_link" // link an imported Zoho bill to a delivered order, or unlink it with a reason (owner only)
  // customer page Part 2 (docs/CUSTOMER_PAGE_PHASE_PLAN.md, owner 2026-11-07)
  | "customer_edit" // GST details (legal name, treatment, GSTIN, state, billing address) and payment terms; a pasted Maps link
  | "customer_details" // the other customer fields incl. the mobile (with a reason); contact persons
  | "customer_comment" // add a comment on a customer (read with ledger_view)
  | "location_view" // a customer's shop location and the Shop locations search (no amounts)
  | "location_save" // "Save my location here" (standing at the shop)
  | "location_clear" // clear a wrong pin, with a reason
  // Drop, the customer app (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 1, owner 2026-11-08)
  | "drop_view" // a customer's Drop card: switch, brands, phones, last login
  | "drop_manage" // switch a shop on / off for Drop, brands shown, Make main phone
  | "drop_phones" // add / remove a shop's extra phones
  | "drop_shops" // the Drop shops list (pilot numbers)
  | "drop_points_view" // the points settings page (support: read-only)
  | "drop_points_settings" // change the points settings
  | "drop_rewards_view" // free boxes asked with points; a shop's points balance
  | "drop_rewards" // add a free box asked to an order, cancel a request (with a reason)
  | "drop_polls_view" // the Drop polls and their results (support: read-only)
  | "drop_polls" // new poll, close a poll early, results CSV
  // Purchases (docs/PURCHASES_PHASE_PLAN.md, owner 2026-11-10): vendors, purchase bills, payments made, with amounts
  | "purchases_view" // the Purchases tab: vendors, purchase bills, payments made, a vendor's page, a bill's page
  | "purchase_import" // bring Zoho's vendors, purchase items, bills and payments made into Purchases
  | "purchase_enter" // add / edit a vendor, record a purchase bill, pay a vendor, correct a payment's mode (owner 2026-11-10: Accounts enters them)
  | "purchase_cancel" // cancel a purchase bill or a payment made, with a reason
  | "purchases_received" // what was bought (date, vendor, item, quantity), no prices: Store keepers too (P5)
  | "payables" // what is owed to vendors, by age (Reports → Payables; P3)
  // Cash book (docs/CASHBOOK_PHASE_PLAN.md, owner 2026-11-10): the plant's petty cash
  | "cash_view" // the day sheet and the cash book (amounts)
  | "cash_enter" // an expense, staff cash, money in / out
  | "cash_close" // close a day: the cash counted in the box
  | "cash_owner"; // start the cash book, categories / vehicles, cancel an entry, correct a close

export const ACCESS: Record<Action, readonly Who[]> = {
  read: ["owner", "desk", "viewer", "accounts", "support"],
  see_amounts: ["owner", "desk", "accounts", "support"],
  copy_list: ["owner", "desk", "viewer"],
  view_customers: ["owner", "desk", "accounts", "marketing", "support"],
  enter: ["owner", "desk"],
  customers: ["owner", "desk", "marketing"],
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
  account_view: ["owner", "accounts", "marketing", "support"],
  bill_make: ["owner", "accounts"],
  bill_cancel: ["owner"],
  payment_receive: ["owner", "accounts"],
  payment_cancel: ["owner"],
  ledger_export: ["owner"],
  ledger_totals: ["owner", "support"],
  reports: ["owner", "support"],
  bill_link_view: ["owner", "support"],
  bill_link: ["owner"],
  customer_edit: ["owner"],
  customer_details: ["owner", "marketing"],
  customer_comment: ["owner", "marketing"],
  location_view: ["owner", "desk", "accounts", "delivery", "marketing", "support"],
  location_save: ["owner", "desk", "accounts", "delivery", "marketing"],
  location_clear: ["owner", "desk"],
  drop_view: ["owner", "desk", "support"],
  drop_manage: ["owner"],
  drop_phones: ["owner", "desk"],
  drop_shops: ["owner", "support"],
  drop_points_view: ["owner", "support"],
  drop_points_settings: ["owner"],
  drop_rewards_view: ["owner", "desk", "support"],
  drop_rewards: ["owner", "desk"],
  drop_polls_view: ["owner", "support"],
  drop_polls: ["owner"],
  purchases_view: ["owner", "accounts", "support"],
  purchase_import: ["owner"],
  purchase_enter: ["owner", "accounts"],
  purchase_cancel: ["owner"],
  purchases_received: ["owner", "accounts", "store", "support"],
  payables: ["owner", "accounts", "support"],
  cash_view: ["owner", "accounts", "support"],
  cash_enter: ["owner", "accounts"],
  cash_close: ["owner", "accounts"],
  cash_owner: ["owner"],
};

/** What the user is, for this table. null = no Order Capture rights at all (e.g. a store keeper). */
export interface Actor {
  who: Who | null;
  /** other sets of rights (Order desk + Accounts, + Marketing staff) */
  also?: Who[];
}

export const can = (user: Actor, action: Action) =>
  user.who !== null && (ACCESS[action].includes(user.who) || (user.also ?? []).some((w) => ACCESS[action].includes(w)));

const LEDGER: Action[] = ["ledger_view", "bill_make", "payment_receive"];

/** Throws 403 with a plain message when the table says no. */
export function requireAccess(user: Actor, action: Action) {
  if (can(user, action)) return;
  if (user.who === "support") throw forbidden("PlantOps support view is read-only");
  if (action === "cash_owner") throw forbidden("Only the plant owner can do this");
  if (user.who === "desk" && LEDGER.includes(action)) throw forbidden("Bills and payments need the Accounts role. Ask the owner.");
  if (user.who === "desk") throw forbidden("Only the plant owner can do this");
  if (user.who === "viewer") throw forbidden("You can view orders only. Order desk or the owner does this.");
  if (user.who === "delivery") throw forbidden("Delivery staff work in Calls only.");
  if (user.who === "store") throw forbidden("Store keepers see purchases received only.");
  if (user.who === "accounts") throw forbidden("Accounts works on bills and payments. Order desk or the owner does this.");
  if (user.who === "marketing") throw forbidden("Marketing staff work on customers. Order desk or the owner does this.");
  throw forbidden("You don't have access to Sales");
}

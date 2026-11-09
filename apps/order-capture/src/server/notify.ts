// Order Capture's app notifications (docs/ORDER_CAPTURE_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people
// (the plant's owners + those ticked "Gets Order Capture alerts" + also_user_ids, each re-checked) and leaves out
// whoever acted; these functions only write the text. None is urgent: each person can mute or downgrade them.
//   1 new order (phone + bell; with the order note, shortened to fit)  ·  2 delivered: to whoever entered it only (bell)  ·  3 cancelled: + them (bell)
//   4 note added after saving (bell)  ·  5 customer called: Delivery staff only (phone + bell)
// The customer's phone number is never put in a notification (it would show on a lock screen), except a new caller's
// in 5 (owner, 2026-11-04).
import { runPushDaily } from "./drop/push";
import { phoneDisplay } from "@plantops/module-kit/phone";
import type { NotificationInput } from "@plantops/types";
import { productsText } from "@/lib/history";
import { money } from "@/lib/money";
import { isMobile, type CallAlert } from "./calls";
import type { OrderEvent } from "./handling";
import { kit } from "./kit";
import type { OrderBy, SavedOrder } from "./orders";
import type { OcUser } from "./session";
import { retryThanks } from "./thanks";

const TITLE_MAX = 80;
const BODY_MAX = 300;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const title = (s: string) => clip(s, TITLE_MAX);
const body = (s: string) => clip(s.replace(/\s+/g, " ").trim(), BODY_MAX);
const link = (orderId: string) => `/o/${orderId}`;

/** 1. A new order: owners + ticked people, not whoever saved it ("by WhatsApp" for the bot's orders). */
export function newOrderNotification(user: OrderBy, o: SavedOrder): NotificationInput {
  const lines = productsText(o.lines);
  return {
    kind: "order_capture.new",
    title: title(`New order ${o.ref}: ${money(o.total)}`),
    body: body(`${o.customer.name}, ${o.customer.place}. ${lines} (by ${user.name})${o.note ? ` Note: ${o.note}` : ""}`),
    link: link(o.id),
    level: "push",
    dedupe_key: `new:${o.id}`,
    exclude_user_id: user.userId,
  };
}

/** 2. Delivered: only the person who entered the order; nobody when they delivered it themselves. */
export function deliveredNotification(user: OcUser, e: OrderEvent): NotificationInput | null {
  if (e.entered_by === user.userId) return null;
  return {
    kind: "order_capture.delivered",
    title: title(`${e.ref} delivered`),
    body: body(e.text ? `${e.customer} · ${e.text}` : e.customer),
    link: link(e.order_id),
    level: "bell",
    dedupe_key: `delivered:${e.order_id}:${e.event_id}`,
    exclude_user_id: user.userId,
    also_user_ids: [e.entered_by],
    only_listed: true,
  };
}

/** 3. Cancelled: owners + ticked people + whoever entered it, not whoever cancelled it. */
export function cancelledNotification(user: OcUser, e: OrderEvent): NotificationInput {
  return {
    kind: "order_capture.cancelled",
    title: title(`${e.ref} cancelled`),
    body: body(e.text ?? ""),
    link: link(e.order_id),
    level: "bell",
    dedupe_key: `cancelled:${e.order_id}`,
    exclude_user_id: user.userId,
    also_user_ids: [e.entered_by],
  };
}

/** 4. A note added after saving: owners + ticked people, not whoever wrote it. */
export function noteNotification(user: OcUser, e: OrderEvent): NotificationInput {
  return {
    kind: "order_capture.note",
    title: title(`Note on ${e.ref}: ${e.customer}`),
    body: body(`${e.text ?? ""} (by ${user.name})`),
    link: link(e.order_id),
    level: "bell",
    dedupe_key: `note:${e.order_id}:${e.event_id}`,
    exclude_user_id: user.userId,
  };
}

/** 6. A payment received (sales ledger): owners + ticked people, not whoever entered it. Bell only. */
export function paymentNotification(user: OcUser, p: { id: string; number: string; amount: string; customer: string; mode: string; bills: string[]; advance: string }): NotificationInput {
  const paid = p.bills.length ? `Paid ${p.bills.join(", ")}` : "Kept as advance";
  return {
    kind: "order_capture.payment",
    title: title(`Payment ${money(p.amount)} from ${p.customer}`),
    body: body(`${p.number}, ${p.mode}. ${paid}${p.bills.length && p.advance !== "0.00" ? `; ${money(p.advance)} advance` : ""} (by ${user.name})`),
    link: `/payments?q=${encodeURIComponent(p.number)}`,
    level: "bell",
    dedupe_key: `payment:${p.id}`,
    exclude_user_id: user.userId,
  };
}

/** 7. A bill or a payment cancelled (owner only acts): the other owners + ticked people. Bell only. */
export function ledgerCancelNotification(user: OcUser, what: "bill" | "payment", id: string, x: { number: string; customer: string; amount: string; reason: string }): NotificationInput {
  return {
    kind: what === "bill" ? "order_capture.bill_cancelled" : "order_capture.payment_cancelled",
    title: title(`${what === "bill" ? "Bill" : "Payment"} ${x.number} cancelled: ${money(x.amount)}`),
    body: body(`${x.customer}. ${x.reason} (by ${user.name})`),
    link: what === "bill" ? `/bills/${id}` : `/payments?q=${encodeURIComponent(x.number)}`,
    level: "bell",
    dedupe_key: `${what}_cancelled:${id}`,
    exclude_user_id: user.userId,
  };
}

/**
 * 5. "Customer called" (docs/CALLS_PHASE_PLAN.md "Notifications"): the plant's Delivery staff only, never owners (their
 * phone already rang) or Order desk. The one Order Capture alert with a phone number: a new caller's number is all
 * there is to call back (owner, 2026-11-04). No amounts, no order details.
 */
export function callNotification(a: CallAlert, deliveryStaff: string[]): NotificationInput | null {
  if (!deliveryStaff.length) return null;
  const who = a.customer
    ? `${a.customer.name} (${a.customer.place})`
    : a.phone === "hidden"
      ? "Hidden number"
      : `New number ${isMobile(a.phone) ? phoneDisplay(a.phone).text : a.phone}`;
  return {
    kind: "order_capture.call",
    title: title(`${a.missed ? "Missed call" : "Call"}: ${who}${a.n > 1 ? ` · rang ${a.rings} times` : ""}`),
    body: "Open Calls to call back.",
    link: "/calls",
    level: "push",
    dedupe_key: `call:${a.phone}:${a.firstRingId}${a.n > 1 ? `:${a.n}` : ""}`,
    also_user_ids: deliveryStaff,
    only_listed: true,
  };
}

/** Sends "Customer called" after the answer to the phone: Delivery staff from the platform's contact list. */
export async function sendCallAlert(tenantId: string, a: CallAlert) {
  const contacts = await kit.contacts(tenantId);
  const staff = (contacts ?? []).filter((c) => c.roles.includes("delivery_staff") && !c.roles.includes("tenant_admin")).map((c) => c.user_id);
  if (!contacts) console.warn("[order-capture] call alert: the platform's contact list can't be read; not sent");
  const note = callNotification(a, staff);
  if (note) await kit.notify(tenantId, note);
}

/** The daily job: resend what waited in the outbox (no scheduled notifications in v1) and waiting WhatsApp thank-yous. */
export async function runDaily() {
  return { outbox: await kit.retryOutbox(), whatsapp_thanks: await retryThanks(), drop_push: await runPushDaily() };
}

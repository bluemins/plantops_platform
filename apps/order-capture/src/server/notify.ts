// Order Capture's app notifications (docs/ORDER_CAPTURE_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people
// (the plant's owners + those ticked "Gets Order Capture alerts" + also_user_ids, each re-checked) and leaves out
// whoever acted; these functions only write the text. None is urgent: each person can mute or downgrade them.
//   1 new order (phone + bell; with the order note, shortened to fit)  ·  2 delivered: to whoever entered it only (bell)  ·  3 cancelled: + them (bell)
//   4 note added after saving (bell)
// The customer's phone number is never put in a notification (it would show on a lock screen).
import type { NotificationInput } from "@plantops/types";
import { productsText } from "@/lib/history";
import { money } from "@/lib/money";
import type { OrderEvent } from "./handling";
import { kit } from "./kit";
import type { SavedOrder } from "./orders";
import type { OcUser } from "./session";
import { retryThanks } from "./thanks";

const TITLE_MAX = 80;
const BODY_MAX = 300;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const title = (s: string) => clip(s, TITLE_MAX);
const body = (s: string) => clip(s.replace(/\s+/g, " ").trim(), BODY_MAX);
const link = (orderId: string) => `/o/${orderId}`;

/** 1. A new order: owners + ticked people, not whoever saved it. */
export function newOrderNotification(user: OcUser, o: SavedOrder): NotificationInput {
  const lines = productsText(o.lines.map((l) => ({ sku_id: "", product: l.product, unit: l.unit, quantity: l.quantity, rate: l.rate, total: l.total })));
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

/** The daily job: resend what waited in the outbox (no scheduled notifications in v1) and waiting WhatsApp thank-yous. */
export async function runDaily() {
  return { outbox: await kit.retryOutbox(), whatsapp_thanks: await retryThanks() };
}

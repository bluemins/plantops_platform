// Handling an order (docs/ORDER_CAPTURE_PHASE_PLAN.md "Order states"): Change (a new version of the lines), Mark
// delivered, Cancel and the owner's Undo delivered. Rules, checked here on the server:
//   * who: the access table (change / deliver / cancel: owner and Order desk; undo: owner only; plant staff only read,
//     and never get amounts: getOrder removes them)
//   * every change sends what the person saw (status + version); inside ONE transaction the order row is locked and,
//     if someone changed it meanwhile, the answer is 409 "This order was just changed by …"; the event and the new
//     status / version are written in that same transaction
//   * only a Pending order can be changed, delivered or cancelled; Cancelled is final; Delivered changes only through
//     the owner's Undo (back to Pending, with a reason)
//   * nothing is deleted: old line versions and every event stay (the database allows no UPDATE / DELETE on them)
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { productLabel } from "@plantops/module-kit";
import { withoutAmounts, type EventKind, type EventView, type LineView, type VersionView } from "@/lib/history";
import { fromPaise, lineTotal, toPaise } from "@/lib/money";
import { formatRef } from "@/lib/ref";
import { can, requireAccess, type Action } from "./access";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { LinesInput } from "./orders";
import { activeProducts, effectiveRates } from "./rates";
import type { OrderStatus } from "./schema";
import type { OcUser } from "./session";

const { orders, orderLines, orderEvents } = schema;

// ---------- inputs ----------
const Expected = z.object({ status: z.enum(["pending", "delivered", "cancelled"]), version: z.number().int().min(1) });
const Reason = z.string().trim().min(3, "Please write a reason (at least 3 characters)").max(300, "A reason has at most 300 characters");
export const ChangeInput = z.object({ expected: Expected, lines: LinesInput });
export const DeliverInput = z.object({
  expected: Expected,
  note: z.string().trim().max(300, "A delivery note has at most 300 characters").optional(),
  invoice_no: z.string().trim().max(40, "An invoice number has at most 40 characters").optional(),
});
export const ReasonInput = z.object({ expected: Expected, reason: Reason });

const STATUS_WORD: Record<OrderStatus, string> = { pending: "pending", delivered: "already delivered", cancelled: "cancelled" };

// ---------- reading ----------
export interface OrderDetail {
  id: string;
  ref: string;
  status: OrderStatus;
  version: number;
  customer: { name: string; phone: string; place: string };
  /** typed with the order, fixed once saved */
  note: string | null;
  lines: LineView[];
  /** null = hidden from this person (plant staff) */
  total: string | null;
  entered_by: string;
  created_at: string;
  status_changed_at: string;
  delivered: { by: string; at: string; note: string | null; invoice_no: string | null } | null;
  versions: VersionView[];
  /** oldest first */
  events: EventView[];
}

async function versionsOf(tx: OcTx, tenantId: string, orderId: string): Promise<VersionView[]> {
  const rows = await tx
    .select()
    .from(orderLines)
    .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)))
    .orderBy(asc(orderLines.version), asc(orderLines.lineNo));
  const out: VersionView[] = [];
  for (const r of rows) {
    let v = out.find((x) => x.version === r.version);
    if (!v) out.push((v = { version: r.version, lines: [], total: "0.00" }));
    v.lines.push({ sku_id: r.skuId, product: r.productName, unit: r.unit, quantity: r.quantity, rate: r.rate, total: r.lineTotal });
  }
  for (const v of out) v.total = fromPaise(v.lines.reduce((s, l) => s + toPaise(l.total!), 0n));
  return out;
}

export async function getOrder(user: OcUser, id: string): Promise<OrderDetail> {
  requireAccess(user, "read");
  return withTenant(user.tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id)));
    if (!o) throw notFound("Order not found");
    const amounts = can(user, "see_amounts");
    const all = await versionsOf(tx, user.tenantId, id);
    const versions = amounts ? all : all.map((v) => ({ version: v.version, lines: withoutAmounts(v.lines), total: null }));
    const events = await tx.select().from(orderEvents).where(and(eq(orderEvents.tenantId, user.tenantId), eq(orderEvents.orderId, id))).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    return {
      id: o.id,
      ref: formatRef(o.refNo),
      status: o.status,
      version: o.version,
      customer: { name: o.customerName, phone: o.customerPhone, place: o.customerPlace },
      note: o.orderNote,
      lines: versions.find((v) => v.version === o.version)?.lines ?? [],
      total: amounts ? o.total : null,
      entered_by: o.enteredByName,
      created_at: o.createdAt.toISOString(),
      status_changed_at: o.statusChangedAt.toISOString(),
      delivered: o.deliveredAt ? { by: o.deliveredByName!, at: o.deliveredAt.toISOString(), note: o.deliveryNote, invoice_no: o.invoiceNo } : null,
      versions,
      events: events.map((e) => ({ kind: e.kind as EventKind, version: e.version, text: e.text, invoice_no: e.invoiceNo, by: e.createdByName, at: e.createdAt.toISOString() })),
    };
  });
}

// ---------- the one rule for every change ----------
/**
 * Locks the order row for this transaction and checks it is still what the person saw; 409 if not. Then checks the
 * order is in a state this action allows.
 */
async function lockAsSeen(tx: OcTx, user: OcUser, id: string, expected: z.infer<typeof Expected>, allowed: OrderStatus) {
  const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id))).for("update");
  if (!o) throw notFound("Order not found");
  if (o.status !== expected.status || o.version !== expected.version) {
    const [last] = await tx.select({ by: orderEvents.createdByName }).from(orderEvents).where(and(eq(orderEvents.tenantId, user.tenantId), eq(orderEvents.orderId, id))).orderBy(desc(orderEvents.createdAt), desc(orderEvents.id)).limit(1);
    throw conflict(`This order was just changed by ${last?.by ?? "someone else"}. Please reload.`);
  }
  if (o.status !== allowed) throw conflict(`${formatRef(o.refNo)} is ${STATUS_WORD[o.status]}, so this can't be done.`);
  return o;
}

/** Writes a history event; returns its id (for the notification's dedupe key). */
async function event(tx: OcTx, user: OcUser, orderId: string, kind: EventKind, version: number, text: string | null = null, invoiceNo: string | null = null) {
  const [e] = await tx.insert(orderEvents).values({ tenantId: user.tenantId, orderId, kind, version, text, invoiceNo, createdBy: user.userId, createdByName: user.name }).returning({ id: orderEvents.id });
  return e!.id;
}

/** What a notification about this order needs (src/server/notify.ts). Never the customer's phone. */
export interface OrderEvent {
  order_id: string;
  ref: string;
  customer: string;
  place: string;
  entered_by: string;
  event_id: string;
  text: string | null;
}
const eventOf = (o: typeof orders.$inferSelect, eventId: string, text: string | null): OrderEvent => ({
  order_id: o.id,
  ref: formatRef(o.refNo),
  customer: o.customerName,
  place: o.customerPlace,
  entered_by: o.enteredBy,
  event_id: eventId,
  text,
});

async function act<T>(user: OcUser, action: Action, fn: (tx: OcTx) => Promise<T>) {
  requireAccess(user, action);
  return withTenant(user.tenantId, fn);
}

// ---------- Change (a new version of the lines) ----------
/**
 * Pending orders only. Products already in the order keep their saved name / unit (even if since switched off in
 * PlantOps); a product added now must be active. The same lines as now = nothing written (`changed: false`).
 */
export async function changeOrder(user: OcUser, id: string, input: z.infer<typeof ChangeInput>) {
  requireAccess(user, "enter");
  const products = new Map((await activeProducts(user.tenantId)).map((p) => [p.id, p]));
  return act(user, "enter", async (tx) => {
    const o = await lockAsSeen(tx, user, id, input.expected, "pending");
    const current = (await versionsOf(tx, user.tenantId, id)).find((v) => v.version === o.version)?.lines ?? [];
    const kept = new Map(current.map((l) => [l.sku_id, l]));
    const units = new Map((await effectiveRates(tx, user.tenantId, [...products.values()])).map((r) => [r.sku_id, r.unit]));
    const next = input.lines.map((l, i) => {
      const had = kept.get(l.sku_id);
      const p = products.get(l.sku_id);
      if (!had && !p) throw badRequest("One of the products is not an active product of this plant. Reload the page and try again.");
      const paise = lineTotal(l.quantity, l.rate);
      return { lineNo: i + 1, skuId: l.sku_id, productName: had?.product ?? productLabel(p!), unit: had?.unit ?? units.get(l.sku_id)!, quantity: l.quantity, rate: fromPaise(toPaise(l.rate)), paise };
    });
    const same = next.length === current.length && next.every((n, i) => current[i]!.sku_id === n.skuId && current[i]!.quantity === n.quantity && current[i]!.rate === n.rate);
    if (same) return { changed: false, version: o.version, total: o.total };
    const version = o.version + 1;
    const total = fromPaise(next.reduce((s, l) => s + l.paise, 0n));
    await tx.insert(orderLines).values(
      next.map((l) => ({ tenantId: user.tenantId, orderId: id, version, lineNo: l.lineNo, skuId: l.skuId, productName: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, lineTotal: fromPaise(l.paise) })),
    );
    await tx.update(orders).set({ version, total }).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id)));
    await event(tx, user, id, "changed", version);
    return { changed: true, version, total };
  });
}

// ---------- Mark delivered / Cancel / Undo delivered ----------
export async function deliverOrder(user: OcUser, id: string, input: z.infer<typeof DeliverInput>) {
  return act(user, "deliver", async (tx) => {
    const o = await lockAsSeen(tx, user, id, input.expected, "pending");
    const note = input.note || null;
    const invoice = input.invoice_no || null;
    const now = new Date();
    await tx
      .update(orders)
      .set({ status: "delivered", statusChangedAt: now, deliveredBy: user.userId, deliveredByName: user.name, deliveredAt: now, deliveryNote: note, invoiceNo: invoice })
      .where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id)));
    const eventId = await event(tx, user, id, "delivered", o.version, note, invoice);
    return { status: "delivered" as const, event: eventOf(o, eventId, note) };
  });
}

/** Final: a cancelled order is entered again if needed. */
export async function cancelOrder(user: OcUser, id: string, input: z.infer<typeof ReasonInput>) {
  return act(user, "cancel", async (tx) => {
    const o = await lockAsSeen(tx, user, id, input.expected, "pending");
    await tx.update(orders).set({ status: "cancelled", statusChangedAt: new Date() }).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id)));
    const eventId = await event(tx, user, id, "cancelled", o.version, input.reason);
    return { status: "cancelled" as const, event: eventOf(o, eventId, input.reason) };
  });
}

/** Owner only: back to Pending. The delivery's note / invoice no. stay in the "delivered" event. */
export async function undoDelivered(user: OcUser, id: string, input: z.infer<typeof ReasonInput>) {
  return act(user, "undo_delivered", async (tx) => {
    const o = await lockAsSeen(tx, user, id, input.expected, "delivered");
    await tx
      .update(orders)
      .set({ status: "pending", statusChangedAt: new Date(), deliveredBy: null, deliveredByName: null, deliveredAt: null, deliveryNote: null, invoiceNo: null })
      .where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, id)));
    await event(tx, user, id, "undelivered", o.version, input.reason);
    return { status: "pending" as const };
  });
}

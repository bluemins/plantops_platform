// Entering an order (docs/ORDER_CAPTURE_PHASE_PLAN.md "Entering an order"). Rules, checked here on the server:
//   * owner and Order desk only (access table "enter")
//   * the plant, who entered it, the reference, the status and every total come from the session and the server;
//     anything else the browser sends is dropped
//   * products are the plant's ACTIVE PlantOps products; none loadable = nothing saved
//   * ONE transaction under a per-plant lock: a repeated request key returns the same order (double tap, retry), a
//     new customer is created with the order, the reference is the plant's next number (O-0001…), lines version 1
//     and the "created" event are written together
//   * the order keeps copies of the customer and of each product's name / unit, so later edits never change it
//   * the WhatsApp bot's orders (bot.ts) go through the same `saveOrder`, with their own checks in front
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { productLabel } from "@plantops/module-kit";
import type { TenantSku } from "@plantops/types";
import { fromPaise, lineTotal } from "@/lib/money";
import { cleanNote, NOTE_MAX } from "@/lib/note";
import { RATE_RE } from "@/lib/rates";
import { formatRef } from "@/lib/ref";
import { clean, NAME_MAX, NAME_MIN, PHONE_TYPED_MAX, PLACE_MAX, PLACE_MIN } from "@/lib/upload";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { findByPhone, listCustomers } from "./customers";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, HttpError } from "./http";
import { activeProducts, effectiveRates } from "./rates";
import type { OcUser } from "./session";

const { customers, orders, orderLines, orderEvents } = schema;

export const LINES_MAX = 50;
export const QTY_MAX = 100_000;

// ---------- input ----------
const Line = z.object({
  sku_id: z.uuid("Please choose a product"),
  quantity: z.number("Quantity must be a whole number").int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(QTY_MAX, `Quantity can be at most ${QTY_MAX.toLocaleString("en-IN")}`),
  rate: z.string().trim().regex(RATE_RE, "Rate must be a number of rupees with at most 2 decimals, e.g. 90 or 92.50"),
});
/** An order's lines: the same rules for a new order and for a change. */
export const LinesInput = z
  .array(Line)
  .min(1, "Add at least one product")
  .max(LINES_MAX, `An order can have at most ${LINES_MAX} products`)
  .refine((ls) => new Set(ls.map((l) => l.sku_id)).size === ls.length, "Each product can be in the order only once");
/** Unknown fields (tenant_id, entered_by, ref_no, status, total…) are dropped: z.object strips them. */
export const OrderInput = z.object({
  request_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Please reload the page and try again"),
  customer: z.object({ phone: z.string().trim().max(PHONE_TYPED_MAX), name: z.string().optional(), place: z.string().optional() }),
  lines: LinesInput,
  note: z
    .string()
    .optional()
    .transform(cleanNote)
    .refine((n) => n === null || n.length <= NOTE_MAX, `A note has at most ${NOTE_MAX} characters`),
});

export interface SavedOrder {
  id: string;
  ref: string;
  created: boolean;
  status: string;
  customer: { name: string; place: string; phone: string };
  lines: { sku_id: string; product: string; unit: string; quantity: number; rate: string; total: string }[];
  total: string;
  note: string | null;
}

// ---------- the customer and their last rates (the form's lookup) ----------
/**
 * Each product's rate on this customer's latest non-cancelled order that had it (that order's current lines). Worked
 * out from the orders, never stored.
 */
export async function lastRates(tx: OcTx, tenantId: string, customerId: string): Promise<Record<string, string>> {
  const { rows } = await tx.execute<{ sku_id: string; rate: string }>(sql`
    select distinct on (l.sku_id) l.sku_id, l.rate::text as rate
      from ${orders} o
      join ${orderLines} l on l.order_id = o.id and l.version = o.version and l.tenant_id = o.tenant_id
     where o.tenant_id = ${tenantId} and o.customer_id = ${customerId} and o.status <> 'cancelled'
     order by l.sku_id, o.created_at desc, o.ref_no desc`);
  return Object.fromEntries(rows.map((r) => [r.sku_id, r.rate]));
}

/** The form asks this once the phone is a valid mobile: who is it, when did they last order, at what rates. */
/**
 * The order form's customer search (owner and Order desk): name, place or phone digits, switched-off customers
 * included (the form offers "Switch back on"); at most 8. Picking one fills in the phone, which then goes through
 * `lookupCustomer` as before.
 */
export async function searchForOrder(user: OcUser, q: string) {
  requireAccess(user, "enter");
  const text = q.trim();
  if (text.length < 2) return { customers: [], more: false };
  const { customers: found, more } = await listCustomers(user, { q: text, showOff: true, limit: 8 });
  return { customers: found, more };
}

export async function lookupCustomer(user: OcUser, typedPhone: string) {
  requireAccess(user, "enter");
  const phone = normalisePhone(typedPhone);
  if (!phone) throw badRequest("Enter a 10-digit mobile number");
  return withTenant(user.tenantId, async (tx) => {
    const c = await findByPhone(tx, user.tenantId, phone);
    if (!c) return { phone, customer: null, last_order_at: null, last_rates: {} as Record<string, string> };
    const [last] = await tx
      .select({ at: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.tenantId, user.tenantId), eq(orders.customerId, c.id), sql`${orders.status} <> 'cancelled'`))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return {
      phone,
      customer: { id: c.id, name: c.name, place: c.place, active: c.active },
      last_order_at: last?.at.toISOString() ?? null,
      last_rates: await lastRates(tx, user.tenantId, c.id),
    };
  });
}

// ---------- saving ----------
export async function savedView(tx: OcTx, tenantId: string, orderId: string, created: boolean): Promise<SavedOrder> {
  const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
  const lines = await tx
    .select()
    .from(orderLines)
    .where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId), eq(orderLines.version, o!.version)))
    .orderBy(orderLines.lineNo);
  return {
    id: o!.id,
    ref: formatRef(o!.refNo),
    created,
    status: o!.status,
    customer: { name: o!.customerName, place: o!.customerPlace, phone: o!.customerPhone },
    lines: lines.map((l) => ({ sku_id: l.skuId, product: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, total: l.lineTotal })),
    total: o!.total,
    note: o!.orderNote,
  };
}

const NewName = z.string().transform(clean).pipe(z.string().min(NAME_MIN, "Please enter the new customer's name (at least 2 letters)").max(NAME_MAX, `A name has at most ${NAME_MAX} characters`));
const NewPlace = z.string().transform(clean).pipe(z.string().min(PLACE_MIN, "Please enter the new customer's place (at least 2 letters)").max(PLACE_MAX, `A place has at most ${PLACE_MAX} characters`));

export async function createOrder(user: OcUser, input: z.infer<typeof OrderInput>): Promise<SavedOrder> {
  requireAccess(user, "enter");
  const phone = normalisePhone(input.customer.phone);
  if (!phone) throw badRequest("Enter the customer's 10-digit mobile number");

  const products = await activeProducts(user.tenantId);
  if (!products.length) throw new HttpError(503, "Products can't be loaded right now, try again");
  const known = new Set(products.map((p) => p.id));
  for (const l of input.lines) if (!known.has(l.sku_id)) throw badRequest("One of the products is not an active product of this plant. Reload the page and try again.");

  return saveOrder({
    tenantId: user.tenantId,
    by: { userId: user.userId, name: user.name },
    requestKey: input.request_key,
    products,
    lines: input.lines,
    note: input.note,
    // the customer: found by phone (used as is), or new with this order
    customer: async (tx, next) => {
      const found = await findByPhone(tx, user.tenantId, phone);
      if (found && !found.active) throw conflict(`${found.name} is switched off. Switch them back on first.`);
      if (found) return found;
      const name = NewName.safeParse(input.customer.name ?? "");
      if (!name.success) throw badRequest(name.error.issues[0]!.message);
      const place = NewPlace.safeParse(input.customer.place ?? "");
      if (!place.success) throw badRequest(place.error.issues[0]!.message);
      const [added] = await tx
        .insert(customers)
        .values({ tenantId: user.tenantId, name: name.data, phoneTyped: input.customer.phone, phone, place: place.data, createdBy: user.userId, createdByName: user.name })
        .returning();
      await audit(tx, user, "customer.add", added!.id, { name: added!.name, place: added!.place, phone, via: formatRef(next) });
      return added!;
    },
  });
}

/** Who saves an order: a staff member, or a WhatsApp bot key (its id, name "WhatsApp"). */
export interface OrderBy {
  userId: string;
  name: string;
}
type CustomerRow = typeof customers.$inferSelect;

/**
 * The one save behind every new order (staff form and WhatsApp bot), so both follow the same rules. The caller has
 * checked who may save and that every line's product is in `products` (the plant's active ones).
 *   * one transaction under a per-plant lock: a repeated request key returns that order (`repeat` may refuse it),
 *     the reference is the plant's next number, lines version 1 and the "created" event are written together
 *   * `customer` picks (or adds) the order's customer inside the transaction; `saved` adds rows of its own (audit)
 */
export async function saveOrder(o: {
  tenantId: string;
  by: OrderBy;
  requestKey: string;
  products: TenantSku[];
  lines: { sku_id: string; quantity: number; rate: string }[];
  note: string | null;
  customer: (tx: OcTx, nextRef: number) => Promise<CustomerRow>;
  repeat?: (tx: OcTx, enteredBy: string) => Promise<void>;
  saved?: (tx: OcTx, order: SavedOrder) => Promise<void>;
}): Promise<SavedOrder> {
  const bySku = new Map(o.products.map((p) => [p.id, p]));
  return withTenant(o.tenantId, async (tx) => {
    // one save at a time per plant: references stay unique and a repeated key can't slip in twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.order'), hashtext(${o.tenantId}))`);
    const [again] = await tx.select({ id: orders.id, enteredBy: orders.enteredBy }).from(orders).where(and(eq(orders.tenantId, o.tenantId), eq(orders.requestKey, o.requestKey)));
    if (again) {
      await o.repeat?.(tx, again.enteredBy);
      return savedView(tx, o.tenantId, again.id, false);
    }

    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${orders.refNo}), 0)::int + 1` }).from(orders).where(eq(orders.tenantId, o.tenantId))) as [{ next: number }];
    const customer = await o.customer(tx, next);

    const units = new Map((await effectiveRates(tx, o.tenantId, o.products)).map((r) => [r.sku_id, r.unit]));
    const lines = o.lines.map((l, i) => {
      const p = bySku.get(l.sku_id)!;
      return { lineNo: i + 1, skuId: l.sku_id, productName: productLabel(p), unit: units.get(l.sku_id)!, quantity: l.quantity, rate: fromPaise(lineTotal(1, l.rate)), paise: lineTotal(l.quantity, l.rate) };
    });
    const total = lines.reduce((s, l) => s + l.paise, 0n);

    const [row] = await tx
      .insert(orders)
      .values({
        tenantId: o.tenantId,
        refNo: next,
        requestKey: o.requestKey,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerPlace: customer.place,
        orderNote: o.note,
        total: fromPaise(total),
        enteredBy: o.by.userId,
        enteredByName: o.by.name,
      })
      .returning({ id: orders.id });
    await tx.insert(orderLines).values(
      lines.map((l) => ({ tenantId: o.tenantId, orderId: row!.id, version: 1, lineNo: l.lineNo, skuId: l.skuId, productName: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, lineTotal: fromPaise(l.paise) })),
    );
    await tx.insert(orderEvents).values({ tenantId: o.tenantId, orderId: row!.id, kind: "created", version: 1, createdBy: o.by.userId, createdByName: o.by.name });
    const saved = await savedView(tx, o.tenantId, row!.id, true);
    await o.saved?.(tx, saved);
    return saved;
  });
}

/** The products the order form offers (owner and Order desk): active ones, with unit and default rate. */
export async function formProducts(user: OcUser) {
  requireAccess(user, "enter");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, (tx) => effectiveRates(tx, user.tenantId, products));
}

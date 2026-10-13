// Entering an order (docs/ORDER_CAPTURE_PHASE_PLAN.md "Entering an order"). Rules, checked here on the server:
//   * owner and Order desk only (access table "enter")
//   * the plant, who entered it, the reference, the status and every total come from the session and the server;
//     anything else the browser sends is dropped
//   * products are the plant's ACTIVE PlantOps products; none loadable = nothing saved
//   * ONE transaction under a per-plant lock: a repeated request key returns the same order (double tap, retry), a
//     new customer is created with the order, the reference is the plant's next number (O-0001…), lines version 1
//     and the "created" event are written together
//   * the order keeps copies of the customer and of each product's name / unit, so later edits never change it
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { productLabel } from "@plantops/module-kit";
import { fromPaise, lineTotal } from "@/lib/money";
import { RATE_RE } from "@/lib/rates";
import { formatRef } from "@/lib/ref";
import { clean, NAME_MAX, NAME_MIN, PHONE_TYPED_MAX, PLACE_MAX, PLACE_MIN } from "@/lib/upload";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { findByPhone } from "./customers";
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
});

export interface SavedOrder {
  id: string;
  ref: string;
  created: boolean;
  customer: { name: string; place: string; phone: string };
  lines: { product: string; unit: string; quantity: number; rate: string; total: string }[];
  total: string;
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
async function savedView(tx: OcTx, tenantId: string, orderId: string, created: boolean): Promise<SavedOrder> {
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
    customer: { name: o!.customerName, place: o!.customerPlace, phone: o!.customerPhone },
    lines: lines.map((l) => ({ product: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, total: l.lineTotal })),
    total: o!.total,
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
  const bySku = new Map(products.map((p) => [p.id, p]));
  for (const l of input.lines) if (!bySku.has(l.sku_id)) throw badRequest("One of the products is not an active product of this plant. Reload the page and try again.");

  return withTenant(user.tenantId, async (tx) => {
    // one save at a time per plant: references stay unique and a repeated key can't slip in twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.order'), hashtext(${user.tenantId}))`);
    const [again] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.requestKey, input.request_key)));
    if (again) return savedView(tx, user.tenantId, again.id, false);

    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${orders.refNo}), 0)::int + 1` }).from(orders).where(eq(orders.tenantId, user.tenantId))) as [{ next: number }];

    // the customer: found by phone (used as is), or new with this order
    let customer = await findByPhone(tx, user.tenantId, phone);
    if (customer && !customer.active) throw conflict(`${customer.name} is switched off. Switch them back on first.`);
    if (!customer) {
      const name = NewName.safeParse(input.customer.name ?? "");
      if (!name.success) throw badRequest(name.error.issues[0]!.message);
      const place = NewPlace.safeParse(input.customer.place ?? "");
      if (!place.success) throw badRequest(place.error.issues[0]!.message);
      const [added] = await tx
        .insert(customers)
        .values({ tenantId: user.tenantId, name: name.data, phoneTyped: input.customer.phone, phone, place: place.data, createdBy: user.userId, createdByName: user.name })
        .returning();
      customer = added!;
      await audit(tx, user, "customer.add", customer!.id, { name: customer!.name, place: customer!.place, phone, via: formatRef(next) });
    }

    const units = new Map((await effectiveRates(tx, user.tenantId, products)).map((r) => [r.sku_id, r.unit]));
    const lines = input.lines.map((l, i) => {
      const p = bySku.get(l.sku_id)!;
      return { lineNo: i + 1, skuId: l.sku_id, productName: productLabel(p), unit: units.get(l.sku_id)!, quantity: l.quantity, rate: fromPaise(lineTotal(1, l.rate)), paise: lineTotal(l.quantity, l.rate) };
    });
    const total = lines.reduce((s, l) => s + l.paise, 0n);

    const [o] = await tx
      .insert(orders)
      .values({
        tenantId: user.tenantId,
        refNo: next,
        requestKey: input.request_key,
        customerId: customer!.id,
        customerName: customer!.name,
        customerPhone: customer!.phone,
        customerPlace: customer!.place,
        total: fromPaise(total),
        enteredBy: user.userId,
        enteredByName: user.name,
      })
      .returning({ id: orders.id });
    await tx.insert(orderLines).values(
      lines.map((l) => ({ tenantId: user.tenantId, orderId: o!.id, version: 1, lineNo: l.lineNo, skuId: l.skuId, productName: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, lineTotal: fromPaise(l.paise) })),
    );
    await tx.insert(orderEvents).values({ tenantId: user.tenantId, orderId: o!.id, kind: "created", version: 1, createdBy: user.userId, createdByName: user.name });
    return savedView(tx, user.tenantId, o!.id, true);
  });
}

/** The products the order form offers (owner and Order desk): active ones, with unit and default rate. */
export async function formProducts(user: OcUser) {
  requireAccess(user, "enter");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, (tx) => effectiveRates(tx, user.tenantId, products));
}

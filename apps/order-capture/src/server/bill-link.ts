// Link bills to orders (owner 2026-11-10; rules in src/lib/bill-link.ts; docs/REPORTS_PHASE_PLAN.md section 8). Owner
// only (PlantOps support sees the list). Only bills imported from Zoho are linked or unlinked here: a PlantOps bill is
// always made from its order (to undo one, cancel the bill). Each link / unlink is one audit row (Recent changes).
// The database allows it already (order_app may UPDATE bills.order_id); one live bill per order is a unique index.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { linkRows, type LinkBill, type LinkOrder } from "@/lib/bill-link";
import { paise } from "@/lib/ledger";
import { orderRef } from "@/lib/order-flow";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const OPEN_BILLS = sql`
  b.source = 'zoho' and b.cancelled_at is null and b.order_id is null and coalesce(b.zoho_invoice_id, '') not like 'ob:%'`;

async function unlinkedOrders(tx: OcTx, tenantId: string, orderId?: string): Promise<LinkOrder[]> {
  const { rows } = await tx.execute<{ id: string; ref_no: number; customer_id: string; customer_name: string; place: string | null; total: string; delivered: string }>(sql`
    select o.id, o.ref_no, o.customer_id, coalesce(cu.name, o.customer_name) as customer_name, coalesce(cu.place, o.customer_place) as place,
           o.total::text, (o.delivered_at at time zone 'Asia/Kolkata')::date::text as delivered
      from order_capture.orders o
      left join order_capture.customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
     where o.tenant_id = ${tenantId} and o.status = 'delivered'
       ${orderId ? sql`and o.id = ${orderId}` : sql``}
       and not exists (select 1 from order_capture.bills x where x.tenant_id = o.tenant_id and x.order_id = o.id and x.cancelled_at is null)`);
  return rows.map((r) => ({ ...r, total: paise(r.total) }));
}

async function openBills(tx: OcTx, tenantId: string, number?: string): Promise<LinkBill[]> {
  const { rows } = await tx.execute<{ id: string; number: string; bill_date: string; total: string; customer_id: string | null; customer_name: string }>(sql`
    select b.id, b.number, b.bill_date::text, b.total::text, coalesce(b.customer_id, zc.customer_id) as customer_id,
           coalesce(cu.name, zc.name, b.customer_name) as customer_name
      from order_capture.bills b
      left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
      left join order_capture.customers cu on cu.tenant_id = b.tenant_id and cu.id = coalesce(b.customer_id, zc.customer_id)
     where b.tenant_id = ${tenantId} and ${OPEN_BILLS}
       ${number ? sql`and upper(b.number) = upper(${number})` : sql``}`);
  return rows.map((r) => ({ ...r, total: paise(r.total) }));
}

/** Owner (support reads): every delivered order without a bill, with suggested bills and the sure matches. */
export async function linkList(user: OcUser) {
  requireAccess(user, "bill_link_view");
  return withTenant(user.tenantId, async (tx) => linkRows(await unlinkedOrders(tx, user.tenantId), await openBills(tx, user.tenantId)));
}

/** Owner: the suggestions for one order (its page), or null when it is not a delivered order without a bill. */
export async function linkSuggestions(user: OcUser, orderId: string) {
  requireAccess(user, "bill_link");
  return withTenant(user.tenantId, async (tx) => {
    const [o] = await unlinkedOrders(tx, user.tenantId, orderId);
    return o ? linkRows([o], await openBills(tx, user.tenantId))[0]! : null;
  });
}

export const LinkInput = z
  .object({ bill_id: z.uuid().optional(), number: z.string().trim().min(1).max(40).optional() })
  .refine((v) => !!v.bill_id !== !!v.number, "Give the bill or its number");

/** Link one Zoho bill (by id, or by its number) to one delivered order that has no bill. */
async function linkOne(tx: OcTx, user: OcUser, orderId: string, pick: { bill_id?: string; number?: string }) {
  const { rows: os } = await tx.execute<{ ref_no: number; status: string; customer_name: string }>(sql`
    select ref_no, status, customer_name from order_capture.orders where tenant_id = ${user.tenantId} and id = ${orderId} for update`);
  const o = os[0];
  if (!o) throw notFound("Order not found");
  if (o.status !== "delivered") throw conflict(`${orderRef(o.ref_no)} is not delivered, so it can't have a bill.`);
  const { rows: has } = await tx.execute<{ number: string }>(sql`
    select number from order_capture.bills where tenant_id = ${user.tenantId} and order_id = ${orderId} and cancelled_at is null`);
  if (has[0]) throw conflict(`${orderRef(o.ref_no)} already has bill ${has[0].number}.`);
  const { rows: bs } = await tx.execute<{ id: string; number: string; source: string; order_id: string | null; cancelled: boolean; ob: boolean; customer_name: string; total: string }>(sql`
    select id, number, source, order_id, cancelled_at is not null as cancelled, coalesce(zoho_invoice_id, '') like 'ob:%' as ob, customer_name, total::text
      from order_capture.bills
     where tenant_id = ${user.tenantId} and ${pick.bill_id ? sql`id = ${pick.bill_id}` : sql`upper(number) = upper(${pick.number!})`}
     for update`);
  const b = bs[0];
  if (!b) throw notFound(pick.number ? `No bill ${pick.number}` : "Bill not found");
  if (b.cancelled) throw conflict(`${b.number} is cancelled.`);
  if (b.ob) throw badRequest(`${b.number} is an opening balance, not a bill for an order.`);
  if (b.source !== "zoho") throw badRequest(`${b.number} was made in PlantOps from its own order; only bills imported from Zoho are linked here.`);
  if (b.order_id) throw conflict(`${b.number} is already linked to another order.`);
  await tx.execute(sql`update order_capture.bills set order_id = ${orderId} where tenant_id = ${user.tenantId} and id = ${b.id}`);
  await audit(tx, user, "bill.link", b.id, { order: orderRef(o.ref_no), order_id: orderId, number: b.number, customer: o.customer_name, bill_customer: b.customer_name, total: b.total });
  return { order: orderRef(o.ref_no), number: b.number };
}

/** Owner: link a bill to a delivered order. */
export async function linkBill(user: OcUser, orderId: string, input: z.infer<typeof LinkInput>) {
  requireAccess(user, "bill_link");
  return withTenant(user.tenantId, (tx) => linkOne(tx, user, orderId, input));
}

export const SureInput = z.object({ pairs: z.array(z.object({ order_id: z.uuid(), bill_id: z.uuid() })).min(1).max(500) });

/**
 * Owner: link the sure matches the screen showed. Each pair is checked again: only pairs that are still a sure match are
 * linked (in one go); the rest are left for the owner and counted.
 */
export async function linkSure(user: OcUser, input: z.infer<typeof SureInput>) {
  requireAccess(user, "bill_link");
  return withTenant(user.tenantId, async (tx) => {
    const now = linkRows(await unlinkedOrders(tx, user.tenantId), await openBills(tx, user.tenantId));
    const sure = new Map(now.filter((r) => r.sure).map((r) => [r.order.id, r.sure!.id]));
    let linked = 0;
    for (const p of input.pairs) {
      if (sure.get(p.order_id) !== p.bill_id) continue;
      await linkOne(tx, user, p.order_id, { bill_id: p.bill_id });
      linked++;
    }
    return { linked, skipped: input.pairs.length - linked };
  });
}

export const UnlinkInput = z.object({ reason: z.string().trim().min(3, "Reason: at least 3 letters").max(300) });

/** Owner: take a wrongly linked Zoho bill off an order (the order shows "Delivered, not billed" again). */
export async function unlinkBill(user: OcUser, orderId: string, input: z.infer<typeof UnlinkInput>) {
  requireAccess(user, "bill_link");
  return withTenant(user.tenantId, async (tx) => {
    const { rows } = await tx.execute<{ id: string; number: string; source: string; ref_no: number; customer_name: string }>(sql`
      select b.id, b.number, b.source, o.ref_no, o.customer_name
        from order_capture.bills b
        join order_capture.orders o on o.tenant_id = b.tenant_id and o.id = b.order_id
       where b.tenant_id = ${user.tenantId} and b.order_id = ${orderId} and b.cancelled_at is null
       for update of b`);
    const b = rows[0];
    if (!b) throw notFound("This order has no bill linked");
    if (b.source !== "zoho") throw badRequest(`${b.number} was made in PlantOps from this order; cancel the bill instead.`);
    await tx.execute(sql`update order_capture.bills set order_id = null where tenant_id = ${user.tenantId} and id = ${b.id}`);
    await audit(tx, user, "bill.unlink", b.id, { order: orderRef(b.ref_no), order_id: orderId, number: b.number, customer: b.customer_name, reason: input.reason });
    return { order: orderRef(b.ref_no), number: b.number };
  });
}

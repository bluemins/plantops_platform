// The order list (home page) and the owner's CSV export. Rules:
//   * read: owner, Order desk, PlantOps support; one plant only (row-level security + tenant filter)
//   * Pending oldest first; Delivered / Cancelled newest first (by when that happened)
//   * search: "O-0042" / "42" = a reference, 3+ digits = part of the phone, otherwise name or place (any case)
//   * the CSV: one row per line of each order's CURRENT version; formulas neutralised; audited
import { and, asc, desc, eq, ilike, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { normalisePhone } from "@plantops/module-kit/phone";
import { ageOf, type LineView } from "@/lib/history";
import { formatRef } from "@/lib/ref";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant } from "./db";
import type { OrderStatus } from "./schema";
import type { OcUser } from "./session";

const { orders, orderLines } = schema;

export type Tab = OrderStatus;
export const TABS: [Tab, string][] = [
  ["pending", "Pending"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];
export interface ListFilters {
  tab?: Tab;
  q?: string;
  /** YYYY-MM-DD, India date the order was entered */
  from?: string;
  to?: string;
}
export interface ListRow {
  id: string;
  ref: string;
  status: OrderStatus;
  customer: string;
  place: string;
  entered_by: string;
  note: string | null;
  lines: LineView[];
  total: string;
  created_at: string;
  status_changed_at: string;
  /** pending only: "Today", "1 day", "3 days" and amber from 2 days */
  age: { days: number; amber: boolean; text: string } | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const istDay = sql`(${orders.createdAt} at time zone 'Asia/Kolkata')::date`;

function searchWhere(q: string): SQL | undefined {
  const text = q.trim();
  if (!text) return undefined;
  const conds: SQL[] = [];
  const ref = /^(?:o\s*-?\s*)?0*(\d{1,7})$/i.exec(text);
  if (ref && (/^o/i.test(text) || text.length <= 6)) conds.push(eq(orders.refNo, Number(ref[1])));
  // a whole number typed with +91 / 0 is the customer's 10 digits; otherwise any 3+ digits are part of the phone
  const digits = normalisePhone(text) ?? text.replace(/\D/g, "");
  if (digits.length >= 3 && /^[\d\s+()-]+$/.test(text)) conds.push(like(orders.customerPhone, `%${digits}%`));
  const pattern = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  conds.push(ilike(orders.customerName, pattern), ilike(orders.customerPlace, pattern));
  return or(...conds);
}

export async function listOrders(user: OcUser, f: ListFilters = {}, now = Date.now(), limit = 200) {
  requireAccess(user, "read");
  const tab = f.tab ?? "pending";
  return withTenant(user.tenantId, async (tx) => {
    const where = [eq(orders.tenantId, user.tenantId), eq(orders.status, tab)];
    const s = searchWhere(f.q ?? "");
    if (s) where.push(s);
    if (f.from && YMD.test(f.from)) where.push(sql`${istDay} >= ${f.from}::date`);
    if (f.to && YMD.test(f.to)) where.push(sql`${istDay} <= ${f.to}::date`);
    const rows = await tx
      .select()
      .from(orders)
      .where(and(...where))
      .orderBy(...(tab === "pending" ? [asc(orders.createdAt), asc(orders.refNo)] : [desc(orders.statusChangedAt), desc(orders.refNo)]))
      .limit(limit + 1);
    const shown = rows.slice(0, limit);
    const lines = shown.length
      ? await tx
          .select({ orderId: orderLines.orderId, version: orderLines.version, l: orderLines })
          .from(orderLines)
          .where(and(eq(orderLines.tenantId, user.tenantId), inArray(orderLines.orderId, shown.map((o) => o.id))))
          .orderBy(asc(orderLines.lineNo))
      : [];
    const list: ListRow[] = shown.map((o) => ({
      id: o.id,
      ref: formatRef(o.refNo),
      status: o.status,
      customer: o.customerName,
      place: o.customerPlace,
      entered_by: o.enteredByName,
      note: o.orderNote,
      lines: lines
        .filter((x) => x.orderId === o.id && x.version === o.version)
        .map(({ l }) => ({ sku_id: l.skuId, product: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, total: l.lineTotal })),
      total: o.total,
      created_at: o.createdAt.toISOString(),
      status_changed_at: o.statusChangedAt.toISOString(),
      age: o.status === "pending" ? ageOf(o.createdAt, now) : null,
    }));
    return { orders: list, more: rows.length > limit };
  });
}

/** How many orders are in each tab (the whole plant, not the search). */
export async function tabCounts(user: OcUser): Promise<Record<Tab, number>> {
  requireAccess(user, "read");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.tenantId, user.tenantId)).groupBy(orders.status);
    const counts = { pending: 0, delivered: 0, cancelled: 0 };
    for (const r of rows) counts[r.status] = r.n;
    return counts;
  });
}

export interface PendingSummary {
  orders: number;
  total: string;
  /** one row per product and unit, biggest amount first */
  products: { sku_id: string; product: string; unit: string; quantity: number; orders: number; min_rate: string; max_rate: string; amount: string }[];
}

/**
 * Owner: every pending order of the plant added up (not the search), from each order's CURRENT lines. Worked out
 * when the page opens, never stored. A product's name is the one on its newest order; rates differ per customer,
 * so the lowest and highest are given.
 */
export async function pendingSummary(user: OcUser): Promise<PendingSummary> {
  requireAccess(user, "pending_summary");
  return withTenant(user.tenantId, async (tx) => {
    const [head] = (
      await tx.execute<{ orders: number; total: string }>(sql`
        select count(*)::int as orders, coalesce(sum(total), 0)::text as total
          from ${orders} where tenant_id = ${user.tenantId} and status = 'pending'`)
    ).rows;
    const { rows } = await tx.execute<PendingSummary["products"][number]>(sql`
      select l.sku_id,
             (array_agg(l.product_name order by o.created_at desc))[1] as product,
             l.unit,
             sum(l.quantity)::int as quantity,
             count(distinct o.id)::int as orders,
             min(l.rate)::text as min_rate,
             max(l.rate)::text as max_rate,
             sum(l.line_total)::text as amount
        from ${orders} o
        join ${orderLines} l on l.order_id = o.id and l.version = o.version and l.tenant_id = o.tenant_id
       where o.tenant_id = ${user.tenantId} and o.status = 'pending'
       group by l.sku_id, l.unit
       order by sum(l.line_total) desc, 2`);
    return { orders: head!.orders, total: head!.total, products: rows };
  });
}

const STATUS_TEXT: Record<OrderStatus, string> = { pending: "Pending", delivered: "Delivered", cancelled: "Cancelled" };

/** Owner: every order, one row per line of its current version (opens in Excel; formulas neutralised; audited). */
export async function exportCsv(user: OcUser) {
  requireAccess(user, "export");
  return withTenant(user.tenantId, async (tx) => {
    const os = await tx.select().from(orders).where(eq(orders.tenantId, user.tenantId)).orderBy(asc(orders.refNo));
    const ls = await tx.select().from(orderLines).where(eq(orderLines.tenantId, user.tenantId)).orderBy(asc(orderLines.lineNo));
    const rows: unknown[][] = [];
    for (const o of os) {
      for (const l of ls.filter((x) => x.orderId === o.id && x.version === o.version)) {
        rows.push([
          formatRef(o.refNo),
          csvTime(o.createdAt),
          o.enteredByName,
          o.customerName,
          o.customerPhone,
          o.customerPlace,
          o.orderNote ?? "",
          STATUS_TEXT[o.status],
          csvTime(o.statusChangedAt),
          o.deliveredByName ?? "",
          o.deliveredAt ? csvTime(o.deliveredAt) : "",
          o.deliveryNote ?? "",
          o.invoiceNo ?? "",
          o.version,
          l.productName,
          l.unit,
          l.quantity,
          l.rate,
          l.lineTotal,
          o.total,
        ]);
      }
    }
    await audit(tx, user, "export.csv", null, { orders: os.length, lines: rows.length });
    return csv([
      ["Reference", "Entered at", "Entered by", "Customer", "Phone", "Place", "Order note", "Status", "Status changed at", "Delivered by", "Delivered at", "Delivery note", "Zoho invoice no.", "Version", "Product", "Unit", "Quantity", "Rate", "Line total", "Order total"],
      ...rows,
    ]);
  });
}

// The order list (home page) and the owner's CSV export. Rules:
//   * read: owner, Order desk, plant staff (view only), PlantOps support; one plant only (row-level security + tenant
//     filter); amounts only for people who may see them (never plant staff: removed here, not just hidden on screen)
//   * Pending oldest first; Delivered / Cancelled newest first (by when that happened)
//   * dates: Pending by the day entered; Delivered / Cancelled by the day delivered / cancelled
//   * search: "O-0042" / "42" = a reference, 3+ digits = part of the phone, otherwise name or place (any case)
//   * brand tags: per product, the owner's (Rates) or guessed from the name; ?brand= shows orders with that brand
//   * the CSV: one row per line of each order's CURRENT version; formulas neutralised; audited
import { and, asc, desc, eq, ilike, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { normalisePhone } from "@plantops/module-kit/phone";
import { effectiveBrand } from "@/lib/brand";
import { ageOf, withoutAmounts, type LineView } from "@/lib/history";
import { fromPaise, toPaise, unitsText } from "@/lib/money";
import { formatRef } from "@/lib/ref";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import type { OrderStatus } from "./schema";
import type { OcUser } from "./session";

const { orders, orderLines, productRates } = schema;

export type Tab = OrderStatus;
export const TABS: [Tab, string][] = [
  ["pending", "Pending"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];
export interface ListFilters {
  tab?: Tab;
  q?: string;
  /** YYYY-MM-DD, India date: entered (Pending), delivered (Delivered) or cancelled (Cancelled) */
  from?: string;
  to?: string;
  /** one brand's orders only (an order with any of its products) */
  brand?: string;
}
export interface ListRow {
  id: string;
  ref: string;
  status: OrderStatus;
  customer: string;
  /** the customer's 10 digits */
  phone: string;
  place: string;
  entered_by: string;
  note: string | null;
  /** the brands of its current lines, in line order */
  brands: string[];
  lines: LineView[];
  /** null = hidden from this person */
  total: string | null;
  created_at: string;
  status_changed_at: string;
  /** delivered orders whose bill is fully paid show "Closed" (sales ledger); only for people who see amounts */
  closed?: boolean;
  /** pending only: "Today", "1 day", "3 days" and amber from 2 days */
  age: { days: number; amber: boolean; text: string } | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** the India date the dates filter uses: when the order was entered, or when it was delivered / cancelled */
const istDay = (tab: Tab) => sql`(${tab === "pending" ? orders.createdAt : orders.statusChangedAt} at time zone 'Asia/Kolkata')::date`;
/** the From label on each tab, so it is clear which date the filter uses */
export const DATE_LABEL: Record<Tab, string> = { pending: "Entered from", delivered: "Delivered from", cancelled: "Cancelled from" };

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

/**
 * The brand of every product this plant ever ordered ("" = no brand): the owner's from Rates, else guessed from the
 * product's newest name on an order. Per product, so a tag and the brand chips always agree.
 */
export async function brandsBySku(tx: OcTx, tenantId: string): Promise<Map<string, string>> {
  const saved = new Map((await tx.select({ skuId: productRates.skuId, brand: productRates.brand }).from(productRates).where(eq(productRates.tenantId, tenantId))).map((r) => [r.skuId, r.brand]));
  const { rows } = await tx.execute<{ sku_id: string; product: string }>(sql`
    select l.sku_id, (array_agg(l.product_name order by o.created_at desc))[1] as product
      from ${orders} o
      join ${orderLines} l on l.order_id = o.id and l.tenant_id = o.tenant_id
     where o.tenant_id = ${tenantId}
     group by l.sku_id`);
  return new Map(rows.map((r) => [r.sku_id, effectiveBrand(saved.get(r.sku_id), r.product)]));
}

const brandList = (bySku: Map<string, string>) => [...new Set([...bySku.values()].filter(Boolean))].sort((a, b) => a.localeCompare(b));

export async function listOrders(user: OcUser, f: ListFilters = {}, now = Date.now(), limit = 200) {
  requireAccess(user, "read");
  const amounts = can(user, "see_amounts");
  const tab = f.tab ?? "pending";
  return withTenant(user.tenantId, async (tx) => {
    const bySku = await brandsBySku(tx, user.tenantId);
    const where = [eq(orders.tenantId, user.tenantId), eq(orders.status, tab)];
    if (f.brand) {
      const skus = [...bySku].filter(([, b]) => b === f.brand).map(([id]) => sql`${id}::uuid`);
      where.push(
        skus.length
          ? sql`exists (select 1 from ${orderLines} bl where bl.tenant_id = ${orders.tenantId} and bl.order_id = ${orders.id} and bl.version = ${orders.version} and bl.sku_id in (${sql.join(skus, sql`, `)}))`
          : sql`false`,
      );
    }
    const s = searchWhere(f.q ?? "");
    if (s) where.push(s);
    if (f.from && YMD.test(f.from)) where.push(sql`${istDay(tab)} >= ${f.from}::date`);
    if (f.to && YMD.test(f.to)) where.push(sql`${istDay(tab)} <= ${f.to}::date`);
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
    // delivered orders whose bill (not cancelled) is fully paid: "Closed"
    const closedIds = new Set<string>();
    if (amounts && tab === "delivered" && shown.length) {
      const ids = shown.map((o) => sql`${o.id}::uuid`);
      const r = await tx.execute<{ order_id: string }>(sql`
        select b.order_id from order_capture.bills b
         where b.tenant_id = ${user.tenantId} and b.cancelled_at is null and b.order_id in (${sql.join(ids, sql`, `)})
           and b.total - coalesce((select sum(a.amount) from order_capture.payment_allocations a where a.bill_id = b.id), 0)
                       - coalesce((select sum(x.amount) from order_capture.bill_adjustments x where x.bill_id = b.id), 0) <= 0`);
      for (const x of r.rows) closedIds.add(x.order_id);
    }
    const list: ListRow[] = shown.map((o) => {
      const current: LineView[] = lines
        .filter((x) => x.orderId === o.id && x.version === o.version)
        .map(({ l }) => ({ sku_id: l.skuId, product: l.productName, unit: l.unit, quantity: l.quantity, rate: l.rate, total: l.lineTotal }));
      return {
        id: o.id,
        ref: formatRef(o.refNo),
        status: o.status,
        customer: o.customerName,
        phone: o.customerPhone,
        place: o.customerPlace,
        entered_by: o.enteredByName,
        note: o.orderNote,
        brands: [...new Set(current.map((l) => bySku.get(l.sku_id) ?? "").filter(Boolean))],
        lines: amounts ? current : withoutAmounts(current),
        total: amounts ? o.total : null,
        created_at: o.createdAt.toISOString(),
        status_changed_at: o.statusChangedAt.toISOString(),
        age: o.status === "pending" ? ageOf(o.createdAt, now) : null,
        ...(closedIds.has(o.id) ? { closed: true } : {}),
      };
    });
    return { orders: list, more: rows.length > limit, brands: brandList(bySku) };
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
  /** one row per brand ("" = products with no brand), biggest amount first; empty when no product has a brand */
  brands: { brand: string; orders: number; units: string; amount: string }[];
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
    const bySku = await brandsBySku(tx, user.tenantId);
    const { rows: lines } = await tx.execute<{ order_id: string; sku_id: string; unit: string; quantity: number; line_total: string }>(sql`
      select o.id as order_id, l.sku_id, l.unit, l.quantity, l.line_total::text
        from ${orders} o
        join ${orderLines} l on l.order_id = o.id and l.version = o.version and l.tenant_id = o.tenant_id
       where o.tenant_id = ${user.tenantId} and o.status = 'pending'`);
    const per = new Map<string, { orders: Set<string>; lines: { quantity: number; unit: string }[]; paise: bigint }>();
    for (const l of lines) {
      const b = bySku.get(l.sku_id) ?? "";
      const row = per.get(b) ?? { orders: new Set(), lines: [], paise: 0n };
      row.orders.add(l.order_id);
      row.lines.push(l);
      row.paise += toPaise(l.line_total);
      per.set(b, row);
    }
    const brands = [...per]
      .sort(([a, x], [b, y]) => (x.paise === y.paise ? a.localeCompare(b) : x.paise > y.paise ? -1 : 1))
      .map(([brand, r]) => ({ brand, orders: r.orders.size, units: unitsText(r.lines), amount: fromPaise(r.paise) }));
    return { orders: head!.orders, total: head!.total, products: rows, brands: brands.some((b) => b.brand) ? brands : [] };
  });
}

const STATUS_TEXT: Record<OrderStatus, string> = { pending: "Pending", delivered: "Delivered", cancelled: "Cancelled" };

/** Owner: every order, one row per line of its current version (opens in Excel; formulas neutralised; audited). */
export async function exportCsv(user: OcUser) {
  requireAccess(user, "export");
  return withTenant(user.tenantId, async (tx) => {
    const os = await tx.select().from(orders).where(eq(orders.tenantId, user.tenantId)).orderBy(asc(orders.refNo));
    const ls = await tx.select().from(orderLines).where(eq(orderLines.tenantId, user.tenantId)).orderBy(asc(orderLines.lineNo));
    const bySku = await brandsBySku(tx, user.tenantId);
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
          bySku.get(l.skuId) ?? "",
        ]);
      }
    }
    await audit(tx, user, "export.csv", null, { orders: os.length, lines: rows.length });
    return csv([
      ["Reference", "Entered at", "Entered by", "Customer", "Phone", "Place", "Order note", "Status", "Status changed at", "Delivered by", "Delivered at", "Delivery note", "Zoho invoice no.", "Version", "Product", "Unit", "Quantity", "Rate", "Line total", "Order total", "Brand"],
      ...rows,
    ]);
  });
}

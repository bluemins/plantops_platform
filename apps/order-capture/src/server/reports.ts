// Reports (docs/REPORTS_PHASE_PLAN.md): reads the bill lines of a period (PlantOps + imported Zoho bills; cancelled and
// opening-balance bills left out) and builds Sales by Item / Sales by Customer with src/lib/report.ts. Owner only
// (PlantOps support reads). Nothing is stored.
import { sql } from "drizzle-orm";
import {
  BREAKDOWNS,
  buildReport,
  GROUPS,
  PERIODS,
  periodDates,
  qtyOf,
  type Breakdown,
  type Group,
  type Period,
  type ReportKind,
  type SalesLine,
} from "@/lib/report";
import { paise } from "@/lib/ledger";
import {
  AS_OFS,
  asOfDate,
  agingDetails,
  agingSummary,
  BILL_SHOWS,
  billDetails,
  customerBalances,
  GROUPS_FOR,
  recChoices,
  type AsOf,
  type Basis,
  type BillShow,
  type Interval,
  type RecData,
  type RecGroup,
  type RecKind,
  type Show,
} from "@/lib/receivables";
import {
  flowChoices,
  flowDates,
  flowRows,
  FLOW_PERIODS,
  FLOW_STAGES,
  sortRows,
  stageSums,
  type FlowFilter,
  type FlowOrder,
  type FlowStage,
} from "@/lib/order-flow";
import { effectiveBrand } from "@/lib/brand";
import { requireAccess } from "./access";
import { withTenant } from "./db";
import { kit } from "./kit";
import { istToday } from "./ledger";
import type { OcUser } from "./session";

export type ReportParams = {
  period: Period;
  from: string;
  to: string;
  breakdown: Breakdown;
  group: Group;
  amount: "before" | "with";
  salesperson: string;
  place: string;
  vehicle: string;
};

const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** The report's settings from the address (?period=prev_month&breakdown=month…); anything unknown falls back. */
export function readParams(q: Record<string, string | undefined>, today = istToday()): ReportParams {
  const period = pick(PERIODS, q.period, "prev_month");
  const { from, to } = periodDates(period, today, { from: q.from, to: q.to });
  return {
    period,
    from,
    to,
    breakdown: pick(BREAKDOWNS, q.breakdown, "none"),
    group: pick(GROUPS, q.group, "none"),
    amount: q.amount === "with" ? "with" : "before",
    salesperson: (q.salesperson ?? "").slice(0, 100),
    place: (q.place ?? "").slice(0, 200),
    vehicle: (q.vehicle ?? "").slice(0, 30),
  };
}

/** Every bill line from `from` to `to`, as the report rules want them. */
async function salesLines(tenantId: string, from: string, to: string): Promise<SalesLine[]> {
  const products = new Map((await kit.products(tenantId)).map((p) => [p.id, p]));
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{
      bill_id: string; bill_date: string; salesperson: string | null; vehicle: string | null; customer_key: string; customer_name: string;
      place: string | null; brand: string | null; sku_id: string | null; item_name: string; sku_code: string | null; qty: string; before: string; with_gst: string; free: boolean;
    }>(sql`
      select b.id as bill_id, b.bill_date::text, b.salesperson, b.vehicle,
             coalesce('c:' || cu.id::text, 'z:' || zc.id::text, 'n:' || lower(b.customer_name)) as customer_key,
             coalesce(cu.name, zc.name, b.customer_name) as customer_name,
             cu.place, pr.brand, l.sku_id, l.item_name, l.sku_code, l.quantity::text as qty, l.free,
             coalesce(l.taxable, l.line_total)::text as before,
             (coalesce(l.taxable, l.line_total) + l.tax_amount)::text as with_gst
        from order_capture.bills b
        join order_capture.bill_lines l on l.tenant_id = b.tenant_id and l.bill_id = b.id
        left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
        left join order_capture.customers cu on cu.tenant_id = b.tenant_id and cu.id = coalesce(b.customer_id, zc.customer_id)
        left join order_capture.product_rates pr on pr.tenant_id = b.tenant_id and pr.sku_id = l.sku_id
       where b.tenant_id = ${tenantId}
         and b.cancelled_at is null
         and coalesce(b.zoho_invoice_id, '') not like 'ob:%'
         and b.bill_date between ${from}::date and ${to}::date`);
    return rows.map((r) => {
      const p = r.sku_id ? products.get(r.sku_id) : undefined;
      return {
        bill_id: r.bill_id,
        bill_date: r.bill_date,
        salesperson: r.salesperson,
        customer_key: r.customer_key,
        customer_name: r.customer_name,
        place: r.place,
        vehicle: r.vehicle,
        brand: r.brand,
        // one row per PlantOps product (Zoho's two names for one code count as one); else by Zoho's name
        item_key: r.sku_id ? `s:${r.sku_id}` : `n:${r.item_name.toLowerCase()}`,
        item_name: p?.name ?? r.item_name,
        sku: p?.sku_code ?? r.sku_code,
        qty: qtyOf(r.qty),
        before: paise(r.before),
        with_gst: paise(r.with_gst),
        free: r.free,
      };
    });
  });
}

export async function salesReport(user: OcUser, kind: ReportKind, p: ReportParams) {
  requireAccess(user, "reports");
  const lines = await salesLines(user.tenantId, p.from, p.to);
  return buildReport(lines, {
    kind,
    from: p.from,
    to: p.to,
    breakdown: p.breakdown,
    group: p.group,
    amount: p.amount,
    salesperson: p.salesperson || undefined,
    place: p.place || undefined,
    vehicle: p.vehicle || undefined,
  });
}

// ---------- Receivables (src/lib/receivables.ts; docs/REPORTS_PHASE_PLAN.md section 6) ----------

export type RecParams = {
  kind: RecKind;
  /** Customer Balances, Bill Details */
  period: Period;
  from: string;
  to: string;
  /** Aging */
  as_of: AsOf;
  date: string;
  basis: Basis;
  interval: Interval;
  group: RecGroup;
  show: Show;
  status: BillShow;
  salesperson: string;
  place: string;
  vehicle: string;
};

/** The settings from the address; anything unknown falls back. `date` = the "as of" day the report uses. */
export function readRecParams(kind: RecKind, q: Record<string, string | undefined>, today = istToday()): RecParams {
  const period = pick(PERIODS, q.period, "this_month");
  const { from, to } = periodDates(period, today, { from: q.from, to: q.to });
  const as_of = pick(AS_OFS, q.as_of, "today");
  return {
    kind,
    period,
    from,
    to,
    as_of,
    date: asOfDate(as_of, today, q.date),
    basis: q.basis === "bill" ? "bill" : "due",
    interval: q.interval === "30" ? 30 : 15,
    group: pick(GROUPS_FOR[kind], q.group, GROUPS_FOR[kind][0]!),
    show: q.show === "nonzero" || q.show === "all" ? q.show : "owe",
    status: pick(BILL_SHOWS, q.status, "all"),
    salesperson: (q.salesperson ?? "").slice(0, 100),
    place: (q.place ?? "").slice(0, 200),
    vehicle: (q.vehicle ?? "").slice(0, 30),
  };
}

/**
 * Every bill and payment that is not cancelled, and what settled each bill (payments' allocations and adjustments),
 * leaving out anything that touches a cancelled bill or payment. Opening-balance bills are kept: they are owed.
 */
async function receivablesData(tenantId: string): Promise<RecData> {
  return withTenant(tenantId, async (tx) => {
    const party = (alias: string) => sql.raw(`
      coalesce('c:' || cu.id::text, 'z:' || zc.id::text) as customer_key,
      coalesce(cu.name, zc.name, ${alias}.customer_name) as customer_name,
      case when cu.id is not null then '/customers/' || cu.id::text else '/customers/z/' || zc.id::text end || '?tab=statement' as href,
      cu.place`);
    const join = (alias: string) => sql.raw(`
      left join order_capture.zoho_contacts zc on zc.tenant_id = ${alias}.tenant_id and zc.id = ${alias}.zoho_contact_id
      left join order_capture.customers cu on cu.tenant_id = ${alias}.tenant_id and cu.id = coalesce(${alias}.customer_id, zc.customer_id)`);
    type PartyRow = { customer_key: string; customer_name: string; href: string; place: string | null };
    const bills = await tx.execute<PartyRow & { id: string; number: string; bill_date: string; due_date: string | null; total: string; salesperson: string | null; vehicle: string | null }>(sql`
      select b.id, b.number, b.bill_date::text, b.due_date::text, b.total::text, b.salesperson, b.vehicle, ${party("b")}
        from order_capture.bills b ${join("b")}
       where b.tenant_id = ${tenantId} and b.cancelled_at is null`);
    const payments = await tx.execute<PartyRow & { id: string; payment_date: string; amount: string }>(sql`
      select p.id, p.payment_date::text, p.amount::text, ${party("p")}
        from order_capture.payments p ${join("p")}
       where p.tenant_id = ${tenantId} and p.cancelled_at is null`);
    const settles = await tx.execute<{ bill_id: string; payment_id: string | null; amount: string; on: string }>(sql`
      select a.bill_id, a.payment_id, a.amount::text, a.allocated_on::text as on
        from order_capture.payment_allocations a
        join order_capture.bills b on b.tenant_id = a.tenant_id and b.id = a.bill_id and b.cancelled_at is null
        join order_capture.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id and p.cancelled_at is null
       where a.tenant_id = ${tenantId}
      union all
      -- Zoho's export says a bill was closed without a payment (credit note, write-off) but not when, so the import
      -- dated it the import day; it counts from the bill's date, as Zoho's own reports show it closed (owner 2026-11-10)
      select j.bill_id, null, j.amount::text, (case when j.kind = 'zoho_closed' then least(b.bill_date, j.adjusted_on) else j.adjusted_on end)::text
        from order_capture.bill_adjustments j
        join order_capture.bills b on b.tenant_id = j.tenant_id and b.id = j.bill_id and b.cancelled_at is null
       where j.tenant_id = ${tenantId}`);
    const partyOf = (r: PartyRow) => ({ customer_key: r.customer_key, customer_name: r.customer_name, href: r.href, place: r.place });
    return {
      bills: bills.rows.map((r) => ({
        ...partyOf(r),
        id: r.id,
        number: r.number,
        bill_date: r.bill_date,
        due_date: r.due_date,
        total: paise(r.total),
        salesperson: r.salesperson,
        vehicle: r.vehicle,
      })),
      payments: payments.rows.map((r) => ({ ...partyOf(r), id: r.id, payment_date: r.payment_date, amount: paise(r.amount) })),
      settles: settles.rows.map((r) => ({ bill_id: r.bill_id, payment_id: r.payment_id, amount: paise(r.amount), on: r.on })),
    };
  });
}

/** Owner (support reads): one Receivables report with its filters. */
export async function receivablesReport(user: OcUser, p: RecParams, today = istToday()) {
  requireAccess(user, "reports");
  const d = await receivablesData(user.tenantId);
  const filter = { salesperson: p.salesperson || undefined, place: p.place || undefined, vehicle: p.vehicle || undefined };
  const aging = { asOf: p.date, basis: p.basis, interval: p.interval, filter, group: p.group };
  const table =
    p.kind === "balances"
      ? customerBalances(d, { from: p.from, to: p.to, filter, group: p.group, show: p.show })
      : p.kind === "aging"
        ? agingSummary(d, aging)
        : p.kind === "aging-details"
          ? agingDetails(d, aging)
          : billDetails(d, { from: p.from, to: p.to, today, status: p.status, filter, group: p.group });
  return { table, choices: recChoices(d) };
}

/** For the dashboard's Reports card (owner): last month's sales before GST and the change on the month before. */
export async function reportsTile(tenantId: string, today = istToday()) {
  const last = periodDates("prev_month", today);
  // "previous month" seen from a day inside last month = the month before it
  const before = periodDates("prev_month", `${last.from.slice(0, 8)}15`);
  const lines = await salesLines(tenantId, before.from, last.to);
  const sum = (from: string, to: string) => lines.filter((l) => l.bill_date >= from && l.bill_date <= to).reduce((s, l) => s + l.before, 0n);
  return { month: last.from.slice(0, 7), sales: sum(last.from, last.to), previous: sum(before.from, before.to) };
}

// ---------- Order to Payment (src/lib/order-flow.ts; docs/REPORTS_PHASE_PLAN.md section 7) ----------

export type FlowParams = FlowFilter & { view: "board" | "list"; stage: FlowStage | "" };

/** The settings from the address; anything unknown falls back. Default: every order, Board. */
export function readFlowParams(q: Record<string, string | undefined>, today = istToday()): FlowParams {
  const period = pick(FLOW_PERIODS, q.period, "all");
  const { from, to } = flowDates(period, today, { from: q.from, to: q.to });
  const yes = (v?: string) => v === "1" || v === "on" || v === "true";
  return {
    view: q.view === "list" ? "list" : "board",
    stage: pick([...FLOW_STAGES, ""] as const, q.stage, ""),
    period,
    from,
    to,
    customer: (q.customer ?? "").slice(0, 100),
    salesperson: (q.salesperson ?? "").slice(0, 100),
    place: (q.place ?? "").slice(0, 200),
    brand: (q.brand ?? "").slice(0, 30),
    overdue: yes(q.overdue),
    cancelled: yes(q.cancelled) || q.stage === "cancelled",
  };
}

/** Every order with its live bill (PlantOps or imported from Zoho, alike), what settled it, and the brands on its lines. */
async function flowData(tenantId: string): Promise<FlowOrder[]> {
  const names = new Map((await kit.products(tenantId)).map((p) => [p.id, p.name]));
  return withTenant(tenantId, async (tx) => {
    const orders = await tx.execute<{
      id: string; ref_no: number; status: FlowOrder["status"]; entered: string; delivered: string | null; delivered_by: string | null; total: string;
      customer_id: string; customer_name: string; phone: string; place: string | null;
      bill_id: string | null; bill_number: string | null; bill_date: string | null; due_date: string | null;
      bill_total: string | null; settled: string | null; settled_on: string | null; salesperson: string | null;
    }>(sql`
      select o.id, o.ref_no, o.status,
             (o.created_at at time zone 'Asia/Kolkata')::date::text as entered,
             (o.delivered_at at time zone 'Asia/Kolkata')::date::text as delivered,
             o.delivered_by_name as delivered_by, o.total::text,
             o.customer_id, coalesce(cu.name, o.customer_name) as customer_name, o.customer_phone as phone, coalesce(cu.place, o.customer_place) as place,
             b.id as bill_id, b.number as bill_number, b.bill_date::text, b.due_date::text, b.total::text as bill_total,
             s.settled::text, s.settled_on::text, b.salesperson
        from order_capture.orders o
        left join order_capture.customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
        left join order_capture.bills b on b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null
        left join lateral (
          select coalesce(sum(x.amount), 0) as settled, max(x.on) as settled_on from (
            select a.amount, a.allocated_on as on
              from order_capture.payment_allocations a
              join order_capture.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id and p.cancelled_at is null
             where a.tenant_id = b.tenant_id and a.bill_id = b.id
            union all
            select j.amount, j.adjusted_on from order_capture.bill_adjustments j where j.tenant_id = b.tenant_id and j.bill_id = b.id
          ) x
        ) s on b.id is not null
       where o.tenant_id = ${tenantId}`);
    const lines = await tx.execute<{ order_id: string; sku_id: string; product_name: string; brand: string | null }>(sql`
      select l.order_id, l.sku_id, l.product_name, pr.brand
        from order_capture.order_lines l
        join order_capture.orders o on o.tenant_id = l.tenant_id and o.id = l.order_id and o.version = l.version
        left join order_capture.product_rates pr on pr.tenant_id = l.tenant_id and pr.sku_id = l.sku_id
       where l.tenant_id = ${tenantId}`);
    const brands = new Map<string, Set<string>>();
    for (const l of lines.rows) {
      const b = effectiveBrand(l.brand, names.get(l.sku_id) ?? l.product_name);
      if (b) (brands.get(l.order_id) ?? brands.set(l.order_id, new Set()).get(l.order_id)!).add(b);
    }
    return orders.rows.map((r) => ({
        id: r.id,
        ref_no: r.ref_no,
        status: r.status,
        entered: r.entered,
        delivered: r.delivered,
        delivered_by: r.delivered_by,
        total: paise(r.total),
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        phone: r.phone,
        place: r.place,
        brands: [...(brands.get(r.id) ?? [])],
        bill: r.bill_id
          ? {
              id: r.bill_id,
              number: r.bill_number!,
              bill_date: r.bill_date!,
              due_date: r.due_date,
              total: paise(r.bill_total!),
              settled: paise(r.settled ?? "0"),
              settled_on: r.settled_on,
              salesperson: r.salesperson,
            }
          : null,
      }));
  });
}

/** Owner (support reads): Order to Payment rows (sorted for the List), stage totals and the filter choices. */
export async function orderFlowReport(user: OcUser, p: FlowParams, today = istToday()) {
  requireAccess(user, "reports");
  const orders = await flowData(user.tenantId);
  const rows = sortRows(flowRows(orders, today, p));
  return { rows, sums: stageSums(rows, p.cancelled), choices: flowChoices(orders, today) };
}

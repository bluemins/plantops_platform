// Business Overview + charts (docs/REPORTS_PHASE_PLAN.md section 9): reads the facts for src/lib/business.ts. Owner only
// (PlantOps support reads), the `reports` access row. Nothing is stored.
//   sales    = bill lines (PlantOps + Zoho; cancelled and opening bills left out) + van cash sales (sales − not paid)
//   expenses = purchase bills (lines by item, before GST = total − GST) + cash-book expenses + staff-cash spending + van
//              trip costs (diesel, meal, tiffin, toll). Salary comes in release 2.
//   money    = customer payments + van cash sales (in); vendor payments + the expenses paid in cash (out)
import { sql } from "drizzle-orm";
import {
  buildCharts,
  buildOverview,
  BYS,
  CHART_PERIODS,
  chartDates,
  fitBy,
  lastYear,
  type Amount,
  type Basis,
  type By,
  type ChartPeriod,
  type ExpenseFact,
  type MoneyFact,
  type SaleFact,
} from "@/lib/business";
import { effectiveBrand } from "@/lib/brand";
import { OPENING_SQL, paise } from "@/lib/ledger";
import { agingSummary } from "@/lib/receivables";
import { requireAccess } from "./access";
import { withTenant, type OcTx } from "./db";
import { istToday } from "./ledger";
import { payablesReport } from "./purchase-reports";
import { receivablesData } from "./reports";
import type { OcUser } from "./session";

const P = (s: string | null) => (s === null ? 0n : paise(s));
const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

async function saleFacts(tx: OcTx, tenantId: string, from: string, to: string): Promise<SaleFact[]> {
  const bills = await tx.execute<{ bill_date: string; customer_key: string | null; customer_name: string; href: string | null; brand: string | null; item_name: string; before: string; with_gst: string }>(sql`
    select b.bill_date::text,
           coalesce('c:' || cu.id::text, 'z:' || zc.id::text) as customer_key,
           coalesce(cu.name, zc.name, b.customer_name) as customer_name,
           case when cu.id is not null then '/customers/' || cu.id::text when zc.id is not null then '/customers/z/' || zc.id::text end as href,
           pr.brand, l.item_name,
           coalesce(l.taxable, l.line_total)::text as before,
           (coalesce(l.taxable, l.line_total) + l.tax_amount)::text as with_gst
      from order_capture.bills b
      join order_capture.bill_lines l on l.tenant_id = b.tenant_id and l.bill_id = b.id
      left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
      left join order_capture.customers cu on cu.tenant_id = b.tenant_id and cu.id = coalesce(b.customer_id, zc.customer_id)
      left join order_capture.product_rates pr on pr.tenant_id = b.tenant_id and pr.sku_id = l.sku_id
     where b.tenant_id = ${tenantId} and b.cancelled_at is null and not ${sql.raw(OPENING_SQL("b"))}
       and b.bill_date between ${from}::date and ${to}::date`);
  const vans = await tx.execute<{ work_date: string; cash_sales: string }>(sql`
    select v.work_date::text, (v.sales - v.not_paid)::text as cash_sales
      from order_capture.van_reports v
      join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
     where v.tenant_id = ${tenantId} and v.work_date between ${from}::date and ${to}::date and v.sales > v.not_paid`);
  return [
    ...bills.rows.map((r) => ({
      date: r.bill_date,
      before: P(r.before),
      with_gst: P(r.with_gst),
      brand: effectiveBrand(r.brand, r.item_name) || null,
      van: false,
      customer_key: r.customer_key,
      customer_name: r.customer_name,
      href: r.href,
    })),
    ...vans.rows.map((r) => ({ date: r.work_date, before: P(r.cash_sales), with_gst: P(r.cash_sales), brand: null, van: true, customer_key: null, customer_name: "Van sales", href: null })),
  ];
}

async function expenseFacts(tx: OcTx, tenantId: string, from: string, to: string): Promise<ExpenseFact[]> {
  // purchases by item; what the lines don't add up to (discount, adjustment, rounding) as its own type
  const lines = await tx.execute<{ bill_id: string; bill_date: string; item: string; before: string; tax: string }>(sql`
    select b.id as bill_id, b.bill_date::text, coalesce(i.name, l.item_name) as item, l.line_total::text as before, l.tax_amount::text as tax
      from order_capture.purchase_bill_lines l
      join order_capture.purchase_bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id and b.cancelled_at is null
      left join order_capture.purchase_items i on i.tenant_id = l.tenant_id and i.id = l.item_id
     where l.tenant_id = ${tenantId} and b.bill_date between ${from}::date and ${to}::date`);
  const bills = await tx.execute<{ id: string; bill_date: string; before: string; total: string }>(sql`
    select id, bill_date::text, (total - tax_total)::text as before, total::text
      from order_capture.purchase_bills
     where tenant_id = ${tenantId} and cancelled_at is null and bill_date between ${from}::date and ${to}::date`);
  const cash = await tx.execute<{ date: string; type: string; amount: string }>(sql`
    select e.work_date::text as date, c.name as type, e.amount::text
      from order_capture.cash_entries e
      join order_capture.expense_categories c on c.tenant_id = e.tenant_id and c.id = e.category_id
     where e.tenant_id = ${tenantId} and e.kind = 'expense' and e.cancelled_at is null and e.work_date between ${from}::date and ${to}::date
    union all
    select s.spent_on::text, c.name, s.amount::text
      from order_capture.staff_cash_spends s
      join order_capture.expense_categories c on c.tenant_id = s.tenant_id and c.id = s.category_id
     where s.tenant_id = ${tenantId} and s.cancelled_at is null and s.spent_on between ${from}::date and ${to}::date`);
  const vans = await tx.execute<{ work_date: string; diesel: string; meal: string; tiffin: string; toll: string }>(sql`
    select v.work_date::text, v.diesel::text, v.meal::text, v.tiffin::text, v.toll::text
      from order_capture.van_reports v
      join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
     where v.tenant_id = ${tenantId} and v.work_date between ${from}::date and ${to}::date`);

  const out: ExpenseFact[] = [];
  const lineSum = new Map<string, { before: bigint; with_gst: bigint }>();
  for (const l of lines.rows) {
    const before = P(l.before);
    const withGst = before + P(l.tax);
    out.push({ date: l.bill_date, group: "purchases", type: `Purchases: ${l.item}`, before, with_gst: withGst });
    const s = lineSum.get(l.bill_id) ?? { before: 0n, with_gst: 0n };
    lineSum.set(l.bill_id, { before: s.before + before, with_gst: s.with_gst + withGst });
  }
  for (const b of bills.rows) {
    const s = lineSum.get(b.id) ?? { before: 0n, with_gst: 0n };
    const before = P(b.before) - s.before;
    const withGst = P(b.total) - s.with_gst;
    if (before !== 0n || withGst !== 0n) out.push({ date: b.bill_date, group: "purchases", type: "Purchases: discount / rounding", before, with_gst: withGst });
  }
  for (const c of cash.rows) out.push({ date: c.date, group: "other", type: c.type, before: P(c.amount), with_gst: P(c.amount) });
  for (const v of vans.rows) {
    for (const [k, label] of [["diesel", "Van: diesel"], ["meal", "Van: meal"], ["tiffin", "Van: tiffin"], ["toll", "Van: toll"]] as const) {
      const a = P(v[k]);
      if (a > 0n) out.push({ date: v.work_date, group: "van", type: label, before: a, with_gst: a });
    }
  }
  return out;
}

async function moneyFacts(tx: OcTx, tenantId: string, from: string, to: string, sales: SaleFact[], expenses: ExpenseFact[]): Promise<MoneyFact[]> {
  const r = await tx.execute<{ date: string; dir: "in" | "out"; amount: string }>(sql`
    select payment_date::text as date, 'in' as dir, amount::text from order_capture.payments
     where tenant_id = ${tenantId} and cancelled_at is null and payment_date between ${from}::date and ${to}::date
    union all
    select payment_date::text, 'out', amount::text from order_capture.vendor_payments
     where tenant_id = ${tenantId} and cancelled_at is null and payment_date between ${from}::date and ${to}::date`);
  return [
    ...r.rows.map((m) => ({ date: m.date, dir: m.dir, amount: P(m.amount) })),
    // van cash sales came in; cash-book, staff-cash and van costs went out (purchases go out when the vendor is paid)
    ...sales.filter((s) => s.van && s.date >= from).map((s) => ({ date: s.date, dir: "in" as const, amount: s.before })),
    ...expenses.filter((e) => e.group !== "purchases").map((e) => ({ date: e.date, dir: "out" as const, amount: e.before })),
  ];
}

async function orderDates(tx: OcTx, tenantId: string, from: string, to: string) {
  const r = await tx.execute<{ d: string }>(sql`
    select (created_at at time zone 'Asia/Kolkata')::date::text as d from order_capture.orders
     where tenant_id = ${tenantId} and status <> 'cancelled'
       and (created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date`);
  return r.rows.map((x) => x.d);
}

/** The first month with 10 or more sales bills: the plant's records really start there (Zoho history or PlantOps). */
async function recordsFrom(tx: OcTx, tenantId: string): Promise<string | null> {
  const r = await tx.execute<{ m: string | null }>(sql`
    select min(m)::text as m from (
      select date_trunc('month', bill_date)::date as m from order_capture.bills
       where tenant_id = ${tenantId} and cancelled_at is null and not ${sql.raw(OPENING_SQL("bills"))}
       group by 1 having count(*) >= 10) x`);
  return r.rows[0]?.m ?? null;
}

const okDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

// ---------- Business charts ----------

export type ChartParams = { period: ChartPeriod; from: string; to: string; by: By; asked: By; brand: string; amount: Amount };

export function readChartParams(q: Record<string, string | undefined>, today = istToday()): ChartParams {
  const period = pick(CHART_PERIODS, q.period, "last_12");
  const { from, to } = chartDates(period, today, { from: okDate(q.from) ? q.from : undefined, to: okDate(q.to) ? q.to : undefined });
  const asked = pick(BYS, q.by, "month");
  return { period, from, to, asked, by: fitBy(asked, from, to), brand: (q.brand ?? "").slice(0, 30), amount: q.amount === "with" ? "with" : "before" };
}

/** Owner (support reads): every chart of the Business charts page. */
export async function businessCharts(user: OcUser, p: ChartParams) {
  requireAccess(user, "reports");
  const lyFrom = lastYear(p.from);
  const lyTo = lastYear(p.to);
  const d = await withTenant(user.tenantId, async (tx) => {
    const allSales = await saleFacts(tx, user.tenantId, lyFrom, p.to);
    const sales = allSales.filter((s) => s.date >= p.from);
    const lastYearSales = allSales.filter((s) => s.date >= lyFrom && s.date <= lyTo);
    const expenses = await expenseFacts(tx, user.tenantId, p.from, p.to);
    const money = await moneyFacts(tx, user.tenantId, p.from, p.to, sales, expenses);
    return { sales, lastYearSales, expenses, money, orderDates: await orderDates(tx, user.tenantId, p.from, p.to), recordsFrom: await recordsFrom(tx, user.tenantId) };
  });
  const rec = await receivablesData(user.tenantId);
  const owedOn = (date: string) => {
    const t = agingSummary(rec, { asOf: date, basis: "due", interval: 15, filter: {}, group: "none" });
    return t.total[t.total.length - 1] as bigint;
  };
  const charts = buildCharts(d, { from: p.from, to: p.to, by: p.by, brand: p.brand, amount: p.amount, recordsFrom: d.recordsFrom }, []);
  charts.owed = charts.buckets.map((b) => owedOn(b.to));
  return charts;
}

// ---------- Business Overview ----------

export type OverviewParams = { period: "last_12" | "this_fy"; from: string; to: string; basis: Basis };

export function readOverviewParams(q: Record<string, string | undefined>, today = istToday()): OverviewParams {
  const period = q.period === "this_fy" ? "this_fy" : "last_12";
  return { period, ...chartDates(period, today), basis: q.basis === "payment" ? "payment" : "bill" };
}

/** Owner (support reads): the Business Overview page. */
export async function businessOverview(user: OcUser, p: OverviewParams, today = istToday()) {
  requireAccess(user, "reports");
  const d = await withTenant(user.tenantId, async (tx) => {
    const sales = await saleFacts(tx, user.tenantId, p.from, p.to);
    const expenses = await expenseFacts(tx, user.tenantId, p.from, p.to);
    return { sales, expenses, money: await moneyFacts(tx, user.tenantId, p.from, p.to, sales, expenses), recordsFrom: await recordsFrom(tx, user.tenantId) };
  });
  const rec = agingSummary(await receivablesData(user.tenantId), { asOf: today, basis: "due", interval: 15, filter: {}, group: "none" });
  const owed = rec.total[rec.total.length - 1] as bigint;
  const notDue = rec.total[1] as bigint;
  const pay = await payablesReport(user);
  return {
    ...buildOverview(d, p),
    recordsFrom: d.recordsFrom,
    receivables: { total: owed, notDue, overdue: owed - notDue },
    payables: { total: pay.owed, notDue: pay.totals.not_due, overdue: pay.owed - pay.totals.not_due },
  };
}

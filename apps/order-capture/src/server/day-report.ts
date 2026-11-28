// Reports → Day report (owner only, support reads; owner 2026-11-16, mock-up https://claude.ai/artifact/EenMuXKx7ffECUk2wQ41Fv)
// and the evening notification. One India day: Sales' own orders, bills, payments, cash book, vans and purchases, plus
// each other module's part (Floor Stock, Attendance, Complaint Box, Job applications) asked through a 60-second
// platform lookup ticket (scope day_report). Everything is worked out when asked; nothing is stored.
import { sql } from "drizzle-orm";
import { fetchLookupTicket } from "@plantops/auth";
import { DayReportPart, type ModuleId } from "@plantops/types";
import { effectiveBrand } from "@/lib/brand";
import { SHORT_ALERT } from "@/lib/cash";
import { buildDayReport, type DayFacts, type DayReport, type OtherPart } from "@/lib/day-report";
import { OPENING_SQL, paise } from "@/lib/ledger";
import { agingSummary } from "@/lib/receivables";
import { requireAccess } from "./access";
import { addDays, daySheet, istToday } from "./cash";
import { waitingToPost } from "./collections";
import { withTenant, type OcTx } from "./db";
import { kit } from "./kit";
import { payablesReport } from "./purchase-reports";
import { receivablesData } from "./reports";
import type { OcUser } from "./session";

const P = (s: string | null | undefined) => (s ? paise(s) : 0n);

/** The owner's view, for reading only (the cron job has no person). */
export const reader = (tenantId: string): OcUser => ({
  tenantId,
  userId: "00000000-0000-0000-0000-000000000000",
  name: "Day report",
  roles: ["tenant_admin"],
  who: "owner",
  isOwner: true,
  isSupport: false,
});

export const OTHER_MODULES: { id: ModuleId; title: string }[] = [
  { id: "floor_stock", title: "Stock" },
  { id: "attendance_salary", title: "Attendance" },
  { id: "complaint_box", title: "Complaints" },
  { id: "job_applications", title: "Job applications" },
];

/** Sold on each India day: bills (not cancelled, not opening balances) + van cash sales (sales − not paid), with GST. */
export async function salesOnDays(tx: OcTx, tenantId: string, days: string[]) {
  const r = await tx.execute<{ day: string; total: string }>(sql`
      select d::text as day, (
        coalesce((select sum(b.total) from order_capture.bills b where b.tenant_id = ${tenantId} and b.cancelled_at is null
                    and not ${sql.raw(OPENING_SQL("b"))} and b.bill_date = d), 0)
        + coalesce((select sum(v.sales - v.not_paid) from order_capture.van_reports v
                      join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
                     where v.tenant_id = ${tenantId} and v.work_date = d and v.sales > v.not_paid), 0))::text as total
        from unnest(${`{${days.join(",")}}`}::date[]) d`);
  return r.rows;
}

/** One other module's part: "in", "off" (not switched on for the plant) or "unreachable" (no good answer in 5 s). */
export async function fetchPart(tenantId: string, module: ModuleId, date: string): Promise<OtherPart> {
  try {
    const t = await fetchLookupTicket(kit.creds(), tenantId, module, "day_report");
    if (!t) return { state: "off" };
    const res = await fetch(new URL(`/api/plantops/day-report?date=${date}`, t.url), { headers: { authorization: `Bearer ${t.ticket}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { state: "unreachable" };
    return { state: "in", part: DayReportPart.parse(await res.json()) };
  } catch {
    return { state: "unreachable" };
  }
}

async function salesFacts(tenantId: string, date: string, now: Date): Promise<Omit<DayFacts, "cash" | "toPost" | "owed" | "owedBefore" | "payables">> {
  const from = `${date}T00:00:00+05:30`;
  const inDay = (col: string) => sql`${sql.raw(col)} >= ${from}::timestamptz and ${sql.raw(col)} < ${from}::timestamptz + interval '1 day'`;
  return withTenant(tenantId, async (tx) => {
    const lines = await tx.execute<{ order_id: string; total: string; product_name: string; unit: string; quantity: number; brand: string | null }>(sql`
      select o.id as order_id, o.total::text, l.product_name, l.unit, l.quantity, pr.brand
        from order_capture.orders o
        join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version
        left join order_capture.product_rates pr on pr.tenant_id = o.tenant_id and pr.sku_id = l.sku_id
       where o.tenant_id = ${tenantId} and ${inDay("o.created_at")}`);
    const delivered = await tx.execute<{ ref_no: number; unit: string; quantity: number; billed: boolean }>(sql`
      select o.ref_no, l.unit, l.quantity,
             exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null) as billed
        from order_capture.orders o
        join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version
       where o.tenant_id = ${tenantId} and o.status = 'delivered' and ${inDay("o.delivered_at")}`);
    const cancelled = await tx.execute<{ ref_no: number; reason: string | null }>(sql`
      select o.ref_no, (select e.text from order_capture.order_events e where e.tenant_id = o.tenant_id and e.order_id = o.id and e.kind = 'cancelled'
                         order by e.created_at desc limit 1) as reason
        from order_capture.orders o
       where o.tenant_id = ${tenantId} and o.status = 'cancelled' and ${inDay("o.status_changed_at")}`);
    const pending = await tx.execute<{ n: number; late: number; oldest_ref: number | null; oldest_days: number | null }>(sql`
      select count(*)::int as n,
             count(*) filter (where o.created_at <= ${now.toISOString()}::timestamptz - interval '2 days')::int as late,
             (array_agg(o.ref_no order by o.created_at))[1] as oldest_ref,
             floor(extract(epoch from (${now.toISOString()}::timestamptz - min(o.created_at))) / 86400)::int as oldest_days
        from order_capture.orders o where o.tenant_id = ${tenantId} and o.status = 'pending'`);
    const calls = await tx.execute<{ callers: number; missed: number; attended: number; new_callers: number }>(sql`
      select (select count(distinct phone)::int from order_capture.call_events where tenant_id = ${tenantId} and ${inDay("created_at")}) as callers,
             (select count(*)::int from order_capture.call_events where tenant_id = ${tenantId} and event = 'missed' and ${inDay("created_at")}) as missed,
             (select count(*)::int from order_capture.call_attended where tenant_id = ${tenantId} and ${inDay("created_at")}) as attended,
             (select count(*)::int from order_capture.call_attended where tenant_id = ${tenantId} and outcome = 'new_customer' and ${inDay("created_at")}) as new_callers`);
    const bills = await tx.execute<{ number: string; total: string; needs_gst: boolean }>(sql`
      select b.number, b.total::text, b.needs_gst from order_capture.bills b
       where b.tenant_id = ${tenantId} and b.cancelled_at is null and not ${sql.raw(OPENING_SQL("b"))} and b.bill_date = ${date}::date
       order by b.number`);
    const billsCancelled = await tx.execute<{ number: string; reason: string | null }>(sql`
      select number, cancel_reason as reason from order_capture.bills where tenant_id = ${tenantId} and ${inDay("cancelled_at")}`);
    const gstWaiting = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from order_capture.bills where tenant_id = ${tenantId} and needs_gst and sent_to_zoho_at is null and cancelled_at is null`);
    const payments = await tx.execute<{ mode: string; customer_name: string; amount: string }>(sql`
      select mode, customer_name, amount::text from order_capture.payments
       where tenant_id = ${tenantId} and cancelled_at is null and payment_date = ${date}::date order by amount desc`);
    const vans = await tx.execute<{ vehicle: string; person: string; sales: string; not_paid: string; handed_in: string; difference: string; diesel: string; meal: string; tiffin: string; toll: string }>(sql`
      select coalesce(cv.name, 'Van') as vehicle, v.person_name as person, v.sales::text, v.not_paid::text, v.handed_in::text, v.difference::text,
             v.diesel::text, v.meal::text, v.tiffin::text, v.toll::text
        from order_capture.van_reports v
        join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
        left join order_capture.cash_vehicles cv on cv.tenant_id = v.tenant_id and cv.id = v.vehicle_id
       where v.tenant_id = ${tenantId} and v.work_date = ${date}::date order by v.created_at`);
    const purchases = await tx.execute<{ bills: number; total: string; paid: string }>(sql`
      select (select count(*)::int from order_capture.purchase_bills where tenant_id = ${tenantId} and cancelled_at is null and bill_date = ${date}::date) as bills,
             (select coalesce(sum(total), 0)::text from order_capture.purchase_bills where tenant_id = ${tenantId} and cancelled_at is null and bill_date = ${date}::date) as total,
             (select coalesce(sum(amount), 0)::text from order_capture.vendor_payments where tenant_id = ${tenantId} and cancelled_at is null and payment_date = ${date}::date) as paid`);
    // sales the same weekday a week before, for the headline's comparison (bills + van cash sales, with GST)
    const weekAgo = addDays(date, -7);
    const salesOn = { rows: await salesOnDays(tx, tenantId, [date, weekAgo]) };

    const orders = new Map<string, { total: bigint; brands: Set<string> }>();
    const byBrand = new Map<string, { orders: Set<string>; lines: { quantity: number; unit: string }[] }>();
    for (const l of lines.rows) {
      const o = orders.get(l.order_id) ?? { total: P(l.total), brands: new Set() };
      orders.set(l.order_id, o);
      const brand = effectiveBrand(l.brand, l.product_name) || "Other";
      const b = byBrand.get(brand) ?? { orders: new Set(), lines: [] };
      b.orders.add(l.order_id);
      b.lines.push({ quantity: l.quantity, unit: l.unit });
      byBrand.set(brand, b);
    }
    const sale = (d: string) => P(salesOn.rows.find((r) => r.day === d)?.total);
    return {
      date,
      newOrders: { count: orders.size, lines: lines.rows.map((l) => ({ quantity: l.quantity, unit: l.unit })), value: [...orders.values()].reduce((s, o) => s + o.total, 0n) },
      byBrand: [...byBrand].map(([brand, b]) => ({ brand, orders: b.orders.size, lines: b.lines })).sort((a, b) => b.orders - a.orders),
      delivered: {
        count: new Set(delivered.rows.map((d) => d.ref_no)).size,
        lines: delivered.rows.map((d) => ({ quantity: d.quantity, unit: d.unit })),
        notBilled: [...new Set(delivered.rows.filter((d) => !d.billed).map((d) => d.ref_no))],
      },
      cancelled: cancelled.rows.map((c) => ({ ref: c.ref_no, reason: c.reason })),
      pending: { count: pending.rows[0]?.n ?? 0, late: pending.rows[0]?.late ?? 0, oldestRef: pending.rows[0]?.oldest_ref ?? null, oldestDays: pending.rows[0]?.oldest_days ?? null },
      calls: calls.rows[0] ?? { callers: 0, missed: 0, attended: 0, new_callers: 0 },
      bills: bills.rows.map((b) => ({ number: b.number, total: P(b.total), gst: b.needs_gst })),
      billsCancelled: billsCancelled.rows,
      gstWaiting: gstWaiting.rows[0]?.n ?? 0,
      payments: payments.rows.map((p) => ({ mode: p.mode, customer: p.customer_name, amount: P(p.amount) })),
      vans: vans.rows.map((v) => ({
        vehicle: v.vehicle,
        person: v.person,
        sales: P(v.sales),
        notPaid: P(v.not_paid),
        handedIn: P(v.handed_in),
        difference: P(v.difference),
        costs: P(v.diesel) + P(v.meal) + P(v.tiffin) + P(v.toll),
      })),
      purchases: { bills: purchases.rows[0]?.bills ?? 0, total: P(purchases.rows[0]?.total), paid: P(purchases.rows[0]?.paid) },
      sales: sale(date),
      salesWeekAgo: sale(weekAgo),
    };
  });
}

async function cashFacts(user: OcUser, date: string, today: string): Promise<DayFacts["cash"]> {
  const s = await daySheet(user, date, today);
  if (!s.started) return { started: false };
  const live = s.entries.filter((e) => !e.cancelled);
  const expenses = new Map<string, bigint>();
  for (const e of live.filter((x) => x.kind === "expense")) expenses.set(e.category ?? "Other", (expenses.get(e.category ?? "Other") ?? 0n) + P(e.amount));
  return {
    started: true,
    beforeStart: s.before_start,
    close: s.close ? { counted: P(s.close.counted), expected: P(s.close.expected), difference: P(s.close.difference), reason: s.close.reason, by: s.close.by, at: s.close.at } : null,
    cashIn: live.filter((e) => e.direction === "in").reduce((t, e) => t + P(e.amount), 0n),
    cashOut: live.filter((e) => e.direction === "out").reduce((t, e) => t + P(e.amount), 0n),
    expenses: [...expenses].map(([type, amount]) => ({ type, amount })).sort((a, b) => (b.amount > a.amount ? 1 : -1)),
    advances: live.filter((e) => e.kind === "staff_out" && e.purpose === "advance").map((e) => ({ person: e.person ?? "?", amount: P(e.amount) })),
  };
}

/** Owner (support reads): the whole Day report for one India date (not after today). */
export async function dayReport(user: OcUser, date: string, now = new Date()): Promise<DayReport> {
  requireAccess(user, "reports");
  const today = istToday(now);
  const t = user.tenantId;
  const owner = reader(t);
  const others = Promise.all(OTHER_MODULES.map(async (m) => ({ ...m, ...(await fetchPart(t, m.id, date)) })));
  const end = date === today ? now : new Date(`${date}T23:59:59+05:30`);
  const [facts, cash, toPost, rec, pay] = await Promise.all([salesFacts(t, date, end), cashFacts(owner, date, today), waitingToPost(owner), receivablesData(t), payablesReport(owner)]);
  const owedOn = (d: string) => {
    const a = agingSummary(rec, { asOf: d, basis: "due", interval: 15, filter: {}, group: "none" });
    return a.total[a.total.length - 1] as bigint;
  };
  return buildDayReport({ ...facts, cash, toPost, owed: owedOn(date), owedBefore: owedOn(addDays(date, -1)), payables: date === today ? pay.owed : null }, await others, { today, shortAlert: SHORT_ALERT });
}

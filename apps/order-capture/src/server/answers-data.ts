// Plant answers (docs/MORNING_REPORT_PHASE_PLAN.md Phases 2–3): the rows each card reads. Every reader reuses the query
// its report already uses (Receivables, Business charts, the cash book, the Day report, the customer page's Buying &
// paying) or reads the same tables the same way, so a card and its report agree. Read only: nothing is entered,
// changed, sent or stored.
import { sql } from "drizzle-orm";
import { fetchLookupTicket } from "@plantops/auth";
import { StockAnswers, StockLevels } from "@plantops/types";
import { customerInsights, type InsightLine, type InsightPurchase } from "@/lib/customer-insights";
import { paise, OPENING_SQL } from "@/lib/ledger";
import type { M3Payment, M4Close, M4Entry, M6Cash, PayBill } from "@/lib/answers/money-cards";
import { orderRef } from "@/lib/order-flow";
import type { CustomerBuying, O1Order, O4Order, StockAnswer } from "@/lib/answers/order-cards";
import type { StockFacts } from "@/lib/answers/stock-cards";
import { addDays, closesOf, daySheet } from "./cash";
import { collectionsList } from "./collections";
import { salesOnDays } from "./day-report";
import { withTenant } from "./db";
import { kit } from "./kit";
import type { OcUser } from "./session";

const P = (s: string | null | undefined) => (s ? paise(s) : 0n);
const IST = "Asia/Kolkata";

/** The customer of a bill / payment row: its own customer, or the customer its Zoho contact is matched to, else the contact. */
const KEY = (a: string) =>
  sql.raw(`coalesce('c:' || coalesce(${a}.customer_id, zc.customer_id)::text, 'z:' || zc.id::text)`);
const ZC = (a: string) => sql.raw(`left join order_capture.zoho_contacts zc on zc.tenant_id = ${a}.tenant_id and zc.id = ${a}.zoho_contact_id`);

// ---------- M1 ----------

/** Every customer's bills and what settled them, as the customer page reads them (Zoho closes dated as Zoho says). */
export async function payingRows(tenantId: string): Promise<{ bills: PayBill[]; settles: { bill_id: string; amount: bigint; on: string }[] }> {
  return withTenant(tenantId, async (tx) => {
    const bills = await tx.execute<{ id: string; customer_key: string | null; bill_date: string; due_date: string | null; total: string; cancelled: boolean; opening: boolean }>(sql`
      select b.id, ${KEY("b")} as customer_key, b.bill_date::text, b.due_date::text, b.total::text, b.cancelled_at is not null as cancelled,
             ${sql.raw(OPENING_SQL("b"))} as opening
        from order_capture.bills b ${ZC("b")} where b.tenant_id = ${tenantId}`);
    const settles = await tx.execute<{ bill_id: string; amount: string; on: string }>(sql`
      select a.bill_id, a.amount::text, a.allocated_on::text as on from order_capture.payment_allocations a
        join order_capture.payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id and p.cancelled_at is null
       where a.tenant_id = ${tenantId}
      union all
      select j.bill_id, j.amount::text, j.adjusted_on::text from order_capture.bill_adjustments j where j.tenant_id = ${tenantId}`);
    return {
      bills: bills.rows
        .filter((b) => b.customer_key)
        .map((b) => ({ id: b.id, customer_key: b.customer_key!, bill_date: b.bill_date, due_date: b.due_date, total: P(b.total), cancelled: b.cancelled, opening: b.opening })),
      settles: settles.rows.map((s) => ({ bill_id: s.bill_id, amount: P(s.amount), on: s.on })),
    };
  });
}

// ---------- M3 ----------

export async function moneyInRows(user: OcUser, from: string, to: string) {
  const rows = await withTenant(user.tenantId, async (tx) => {
    const pays = await tx.execute<{ date: string; mode: string; customer: string; amount: string }>(sql`
      select p.payment_date::text as date, p.mode, coalesce(cu.name, zc.name, p.customer_name) as customer, p.amount::text
        from order_capture.payments p ${ZC("p")}
        left join order_capture.customers cu on cu.tenant_id = p.tenant_id and cu.id = coalesce(p.customer_id, zc.customer_id)
       where p.tenant_id = ${user.tenantId} and p.cancelled_at is null and p.payment_date between ${from}::date and ${to}::date`);
    // van cash sales as Business Overview counts them (sales − not paid, the van entry not cancelled)
    const vans = await tx.execute<{ date: string; cash: string }>(sql`
      select v.work_date::text as date, (v.sales - v.not_paid)::text as cash
        from order_capture.van_reports v
        join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
       where v.tenant_id = ${user.tenantId} and v.work_date between ${from}::date and ${to}::date and v.sales > v.not_paid`);
    return { pays: pays.rows, vans: vans.rows };
  });
  const waiting = (await collectionsList(user, "waiting", 1)).waiting;
  return {
    payments: rows.pays.map((p): M3Payment => ({ date: p.date, mode: p.mode, customer: p.customer, amount: P(p.amount) })),
    vans: rows.vans.map((v) => ({ date: v.date, cash: P(v.cash) })),
    toPost: { count: waiting.count, amount: P(waiting.amount) },
  };
}

// ---------- M4 ----------

export async function cashCheckRows(tenantId: string, since: string): Promise<{ closes: M4Close[]; entries: M4Entry[] }> {
  return withTenant(tenantId, async (tx) => {
    const closes = await closesOf(tx, tenantId);
    const entries = await tx.execute<{
      ref_no: number; cash_date: string; work_date: string; kind: M4Entry["kind"]; direction: "in" | "out"; amount: string; category: string | null;
      vehicle: string | null; person: string | null; purpose: M4Entry["purpose"]; by: string; at: Date; cancelled_at: Date | null; van_difference: string | null;
    }>(sql`
      select e.ref_no, e.cash_date::text, e.work_date::text, e.kind, e.direction, e.amount::text, c.name as category, cv.name as vehicle,
             e.person_name as person, e.staff_purpose as purpose, e.created_by_name as by, e.created_at as at, e.cancelled_at,
             (select v.difference::text from order_capture.van_reports v where v.tenant_id = e.tenant_id and v.cash_entry_id = e.id limit 1) as van_difference
        from order_capture.cash_entries e
        left join order_capture.expense_categories c on c.tenant_id = e.tenant_id and c.id = e.category_id
        left join order_capture.cash_vehicles cv on cv.tenant_id = e.tenant_id and cv.id = e.vehicle_id
       where e.tenant_id = ${tenantId} and e.cash_date >= ${since}::date`);
    return {
      closes: closes.map((c) => ({ cash_date: c.cash_date, counted: P(c.counted), expected: P(c.expected), difference: P(c.difference), reason: c.reason, by: c.created_by_name, at: new Date(c.created_at).toISOString(), opening: c.opening })),
      entries: entries.rows.map((e) => ({
        ref: `C-${String(e.ref_no).padStart(4, "0")}`,
        cash_date: e.cash_date,
        work_date: e.work_date,
        kind: e.kind,
        direction: e.direction,
        amount: P(e.amount),
        category: e.category,
        vehicle: e.vehicle,
        person: e.person,
        purpose: e.purpose,
        by: e.by,
        at: new Date(e.at).toISOString(),
        cancelled_at: e.cancelled_at ? new Date(e.cancelled_at).toISOString() : null,
        van_difference: e.van_difference === null ? null : P(e.van_difference),
      })),
    };
  });
}

// ---------- M6 ----------

export async function cashNow(user: OcUser, today: string): Promise<M6Cash> {
  const s = await daySheet(user, today, today);
  if (!s.started) return { started: false };
  const closes = await withTenant(user.tenantId, (tx) => closesOf(tx, user.tenantId));
  const before = closes.filter((c) => c.cash_date < today).at(-1);
  return {
    started: true,
    today: s.close ? { counted: P(s.close.counted), by: s.close.by, at: s.close.at, expected: P(s.close.expected) } : null,
    last: before ? { date: before.cash_date, counted: P(before.counted), by: before.created_by_name, at: new Date(before.created_at).toISOString() } : null,
    expected: s.expected === null ? null : P(s.expected),
    in: P(s.in),
    out: P(s.out),
  };
}

export async function soldToday(tenantId: string, today: string) {
  const weekAgo = addDays(today, -7);
  return withTenant(tenantId, async (tx) => {
    const days = await salesOnDays(tx, tenantId, [today, weekAgo]);
    const n = await tx.execute<{ bills: number; vans: number; not_billed: number }>(sql`
      select (select count(*)::int from order_capture.bills b where b.tenant_id = ${tenantId} and b.cancelled_at is null and not ${sql.raw(OPENING_SQL("b"))} and b.bill_date = ${today}::date) as bills,
             (select count(*)::int from order_capture.van_reports v join order_capture.cash_entries ce on ce.tenant_id = v.tenant_id and ce.id = v.cash_entry_id and ce.cancelled_at is null
               where v.tenant_id = ${tenantId} and v.work_date = ${today}::date and v.sales > v.not_paid) as vans,
             (select count(*)::int from order_capture.orders o where o.tenant_id = ${tenantId} and o.status = 'delivered'
                 and (o.delivered_at at time zone ${IST})::date = ${today}::date
                 and not exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null)) as not_billed`);
    const on = (d: string) => P(days.find((r) => r.day === d)?.total);
    return { today: on(today), weekAgo: on(weekAgo), bills: n.rows[0]?.bills ?? 0, vans: n.rows[0]?.vans ?? 0, notBilled: n.rows[0]?.not_billed ?? 0 };
  });
}

// ---------- O1 ----------

export async function pendingOrders(tenantId: string): Promise<O1Order[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ id: string; ref_no: number; customer_id: string; name: string; place: string | null; phone: string | null; created_at: Date; sku_id: string; product_name: string; unit: string; quantity: number }>(sql`
      select o.id, o.ref_no, cu.id as customer_id, cu.name, cu.place, cu.phone, o.created_at, l.sku_id, l.product_name, l.unit, l.quantity
        from order_capture.orders o
        join order_capture.customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
        join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version
       where o.tenant_id = ${tenantId} and o.status = 'pending'
       order by o.created_at, l.line_no`);
    const per = new Map<string, O1Order>();
    for (const x of r.rows) {
      const o =
        per.get(x.id) ??
        ({ id: x.id, ref: orderRef(x.ref_no), customer: x.name, customer_href: `/customers/${x.customer_id}`, place: x.place, phone: x.phone, created_at: new Date(x.created_at).toISOString(), lines: [] } as O1Order);
      per.set(x.id, o);
      const same = o.lines.find((l) => l.sku_id === x.sku_id && l.unit === x.unit);
      if (same) same.quantity += x.quantity; // a paid and a free line of one product
      else o.lines.push({ sku_id: x.sku_id, name: x.product_name, unit: x.unit, quantity: x.quantity });
    }
    return [...per.values()];
  });
}

/** Floor Stock's last count (scope stock_levels, approved by the owner 2026-11-28). Never stored. */
export async function fetchStock(tenantId: string): Promise<StockAnswer> {
  try {
    const t = await fetchLookupTicket(kit.creds(), tenantId, "floor_stock", "stock_levels");
    if (!t) return { state: "off" };
    const res = await fetch(new URL("/api/plantops/stock-levels", t.url), { headers: { authorization: `Bearer ${t.ticket}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { state: "unreachable" };
    return { state: "in", levels: StockLevels.parse(await res.json()) };
  } catch {
    return { state: "unreachable" };
  }
}

/** Floor Stock's stock facts for S1–S4 and the morning report (scope stock_answers, owner 2026-11-28). Never stored. */
export async function fetchStockAnswers(tenantId: string): Promise<StockFacts> {
  try {
    const t = await fetchLookupTicket(kit.creds(), tenantId, "floor_stock", "stock_answers");
    if (!t) return { state: "off" };
    const res = await fetch(new URL("/api/plantops/stock-answers", t.url), { headers: { authorization: `Bearer ${t.ticket}` }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { state: "unreachable" };
    return { state: "in", s: StockAnswers.parse(await res.json()) };
  } catch {
    return { state: "unreachable" };
  }
}

// ---------- O2, O3, O5: every customer's Buying & paying ----------

/**
 * Every customer's "Buying & paying" as the customer page works it out (src/server/ledger.ts buyingAndPaying): their
 * bills (Zoho contacts matched to them included), what settled them, the paid lines of their bills and of their orders
 * not billed yet. `only` = one customer key (O5). Also each customer's latest rate per product (O5) and pending order.
 */
export async function plantBuying(tenantId: string, today: string, only?: string): Promise<{ list: CustomerBuying[]; lastRates: Map<string, Map<string, bigint>> }> {
  return withTenant(tenantId, async (tx) => {
    const who = await tx.execute<{ key: string; name: string; place: string | null; phone: string | null; href: string }>(sql`
      select 'c:' || id::text as key, name, place, phone, '/customers/' || id::text as href from order_capture.customers where tenant_id = ${tenantId} and active
      union all
      select 'z:' || id::text, name, null, mobile, '/customers/z/' || id::text from order_capture.zoho_contacts where tenant_id = ${tenantId} and customer_id is null`);
    const pay = await payingRows(tenantId);
    const lines = await tx.execute<{ bill_id: string; sku_id: string | null; item_name: string; unit: string | null; quantity: string; rate: string; line_no: number }>(sql`
      select l.bill_id, l.sku_id, l.item_name, l.unit, l.quantity::text, l.rate::text, l.line_no
        from order_capture.bill_lines l join order_capture.bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
       where l.tenant_id = ${tenantId} and not l.free and b.cancelled_at is null and not ${sql.raw(OPENING_SQL("b"))}
       order by l.line_no`);
    const orderLines = await tx.execute<{ order_id: string; customer_id: string; created_at: Date; status: string; ref_no: number; sku_id: string; product_name: string; unit: string; quantity: number }>(sql`
      select o.id as order_id, o.customer_id, o.created_at, o.status, o.ref_no, l.sku_id, l.product_name, l.unit, l.quantity
        from order_capture.orders o
        join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version and not l.free
       where o.tenant_id = ${tenantId} and o.status <> 'cancelled'
         and not exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null)`);

    const billsOf = new Map<string, PayBill[]>();
    for (const b of pay.bills) billsOf.set(b.customer_key, [...(billsOf.get(b.customer_key) ?? []), b]);
    const settlesOf = new Map<string, { bill_id: string; amount: bigint; on: string }[]>();
    for (const s of pay.settles) settlesOf.set(s.bill_id, [...(settlesOf.get(s.bill_id) ?? []), s]);
    const linesOf = new Map<string, typeof lines.rows>();
    for (const l of lines.rows) linesOf.set(l.bill_id, [...(linesOf.get(l.bill_id) ?? []), l]);
    const ordersOf = new Map<string, typeof orderLines.rows>();
    for (const l of orderLines.rows) ordersOf.set(`c:${l.customer_id}`, [...(ordersOf.get(`c:${l.customer_id}`) ?? []), l]);

    const list: CustomerBuying[] = [];
    const lastRates = new Map<string, Map<string, bigint>>();
    for (const c of who.rows) {
      if (only && c.key !== only) continue;
      const bills = billsOf.get(c.key) ?? [];
      const ol = ordersOf.get(c.key) ?? [];
      if (!bills.length && !ol.length) continue;
      // a Zoho line not linked to a product counts as the product with the same name elsewhere on this customer's lines
      const bl = bills.flatMap((b) => linesOf.get(b.id) ?? []);
      const skuByName = new Map<string, string>();
      for (const l of bl) if (l.sku_id) skuByName.set(l.item_name.trim().toLowerCase(), l.sku_id);
      for (const l of ol) skuByName.set(l.product_name.trim().toLowerCase(), l.sku_id);
      const keyOf = (sku: string | null, name: string) => sku ?? skuByName.get(name.trim().toLowerCase()) ?? `name:${name.trim().toLowerCase()}`;
      const billLines = new Map<string, InsightLine[]>();
      for (const l of bl) billLines.set(l.bill_id, [...(billLines.get(l.bill_id) ?? []), { key: keyOf(l.sku_id, l.item_name), name: l.item_name, unit: l.unit, quantity: Number(l.quantity) }]);
      const byOrder = new Map<string, InsightPurchase>();
      for (const l of ol) {
        const p = byOrder.get(l.order_id) ?? { date: new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(l.created_at)), lines: [] };
        p.lines.push({ key: keyOf(l.sku_id, l.product_name), name: l.product_name, unit: l.unit, quantity: l.quantity });
        byOrder.set(l.order_id, p);
      }
      const ins = customerInsights({
        bills,
        settles: bills.flatMap((b) => settlesOf.get(b.id) ?? []),
        billLines,
        unbilledOrders: [...byOrder.values()],
        today,
      });
      const pending = ol.filter((l) => l.status === "pending").sort((a, b) => a.ref_no - b.ref_no)[0];
      list.push({ key: c.key, href: c.href, customer: c.name, place: c.place?.trim() || null, phone: c.phone, ins, pending: pending ? orderRef(pending.ref_no) : null });
      // the latest rate per product: from the newest bill that has it
      const rates = new Map<string, bigint>();
      for (const b of [...bills].filter((x) => !x.cancelled).sort((x, y) => x.bill_date.localeCompare(y.bill_date)))
        for (const l of linesOf.get(b.id) ?? []) rates.set(keyOf(l.sku_id, l.item_name), P(l.rate));
      lastRates.set(c.key, rates);
    }
    return { list, lastRates };
  });
}

/** O5's customer search: switched-on customers by name, place or the last digits of their mobile. */
export async function findCustomers(tenantId: string, q: string) {
  const t = q.trim();
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, "");
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ id: string; name: string; place: string | null }>(sql`
      select id, name, place from order_capture.customers
       where tenant_id = ${tenantId} and active
         and (name ilike ${`%${t}%`} or place ilike ${`%${t}%`} ${digits.length >= 4 ? sql`or phone like ${`%${digits}`}` : sql``})
       order by name limit 20`);
    return r.rows.map((c) => ({ key: `c:${c.id}`, name: c.name, place: c.place }));
  });
}

// ---------- O4 ----------

export async function ordersByPlace(tenantId: string, from: string, to: string): Promise<O4Order[]> {
  return withTenant(tenantId, async (tx) => {
    const r = await tx.execute<{ date: string; customer_id: string; place: string | null; quantity: number }>(sql`
      select (o.created_at at time zone ${IST})::date::text as date, o.customer_id, cu.place,
             coalesce((select sum(l.quantity) from order_capture.order_lines l where l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version), 0)::int as quantity
        from order_capture.orders o
        join order_capture.customers cu on cu.tenant_id = o.tenant_id and cu.id = o.customer_id
       where o.tenant_id = ${tenantId} and o.status <> 'cancelled'
         and (o.created_at at time zone ${IST})::date between ${from}::date and ${to}::date`);
    return r.rows;
  });
}

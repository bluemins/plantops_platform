// The van report (cash book step C3, docs/CASHBOOK_PHASE_PLAN.md section 3.2): one report per vehicle trip. Boxes sold
// per product (rate from the last van report, else Rates), "not paid" lines, "collected from customers" lines, online,
// meal, tiffin, diesel, toll and the cash handed in. Rules: src/lib/van.ts.
//
// - The cash handed in is one 'van' cash book entry (money in) at once.
// - "Collected from customers" lines are C2's collection lines (batch = the report): they wait in To post.
// - "Not paid" lines wait in To post too (owner, 2026-11-11): posting makes a bill on the customer's account (B-number,
//   one line "Van sale (Mini, 9 Nov)", no GST, vehicle and salesperson set); or the line is turned down with a reason.
// - A wrong report: the owner cancels its cash entry (only while nothing of it is on a customer's account).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { cashRef, paise, rupees, SHORT_ALERT } from "@/lib/cash";
import { billRef } from "@/lib/ledger";
import { vanSums, type VanSale } from "@/lib/van";
import type { NotificationInput } from "@plantops/types";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { addDays, cashLists, cashLock, closesOf, entryWindow, istToday } from "./cash";
import { linesOfEntries } from "./collections";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import { activeProducts, effectiveRates } from "./rates";
import type { OcUser } from "./session";

const { billLines, bills, cashEntries, cashVehicles, collectionLines, customers, vanCreditLines, vanCreditPosts, vanReportLines, vanReports } = schema;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const Day = z.string().regex(YMD, "date as YYYY-MM-DD");
const Amount = z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "amount in rupees, e.g. 500 or 1250.50");
const Opt = Amount.optional().default("0");
const Reason = z.string().trim().min(3, "Please give a reason (at least 3 letters)").max(300);

// ---------- the form ----------

/** Products grouped by brand with the rate to pre-fill (the last van report's, else Rates), vehicles, people. */
export async function vanForm(user: OcUser) {
  requireAccess(user, "cash_enter");
  const [products, lists] = await Promise.all([activeProducts(user.tenantId), cashLists(user)]);
  return withTenant(user.tenantId, async (tx) => {
    const rates = await effectiveRates(tx, user.tenantId, products);
    const last = new Map(
      (
        await tx.execute<{ sku_id: string; rate: string }>(sql`
          select distinct on (l.sku_id) l.sku_id, l.rate::text from order_capture.van_report_lines l
            join order_capture.van_reports r on r.tenant_id = l.tenant_id and r.id = l.report_id
           where l.tenant_id = ${user.tenantId} and l.quantity > 0 order by l.sku_id, r.created_at desc`)
      ).rows.map((r) => [r.sku_id, r.rate]),
    );
    const items = rates
      .filter((r) => r.brand !== "") // products without a brand (empty jars, dispensers) are not van sales
      .map((r) => ({ sku_id: r.sku_id, product: r.product, brand: r.brand, unit: r.unit, rate: last.get(r.sku_id) ?? r.default_rate ?? "" }));
    return { items, vehicles: lists.vehicles.filter((v) => v.active), people: lists.people, names: lists.names };
  });
}
export type VanForm = Awaited<ReturnType<typeof vanForm>>;

// ---------- saving ----------

const Party = z.object({ customer_id: z.uuid(), amount: Amount, note: z.string().trim().max(300).optional() });

export const VanInput = z.object({
  cash_date: Day,
  work_date: Day.optional(),
  vehicle_id: z.uuid(),
  person_user_id: z.uuid().optional(),
  person_name: z.string().trim().min(1).max(100).optional(),
  lines: z
    .array(
      z.object({
        sku_id: z.uuid(),
        quantity: z.number().int().min(0).max(100000),
        rate: Amount,
        loaded: z.number().int().min(0).max(100000).optional(),
        returned: z.number().int().min(0).max(100000).optional(),
      }),
    )
    .max(200),
  not_paid: z.array(Party).max(100).default([]),
  collected: z.array(Party.extend({ mode: z.enum(["cash", "upi"]) })).max(100).default([]),
  online: Opt,
  meal: Opt,
  tiffin: Opt,
  diesel: Opt,
  toll: Opt,
  handed_in: Amount,
  note: z.string().trim().max(300).optional(),
});
export type VanInput = z.infer<typeof VanInput>;

export interface SavedVan {
  id: string;
  ref: string;
  vehicle: string;
  person: string;
  cash_date: string;
  work_date: string;
  sales: string;
  expected: string;
  handed_in: string;
  difference: string;
  not_paid: number;
  collected: number;
}

export async function addVanReport(user: OcUser, input: VanInput, today = istToday()): Promise<SavedVan> {
  requireAccess(user, "cash_enter");
  const work = input.work_date ?? input.cash_date;
  if (work > input.cash_date) throw badRequest("The work day can't be after the day the cash came in");
  if (work < addDays(input.cash_date, -31)) throw badRequest("The work day can be at most 31 days earlier");
  if (!input.person_user_id && !input.person_name) throw badRequest("Who drove / sold? Pick or type a name.");
  const lines = input.lines.filter((l) => l.quantity > 0 || l.loaded !== undefined || l.returned !== undefined);
  if (!lines.some((l) => l.quantity > 0) && !input.collected.length) throw badRequest("Type the boxes sold (or what was collected)");
  if (new Set(lines.map((l) => l.sku_id)).size !== lines.length) throw badRequest("A product is in the list twice");
  for (const x of [...input.not_paid, ...input.collected]) if (paise(x.amount) <= 0n) throw badRequest("Each amount must be more than ₹0");
  const handed = paise(input.handed_in);
  if (handed <= 0n) throw badRequest("Cash handed in: more than ₹0 (a trip with no cash: enter its collections with + Collection)");
  const [products, contacts] = await Promise.all([activeProducts(user.tenantId), input.person_user_id ? kit.contacts(user.tenantId) : Promise.resolve(null)]);

  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await cashLock(tx, t);
    const closes = await closesOf(tx, t);
    if (!closes.length) throw badRequest("The cash book hasn't been started yet. The owner starts it with today's cash count.");
    const w = entryWindow(closes.at(-1)!.cash_date, today);
    if (input.cash_date > w.to) throw badRequest("The cash day can't be after today");
    if (input.cash_date < w.from) throw badRequest(input.cash_date <= closes.at(-1)!.cash_date ? `${input.cash_date} is already closed. Put it on today's sheet (the work day can stay ${work}).` : "At most 7 days back");

    const [van] = await tx.select().from(cashVehicles).where(and(eq(cashVehicles.tenantId, t), eq(cashVehicles.id, input.vehicle_id)));
    if (!van || !van.active) throw badRequest("That vehicle isn't on the list. Pick again.");
    let personId: string | null = null;
    let personName: string;
    if (input.person_user_id) {
      const c = (contacts ?? []).find((x) => x.user_id === input.person_user_id);
      if (!c) throw badRequest("That person isn't one of the plant's people. Pick again or type the name.");
      personId = c.user_id;
      personName = c.display_name;
    } else personName = input.person_name!;

    const rates = new Map((await effectiveRates(tx, t, products)).map((r) => [r.sku_id, r]));
    const unknown = lines.find((l) => !rates.has(l.sku_id));
    if (unknown) throw badRequest("A product isn't one of the plant's active products any more. Reload the page.");
    const ids = [...new Set([...input.not_paid, ...input.collected].map((x) => x.customer_id))];
    const found = ids.length ? await tx.select({ id: customers.id, active: customers.active }).from(customers).where(and(eq(customers.tenantId, t), inArray(customers.id, ids))) : [];
    if (found.filter((c) => c.active).length !== ids.length) throw badRequest("A customer on the report isn't in Sales (or is switched off). Pick again.");

    const sales: VanSale[] = lines.map((l) => ({ product: rates.get(l.sku_id)!.product, brand: rates.get(l.sku_id)!.brand, quantity: l.quantity, rate: l.rate }));
    const s = vanSums({
      sales,
      not_paid: input.not_paid.map((x) => x.amount),
      collected_cash: input.collected.filter((c) => c.mode === "cash").map((c) => c.amount),
      collected_online: input.collected.filter((c) => c.mode === "upi").map((c) => c.amount),
      online: input.online,
      meal: input.meal,
      tiffin: input.tiffin,
      diesel: input.diesel,
      toll: input.toll,
    });

    const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(ref_no), 0)::int + 1 as n from order_capture.cash_entries where tenant_id = ${t}`)).rows as [{ n: number }];
    const [entry] = await tx
      .insert(cashEntries)
      .values({ tenantId: t, refNo: n, cashDate: input.cash_date, workDate: work, kind: "van", direction: "in", amount: rupees(handed), vehicleId: van.id, personUserId: personId, note: `Van ${van.name} · ${personName}`.slice(0, 300), createdBy: user.userId, createdByName: user.name })
      .returning({ id: cashEntries.id });
    const [rep] = await tx
      .insert(vanReports)
      .values({
        tenantId: t,
        cashEntryId: entry!.id,
        vehicleId: van.id,
        workDate: work,
        personUserId: personId,
        personName,
        sales: rupees(s.sales),
        notPaid: rupees(s.not_paid),
        collectedCash: rupees(s.collected_cash),
        collectedOnline: rupees(s.collected_online),
        online: rupees(s.online),
        meal: rupees(s.meal),
        tiffin: rupees(s.tiffin),
        diesel: rupees(s.diesel),
        toll: rupees(s.toll),
        expected: rupees(s.expected),
        handedIn: rupees(handed),
        difference: rupees(handed - s.expected),
        note: input.note || null,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning({ id: vanReports.id });
    const rid = rep!.id;
    if (lines.length)
      await tx.insert(vanReportLines).values(
        lines.map((l, i) => {
          const r = rates.get(l.sku_id)!;
          return { tenantId: t, reportId: rid, lineNo: i + 1, skuId: l.sku_id, productName: r.product, brand: r.brand, unit: r.unit.slice(0, 20), quantity: l.quantity, rate: rupees(paise(l.rate)), amount: rupees(BigInt(l.quantity) * paise(l.rate)), loaded: l.loaded ?? null, returned: l.returned ?? null };
        }),
      );
    if (input.not_paid.length)
      await tx.insert(vanCreditLines).values(input.not_paid.map((x, i) => ({ tenantId: t, reportId: rid, lineNo: i + 1, customerId: x.customer_id, amount: rupees(paise(x.amount)), note: x.note || null })));
    if (input.collected.length)
      await tx.insert(collectionLines).values(
        input.collected.map((x, i) => ({ tenantId: t, batchId: rid, lineNo: i + 1, cashEntryId: entry!.id, customerId: x.customer_id, amount: rupees(paise(x.amount)), mode: x.mode, workDate: work, note: x.note || null, createdBy: user.userId, createdByName: user.name })),
      );
    const saved: SavedVan = { id: rid, ref: cashRef(n), vehicle: van.name, person: personName, cash_date: input.cash_date, work_date: work, sales: rupees(s.sales), expected: rupees(s.expected), handed_in: rupees(handed), difference: rupees(handed - s.expected), not_paid: input.not_paid.length, collected: input.collected.length };
    await audit(tx, user, "cash.van", entry!.id, { ref: saved.ref, vehicle: van.name, person: personName, date: work, sales: saved.sales, handed_in: saved.handed_in, difference: saved.difference });
    return saved;
  });
}

/** A van more than ₹100 short or extra: owners on the phone (the existing "cash short" alert). */
export function vanShortNotification(user: OcUser, v: SavedVan): NotificationInput | null {
  const d = paise(v.difference);
  if (d < SHORT_ALERT && -d < SHORT_ALERT) return null;
  const amt = (p: bigint) => `₹${(p < 0n ? -p : p) / 100n}`;
  return {
    kind: "order_capture.cash_short",
    title: `Van ${v.vehicle} ${d < 0n ? "short" : "extra"} ${amt(d)} (${v.work_date.slice(8)}/${v.work_date.slice(5, 7)})`.slice(0, 80),
    body: `Cash to hand in ₹${rupees(paise(v.expected)).replace(/\.00$/, "")}, handed in ₹${rupees(paise(v.handed_in)).replace(/\.00$/, "")} (${v.ref}, ${v.person}; by ${user.name})`.slice(0, 300),
    link: `/cash/van/${v.id}`,
    level: "push",
    dedupe_key: `van_short:${v.id}`,
    exclude_user_id: user.userId,
  };
}

// ---------- reading ----------

export type CreditStatus = "waiting" | "billed" | "turned_down" | "void";

async function creditLinesWithStatus(tx: OcTx, t: string, where = sql`true`) {
  const rows = await tx.execute<{
    id: string; report_id: string; line_no: number; customer_id: string; customer_name: string; amount: string; note: string | null;
    work_date: string; vehicle: string; person: string; entry_ref: number; entry_cancelled: boolean; created_by_name: string;
    outcome: "billed" | "turned_down" | null; bill_id: string | null; bill_number: string | null; bill_cancelled: boolean | null; bill_customer: string | null; reason: string | null; posted_by: string | null;
  }>(sql`
    select c.id, c.report_id, c.line_no, c.customer_id, cu.name as customer_name, c.amount::text, c.note,
           r.work_date::text, v.name as vehicle, r.person_name as person, e.ref_no as entry_ref, e.cancelled_at is not null as entry_cancelled, r.created_by_name,
           p.outcome, p.bill_id, b.number as bill_number, b.cancelled_at is not null as bill_cancelled, b.customer_name as bill_customer, p.reason, p.created_by_name as posted_by
      from order_capture.van_credit_lines c
      join order_capture.van_reports r on r.tenant_id = c.tenant_id and r.id = c.report_id
      join order_capture.cash_entries e on e.tenant_id = r.tenant_id and e.id = r.cash_entry_id
      join order_capture.cash_vehicles v on v.tenant_id = r.tenant_id and v.id = r.vehicle_id
      join order_capture.customers cu on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
      left join lateral (select * from order_capture.van_credit_posts x where x.tenant_id = c.tenant_id and x.credit_line_id = c.id order by x.created_at desc limit 1) p on true
      left join order_capture.bills b on b.tenant_id = c.tenant_id and b.id = p.bill_id
     where c.tenant_id = ${t} and ${where}
     order by r.work_date, r.created_at, c.line_no`);
  return rows.rows.map((r) => {
    const status: CreditStatus = r.outcome === "turned_down" ? "turned_down" : r.outcome === "billed" && !r.bill_cancelled ? "billed" : r.entry_cancelled ? "void" : "waiting";
    return {
      id: r.id,
      report_id: r.report_id,
      line_no: r.line_no,
      customer: { id: r.customer_id, name: r.customer_name },
      amount: r.amount,
      note: r.note,
      work_date: r.work_date,
      vehicle: r.vehicle,
      person: r.person,
      entry: cashRef(r.entry_ref),
      by: r.created_by_name,
      status,
      bill: status === "billed" ? { id: r.bill_id!, number: r.bill_number!, customer: r.bill_customer! } : null,
      turned_down: status === "turned_down" ? { reason: r.reason!, by: r.posted_by! } : null,
    };
  });
}
export type CreditLine = Awaited<ReturnType<typeof creditLinesWithStatus>>[number];

/** "Not paid" lines for To post: waiting ones (oldest first), or all. */
export async function creditList(user: OcUser, show: "waiting" | "all" = "waiting") {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, async (tx) => {
    const all = await creditLinesWithStatus(tx, user.tenantId);
    const waiting = all.filter((l) => l.status === "waiting");
    return { lines: show === "waiting" ? waiting : [...all].reverse().slice(0, 300), waiting: { count: waiting.length, amount: rupees(waiting.reduce((s, l) => s + paise(l.amount), 0n)) } };
  });
}

/** Cash entries of these ids that are van reports: id → report id (for the day sheet's link). */
export async function reportsOfEntries(user: OcUser, entryIds: string[]) {
  requireAccess(user, "cash_view");
  if (!entryIds.length) return new Map<string, { id: string; vehicle: string; person: string; difference: string }>();
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ entry: vanReports.cashEntryId, id: vanReports.id, vehicle: cashVehicles.name, person: vanReports.personName, difference: vanReports.difference })
      .from(vanReports)
      .innerJoin(cashVehicles, and(eq(cashVehicles.tenantId, vanReports.tenantId), eq(cashVehicles.id, vanReports.vehicleId)))
      .where(and(eq(vanReports.tenantId, user.tenantId), inArray(vanReports.cashEntryId, entryIds)));
    return new Map(rows.map((r) => [r.entry, { id: r.id, vehicle: r.vehicle, person: r.person, difference: r.difference }]));
  });
}

/** One van report with everything on it. */
export async function vanReport(user: OcUser, id: string) {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const [r] = await tx.select().from(vanReports).where(and(eq(vanReports.tenantId, t), eq(vanReports.id, id)));
    if (!r) throw notFound("Van report not found");
    const [e] = await tx.select().from(cashEntries).where(and(eq(cashEntries.tenantId, t), eq(cashEntries.id, r.cashEntryId)));
    const [v] = await tx.select().from(cashVehicles).where(and(eq(cashVehicles.tenantId, t), eq(cashVehicles.id, r.vehicleId)));
    const lines = await tx.select().from(vanReportLines).where(and(eq(vanReportLines.tenantId, t), eq(vanReportLines.reportId, id))).orderBy(asc(vanReportLines.lineNo));
    const credits = await creditLinesWithStatus(tx, t, sql`c.report_id = ${id}::uuid`);
    const collected = await linesOfEntries(tx, t, [r.cashEntryId]);
    return {
      id: r.id,
      ref: cashRef(e!.refNo),
      entry_id: e!.id,
      cancelled: e!.cancelledAt ? { by: e!.cancelledByName ?? "", reason: e!.cancelReason ?? "" } : null,
      cash_date: e!.cashDate,
      work_date: r.workDate,
      vehicle: v!.name,
      person: r.personName,
      lines: lines.map((l) => ({ product: l.productName, brand: l.brand, unit: l.unit, quantity: l.quantity, rate: l.rate, amount: l.amount, loaded: l.loaded, returned: l.returned })),
      credits,
      collected,
      sales: r.sales,
      not_paid: r.notPaid,
      collected_cash: r.collectedCash,
      collected_online: r.collectedOnline,
      online: r.online,
      meal: r.meal,
      tiffin: r.tiffin,
      diesel: r.diesel,
      toll: r.toll,
      expected: r.expected,
      handed_in: r.handedIn,
      difference: r.difference,
      note: r.note,
      by: r.createdByName,
      at: r.createdAt.toISOString(),
    };
  });
}
export type VanReportView = Awaited<ReturnType<typeof vanReport>>;

/** Recent van reports (newest first), for the Van reports list. */
export async function vanReportsList(user: OcUser, limit = 60) {
  requireAccess(user, "cash_view");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: vanReports.id, work_date: vanReports.workDate, vehicle: cashVehicles.name, person: vanReports.personName, sales: vanReports.sales, handed_in: vanReports.handedIn, difference: vanReports.difference, ref: cashEntries.refNo, cancelled: sql<boolean>`${cashEntries.cancelledAt} is not null` })
      .from(vanReports)
      .innerJoin(cashVehicles, and(eq(cashVehicles.tenantId, vanReports.tenantId), eq(cashVehicles.id, vanReports.vehicleId)))
      .innerJoin(cashEntries, and(eq(cashEntries.tenantId, vanReports.tenantId), eq(cashEntries.id, vanReports.cashEntryId)))
      .where(eq(vanReports.tenantId, user.tenantId))
      .orderBy(desc(vanReports.workDate), desc(vanReports.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, ref: cashRef(r.ref) }));
  });
}

// ---------- posting a "not paid" line ----------

export const BillCreditInput = z.object({ customer_id: z.uuid().optional() });
export const TurnDownCreditInput = z.object({ reason: Reason });

const creditLock = (tx: OcTx, t: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.van_credit'), hashtext(${t}))`);

async function waitingCredit(tx: OcTx, t: string, id: string) {
  const [l] = await creditLinesWithStatus(tx, t, sql`c.id = ${id}::uuid`);
  if (!l) throw notFound("Not-paid line not found");
  if (l.status === "billed") throw conflict(`Already billed as ${l.bill!.number}`);
  if (l.status === "turned_down") throw conflict("This line was turned down");
  if (l.status === "void") throw conflict(`Cash book entry ${l.entry} was cancelled, so this line can't be billed`);
  return l;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Owner, Accounts: bill the "not paid" line on the customer's account (B-number, no GST), maybe another customer's. */
export async function billCredit(user: OcUser, id: string, input: z.infer<typeof BillCreditInput>) {
  requireAccess(user, "collection_post");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await creditLock(tx, t);
    const l = await waitingCredit(tx, t, id);
    const custId = input.customer_id ?? l.customer.id;
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, t), eq(customers.id, custId)));
    if (!c) throw notFound("Customer not found");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.bill'), hashtext(${t}))`);
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${bills.refNo}), 0)::int + 1` }).from(bills).where(eq(bills.tenantId, t))) as [{ next: number }];
    const what = `Van sale (${l.vehicle}, ${shortDate(l.work_date)})`;
    const [b] = await tx
      .insert(bills)
      .values({
        tenantId: t,
        source: "plantops",
        number: billRef(next),
        refNo: next,
        billDate: l.work_date,
        dueDate: l.work_date,
        terms: "receipt",
        customerId: c.id,
        customerName: c.name,
        subTotal: l.amount,
        total: l.amount,
        notes: `${what}, not paid on the trip (${l.entry})${l.note ? `: ${l.note}` : ""}${c.id !== l.customer.id ? `. Typed for ${l.customer.name}` : ""}`.slice(0, 2000),
        salesperson: l.person.slice(0, 100),
        vehicle: l.vehicle.slice(0, 40),
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning({ id: bills.id, number: bills.number });
    await tx.insert(billLines).values({ tenantId: t, billId: b!.id, lineNo: 1, itemName: what, quantity: "1", rate: l.amount, lineTotal: l.amount });
    await tx.insert(vanCreditPosts).values({ tenantId: t, creditLineId: id, outcome: "billed", billId: b!.id, createdBy: user.userId, createdByName: user.name });
    await audit(tx, user, "van.credit_bill", id, { bill: b!.number, customer: c.name, amount: l.amount, entry: l.entry, vehicle: l.vehicle });
    return { id: b!.id, number: b!.number, customer: c.name, amount: l.amount };
  });
}

/** Owner, Accounts: the "not paid" line was not credit after all (e.g. paid later the same day), with a reason. */
export async function turnDownCredit(user: OcUser, id: string, input: z.infer<typeof TurnDownCreditInput>) {
  requireAccess(user, "collection_post");
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    await creditLock(tx, t);
    const l = await waitingCredit(tx, t, id);
    await tx.insert(vanCreditPosts).values({ tenantId: t, creditLineId: id, outcome: "turned_down", reason: input.reason, createdBy: user.userId, createdByName: user.name });
    await audit(tx, user, "van.credit_turn_down", id, { customer: l.customer.name, amount: l.amount, entry: l.entry, reason: input.reason });
    return { ok: true };
  });
}

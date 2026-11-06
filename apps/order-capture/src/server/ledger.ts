// The sales ledger on screen and in use (docs/ZOHO_IMPORT_PHASE_PLAN.md sections 6–7, steps L4 + L5): a customer's
// account (bills, orders, payments, statement), the plant's Bills and Payments lists, one bill, and the actions:
// Make bill from a delivered order, Receive payment, cancel a bill / payment (owner, with a reason), the Zoho GST
// invoice no. on a bill. Money rules: src/lib/ledger.ts (nothing about money is stored as a running figure).
//
// A customer's account = rows of the customer plus rows of every Zoho contact linked to them (imported bills point at
// the contact, so linking a contact on the Match screen moves its history here). A Zoho contact not matched yet has the
// same page, read-only for payments (a payment needs a customer).
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  allocatePayment,
  billDue,
  billRef,
  billStatus,
  ledgerTotals,
  orderLedgerStatus,
  paise,
  paymentRef,
  paymentUnused,
  rupees,
  statement,
  useAdvances,
  type LedgerAdjustment,
  type LedgerAllocation,
  type LedgerBill,
  type LedgerPayment,
} from "@/lib/ledger";
import { formatRef } from "@/lib/ref";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { billAdjustments, billLines, bills, customers, orderLines, orders, paymentAllocations, payments, zohoContacts } = schema;

const IST = "Asia/Kolkata";
export const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const P = (s: string | null) => (s === null ? 0n : paise(s));

// ---------- whose rows ----------

export type Party = { kind: "customer"; id: string } | { kind: "contact"; id: string };

async function partyScope(tx: OcTx, tenantId: string, party: Party) {
  if (party.kind === "customer") {
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, party.id)));
    if (!c) throw notFound("Customer not found");
    const contacts = await tx.select().from(zohoContacts).where(and(eq(zohoContacts.tenantId, tenantId), eq(zohoContacts.customerId, c.id)));
    return { customer: c, contact: null, contactIds: contacts.map((x) => x.id), contacts };
  }
  const [z1] = await tx.select().from(zohoContacts).where(and(eq(zohoContacts.tenantId, tenantId), eq(zohoContacts.id, party.id)));
  if (!z1) throw notFound("Zoho contact not found");
  return { customer: null, contact: z1, contactIds: [z1.id], contacts: [z1] };
}

const ownedBy = <T extends { customerId: unknown; zohoContactId: unknown }>(t: T, customerId: string | null, contactIds: string[]) =>
  or(
    customerId ? eq(t.customerId as never, customerId) : sql`false`,
    contactIds.length ? inArray(t.zohoContactId as never, contactIds) : sql`false`,
  );

/** Every ledger row of one party, as the money rules want them. */
async function partyFacts(tx: OcTx, tenantId: string, customerId: string | null, contactIds: string[]) {
  const b = await tx.select().from(bills).where(and(eq(bills.tenantId, tenantId), ownedBy(bills, customerId, contactIds)));
  const p = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), ownedBy(payments, customerId, contactIds)));
  const billIds = b.map((x) => x.id);
  const payIds = p.map((x) => x.id);
  const allocs =
    billIds.length || payIds.length
      ? await tx
          .select()
          .from(paymentAllocations)
          .where(
            and(
              eq(paymentAllocations.tenantId, tenantId),
              or(billIds.length ? inArray(paymentAllocations.billId, billIds) : sql`false`, payIds.length ? inArray(paymentAllocations.paymentId, payIds) : sql`false`),
            ),
          )
      : [];
  const adjs = billIds.length ? await tx.select().from(billAdjustments).where(and(eq(billAdjustments.tenantId, tenantId), inArray(billAdjustments.billId, billIds))) : [];
  const L = {
    bills: b.map((x): LedgerBill => ({ id: x.id, number: x.number, bill_date: x.billDate, due_date: x.dueDate, total: P(x.total), cancelled: !!x.cancelledAt, order_id: x.orderId })),
    payments: p.map((x): LedgerPayment => ({ id: x.id, number: x.number, payment_date: x.paymentDate, amount: P(x.amount), cancelled: !!x.cancelledAt })),
    allocations: allocs.map((a): LedgerAllocation => ({ payment_id: a.paymentId, bill_id: a.billId, amount: P(a.amount) })),
    adjustments: adjs.map((a): LedgerAdjustment => ({ bill_id: a.billId, amount: P(a.amount), adjusted_on: a.adjustedOn })),
  };
  return { rows: { bills: b, payments: p, allocations: allocs, adjustments: adjs }, L };
}

// ---------- a customer's (or an unmatched Zoho contact's) account ----------

export async function account(user: OcUser, party: Party, range: { from?: string; to?: string } = {}) {
  requireAccess(user, "ledger_view");
  return withTenant(user.tenantId, async (tx) => {
    const scope = await partyScope(tx, user.tenantId, party);
    const { rows, L } = await partyFacts(tx, user.tenantId, scope.customer?.id ?? null, scope.contactIds);
    const today = istToday();
    const orderIds = rows.bills.map((b) => b.orderId).filter(Boolean) as string[];
    const custOrders = scope.customer
      ? await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.customerId, scope.customer.id)))
      : orderIds.length
        ? await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), inArray(orders.id, orderIds)))
        : [];
    const refOf = new Map(custOrders.map((o) => [o.id, formatRef(o.refNo)]));
    const billViews = L.bills
      .map((b) => {
        const due = billDue(b, L.allocations, L.adjustments);
        const r = rows.bills.find((x) => x.id === b.id)!;
        return {
          id: b.id,
          number: b.number,
          source: r.source,
          opening_balance: r.zohoInvoiceId?.startsWith("ob:") ?? false,
          bill_date: b.bill_date,
          due_date: b.due_date,
          total: rupees(b.total),
          due: rupees(due > 0n ? due : 0n),
          status: billStatus(b, due, today),
          order: b.order_id ? { id: b.order_id, ref: refOf.get(b.order_id) ?? "" } : null,
          gst_invoice_no: r.zohoGstInvoiceNo,
        };
      })
      .sort((a, b) => b.bill_date.localeCompare(a.bill_date) || b.number.localeCompare(a.number, "en", { numeric: true }));
    const paymentViews = L.payments
      .map((p) => {
        const r = rows.payments.find((x) => x.id === p.id)!;
        const unused = paymentUnused(p, L.allocations);
        return {
          id: p.id,
          number: p.number,
          source: r.source,
          payment_date: p.payment_date,
          mode: r.mode,
          reference: r.reference,
          amount: rupees(p.amount),
          unused: rupees(unused > 0n ? unused : 0n),
          cancelled: p.cancelled,
          cancel_reason: r.cancelReason,
        };
      })
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.number.localeCompare(a.number, "en", { numeric: true }));
    const billByOrder = new Map(L.bills.filter((b) => b.order_id && !b.cancelled).map((b) => [b.order_id!, b]));
    const orderViews = custOrders
      .map((o) => {
        const b = billByOrder.get(o.id);
        const due = b ? billDue(b, L.allocations, L.adjustments) : null;
        return {
          id: o.id,
          ref: formatRef(o.refNo),
          created_at: o.createdAt.toISOString(),
          status: orderLedgerStatus(o.status, b ? { cancelled: false, due: due! } : null),
          total: o.total,
          bill: b ? { id: b.id, number: b.number, due: rupees(due! > 0n ? due! : 0n) } : null,
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const t = ledgerTotals(L.bills, L.payments, L.allocations, L.adjustments);
    const st = statement(L.bills, L.payments, L.adjustments, { from: range.from && YMD.test(range.from) ? range.from : undefined, to: range.to && YMD.test(range.to) ? range.to : undefined });
    const payNumber = new Map(rows.payments.map((p) => [p.number, p]));
    const lastPayment = paymentViews.find((p) => !p.cancelled) ?? null;
    return {
      party: scope.customer
        ? { kind: "customer" as const, id: scope.customer.id, name: scope.customer.name, phone: scope.customer.phone, place: scope.customer.place, active: scope.customer.active }
        : { kind: "contact" as const, id: scope.contact!.id, name: scope.contact!.name, phone: scope.contact!.mobile, place: null, active: true },
      zoho_names: scope.contacts.map((c) => c.name),
      totals: { billed: rupees(t.billed), received: rupees(t.received), adjusted: rupees(t.adjusted), due: rupees(t.due), advance: rupees(t.advance), balance: rupees(t.balance) },
      last_payment: lastPayment,
      bills: billViews,
      open_bills: billViews.filter((b) => b.status !== "paid" && b.status !== "cancelled"),
      payments: paymentViews,
      orders: orderViews,
      statement: {
        opening: rupees(st.opening),
        closing: rupees(st.closing),
        rows: st.rows.map((r) => ({
          date: r.date,
          kind: r.kind,
          number: r.number,
          mode: r.kind === "payment" ? (payNumber.get(r.number)?.mode ?? null) : null,
          debit: rupees(r.debit),
          credit: rupees(r.credit),
          balance: rupees(r.balance),
        })),
      },
    };
  });
}
export type Account = Awaited<ReturnType<typeof account>>;

// ---------- the plant's Bills and Payments lists ----------

export const BILL_FILTERS = ["open", "overdue", "paid", "cancelled", "all"] as const;
export type BillFilter = (typeof BILL_FILTERS)[number];

export async function billsList(user: OcUser, f: { show?: BillFilter; q?: string; from?: string; to?: string } = {}, limit = 200) {
  requireAccess(user, "ledger_view");
  const today = istToday();
  return withTenant(user.tenantId, async (tx) => {
    const show = f.show ?? "open";
    const q = (f.q ?? "").trim().slice(0, 100);
    const digits = q.replace(/\D/g, "");
    const rows = await tx.execute<{
      id: string; number: string; source: string; bill_date: string; due_date: string | null; total: string; due: string; cancelled: boolean;
      order_id: string | null; ref_no: number | null; name: string; customer_id: string | null; contact_id: string | null; phone: string | null; ob: boolean;
    }>(sql`
      with paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${user.tenantId} group by bill_id),
           adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${user.tenantId} group by bill_id),
           b as (
             select b.id, b.number, b.source, b.bill_date::text, b.due_date::text, b.total::text,
                    (b.total - coalesce(p.s, 0) - coalesce(a.s, 0)) as due_n, b.cancelled_at is not null as cancelled,
                    b.order_id, o.ref_no, coalesce(cu.name, zc.name, b.customer_name) as name, cu.id as customer_id,
                    case when cu.id is null then zc.id end as contact_id, coalesce(cu.phone, zc.mobile) as phone,
                    coalesce(b.zoho_invoice_id like 'ob:%', false) as ob
               from order_capture.bills b
               left join paid p on p.bill_id = b.id
               left join adj a on a.bill_id = b.id
               left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
               left join order_capture.customers cu on cu.tenant_id = b.tenant_id and cu.id = coalesce(b.customer_id, zc.customer_id)
               left join order_capture.orders o on o.tenant_id = b.tenant_id and o.id = b.order_id
              where b.tenant_id = ${user.tenantId})
      select *, greatest(due_n, 0)::numeric(18, 2)::text as due from b
       where (${show} = 'all'
              or (${show} = 'open' and not cancelled and due_n > 0)
              or (${show} = 'overdue' and not cancelled and due_n > 0 and due_date::date < ${today}::date)
              or (${show} = 'paid' and not cancelled and due_n <= 0)
              or (${show} = 'cancelled' and cancelled))
         and (${q} = '' or number ilike ${"%" + q + "%"} or name ilike ${"%" + q + "%"} or (${digits} <> '' and length(${digits}) >= 4 and phone like ${"%" + digits + "%"}))
         and bill_date::date between ${f.from && YMD.test(f.from) ? f.from : "1900-01-01"}::date and ${f.to && YMD.test(f.to) ? f.to : "2999-12-31"}::date
       order by ${show === "open" || show === "overdue" ? sql`bill_date asc, number asc` : sql`bill_date desc, number desc`}
       limit ${limit + 1}`);
    const summary = await tx.execute<{ due: string; open: number; overdue: number }>(sql`
      with paid as (select bill_id, sum(amount) s from order_capture.payment_allocations where tenant_id = ${user.tenantId} group by bill_id),
           adj as (select bill_id, sum(amount) s from order_capture.bill_adjustments where tenant_id = ${user.tenantId} group by bill_id),
           d as (select b.due_date, b.total - coalesce(p.s, 0) - coalesce(a.s, 0) as due
                   from order_capture.bills b left join paid p on p.bill_id = b.id left join adj a on a.bill_id = b.id
                  where b.tenant_id = ${user.tenantId} and b.cancelled_at is null)
      select coalesce(sum(due) filter (where due > 0), 0)::numeric(18, 2)::text as due, count(*) filter (where due > 0)::int as open,
             count(*) filter (where due > 0 and due_date < ${today}::date)::int as overdue from d`);
    const list = rows.rows.slice(0, limit).map((r) => {
      const due = paise(r.due);
      const fake: LedgerBill = { id: r.id, number: r.number, bill_date: r.bill_date, due_date: r.due_date, total: paise(r.total), cancelled: r.cancelled, order_id: r.order_id };
      return {
        id: r.id,
        number: r.number,
        source: r.source,
        opening_balance: r.ob,
        bill_date: r.bill_date,
        total: r.total,
        due: r.due,
        status: billStatus(fake, due, today),
        order_ref: r.ref_no ? formatRef(r.ref_no) : null,
        name: r.name,
        customer_id: r.customer_id,
        contact_id: r.contact_id,
      };
    });
    // the plant's totals: owner (and support) only; Order desk sees the list, not the totals (owner, 2026-11-06)
    return { bills: list, more: rows.rows.length > limit, summary: can(user, "ledger_totals") ? summary.rows[0]! : null };
  });
}

export async function paymentsList(user: OcUser, f: { q?: string; from?: string; to?: string; mode?: string } = {}, limit = 200) {
  requireAccess(user, "ledger_view");
  return withTenant(user.tenantId, async (tx) => {
    const q = (f.q ?? "").trim().slice(0, 100);
    const mode = ["cash", "upi", "bank", "cheque", "other"].includes(f.mode ?? "") ? f.mode! : "";
    const from = f.from && YMD.test(f.from) ? f.from : "1900-01-01";
    const to = f.to && YMD.test(f.to) ? f.to : "2999-12-31";
    const rows = await tx.execute<{
      id: string; number: string; source: string; payment_date: string; mode: string; reference: string | null; amount: string; unused: string;
      cancelled: boolean; name: string; customer_id: string | null; contact_id: string | null;
    }>(sql`
      select p.id, p.number, p.source, p.payment_date::text, p.mode, p.reference, p.amount::text,
             case when p.cancelled_at is null then greatest(p.amount - coalesce((select sum(a.amount) from order_capture.payment_allocations a where a.payment_id = p.id), 0), 0) else 0 end::numeric(18, 2)::text as unused,
             p.cancelled_at is not null as cancelled, coalesce(cu.name, zc.name, p.customer_name) as name, cu.id as customer_id,
             case when cu.id is null then zc.id end as contact_id
        from order_capture.payments p
        left join order_capture.zoho_contacts zc on zc.tenant_id = p.tenant_id and zc.id = p.zoho_contact_id
        left join order_capture.customers cu on cu.tenant_id = p.tenant_id and cu.id = coalesce(p.customer_id, zc.customer_id)
       where p.tenant_id = ${user.tenantId}
         and (${mode} = '' or p.mode = ${mode})
         and p.payment_date between ${from}::date and ${to}::date
         and (${q} = '' or p.number ilike ${"%" + q + "%"} or coalesce(cu.name, zc.name, p.customer_name) ilike ${"%" + q + "%"} or coalesce(p.reference, '') ilike ${"%" + q + "%"})
       order by p.payment_date desc, p.created_at desc
       limit ${limit + 1}`);
    const total = await tx.execute<{ n: number; sum: string }>(sql`
      select count(*)::int as n, coalesce(sum(amount), 0)::numeric(18, 2)::text as sum from order_capture.payments
       where tenant_id = ${user.tenantId} and cancelled_at is null and (${mode} = '' or mode = ${mode}) and payment_date between ${from}::date and ${to}::date`);
    return { payments: rows.rows.slice(0, limit), more: rows.rows.length > limit, total: can(user, "ledger_totals") ? total.rows[0]! : null };
  });
}

// ---------- one bill ----------

export async function billDetail(user: OcUser, id: string) {
  requireAccess(user, "ledger_view");
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.id, id)));
    if (!b) throw notFound("Bill not found");
    const lines = await tx.select().from(billLines).where(and(eq(billLines.tenantId, user.tenantId), eq(billLines.billId, id))).orderBy(billLines.lineNo);
    const allocs = await tx
      .select({ a: paymentAllocations, number: payments.number, mode: payments.mode, date: payments.paymentDate })
      .from(paymentAllocations)
      .innerJoin(payments, and(eq(payments.tenantId, paymentAllocations.tenantId), eq(payments.id, paymentAllocations.paymentId)))
      .where(and(eq(paymentAllocations.tenantId, user.tenantId), eq(paymentAllocations.billId, id)));
    const adjs = await tx.select().from(billAdjustments).where(and(eq(billAdjustments.tenantId, user.tenantId), eq(billAdjustments.billId, id)));
    const contact = b.zohoContactId ? (await tx.select().from(zohoContacts).where(and(eq(zohoContacts.tenantId, user.tenantId), eq(zohoContacts.id, b.zohoContactId))))[0] : undefined;
    const customerId = b.customerId ?? contact?.customerId ?? null;
    const customer = customerId ? (await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId))))[0] : undefined;
    const order = b.orderId ? (await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, b.orderId))))[0] : undefined;
    const L: LedgerBill = { id: b.id, number: b.number, bill_date: b.billDate, due_date: b.dueDate, total: P(b.total), cancelled: !!b.cancelledAt, order_id: b.orderId };
    const due = billDue(L, allocs.map((x) => ({ payment_id: x.a.paymentId, bill_id: id, amount: P(x.a.amount) })), adjs.map((x) => ({ bill_id: id, amount: P(x.amount), adjusted_on: x.adjustedOn })));
    return {
      id: b.id,
      number: b.number,
      source: b.source,
      opening_balance: b.zohoInvoiceId?.startsWith("ob:") ?? false,
      bill_date: b.billDate,
      due_date: b.dueDate,
      status: billStatus(L, due, istToday()),
      customer_name: b.customerName,
      party: customer ? { kind: "customer" as const, id: customer.id, name: customer.name } : contact ? { kind: "contact" as const, id: contact.id, name: contact.name } : null,
      order: order ? { id: order.id, ref: formatRef(order.refNo) } : null,
      sub_total: b.subTotal,
      discount: b.discount,
      adjustment: b.adjustment,
      tax_total: b.taxTotal,
      total: b.total,
      due: rupees(due > 0n ? due : 0n),
      notes: b.notes,
      salesperson: b.salesperson,
      gst_invoice_no: b.zohoGstInvoiceNo,
      created_by: b.createdByName,
      cancelled: b.cancelledAt ? { at: b.cancelledAt.toISOString(), by: b.cancelledByName, reason: b.cancelReason } : null,
      lines: lines.map((l) => ({ line_no: l.lineNo, item: l.itemName, sku: l.skuCode, description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, discount: l.discount, tax: l.taxName, tax_amount: l.taxAmount, hsn: l.hsn, total: l.lineTotal })),
      payments: allocs
        .map((x) => ({ payment_id: x.a.paymentId, number: x.number, mode: x.mode, date: x.a.allocatedOn, amount: x.a.amount }))
        .sort((a, c) => a.date.localeCompare(c.date)),
      adjustments: adjs.map((x) => ({ kind: x.kind, amount: x.amount, reason: x.reason, date: x.adjustedOn })),
    };
  });
}
export type BillDetail = Awaited<ReturnType<typeof billDetail>>;

/** The bill of an order (for the order page): null when none. */
export async function billOfOrder(user: OcUser, orderId: string) {
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select({ id: bills.id }).from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.orderId, orderId), isNull(bills.cancelledAt)));
    return b ? billDetail(user, b.id) : null;
  });
}

// ---------- actions ----------

const Money = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Amount: rupees, up to 2 decimals");
const Day = z.string().regex(YMD, "Date: YYYY-MM-DD");

export const MakeBillInput = z.object({
  order_id: z.uuid(),
  discount: Money.optional(),
  due_date: Day.optional(),
  zoho_gst_invoice_no: z.string().trim().max(40).optional(),
});

/** Make the bill of a delivered order (owner, Order desk): its current lines; the customer's advances pay it first. */
export async function makeBill(user: OcUser, input: z.infer<typeof MakeBillInput>) {
  requireAccess(user, "bill_make");
  return withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.bill'), hashtext(${user.tenantId}))`);
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, input.order_id))).for("update");
    if (!o) throw notFound("Order not found");
    if (o.status !== "delivered") throw conflict("Only a delivered order gets a bill. Mark it delivered first.");
    const [open] = await tx.select({ number: bills.number }).from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.orderId, o.id), isNull(bills.cancelledAt)));
    if (open) throw conflict(`This order already has bill ${open.number}.`);
    const lines = await tx.select().from(orderLines).where(and(eq(orderLines.tenantId, user.tenantId), eq(orderLines.orderId, o.id), eq(orderLines.version, o.version))).orderBy(orderLines.lineNo);
    const sub = paise(o.total);
    const discount = input.discount ? paise(input.discount) : 0n;
    if (discount > sub) throw badRequest("The discount can't be more than the order total.");
    const today = istToday();
    const due = input.due_date ?? today;
    if (due < o.deliveredAt!.toISOString().slice(0, 10) && due < today) throw badRequest("The due date can't be before the delivery.");
    const hsn = new Map((await kit.products(user.tenantId)).map((p) => [p.id, p.hsn ?? null]));
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${bills.refNo}), 0)::int + 1` }).from(bills).where(eq(bills.tenantId, user.tenantId))) as [{ next: number }];
    const [b] = await tx
      .insert(bills)
      .values({
        tenantId: user.tenantId,
        source: "plantops",
        number: billRef(next),
        refNo: next,
        billDate: today,
        dueDate: due,
        customerId: o.customerId,
        customerName: o.customerName,
        orderId: o.id,
        subTotal: rupees(sub),
        discount: rupees(discount),
        total: rupees(sub - discount),
        zohoGstInvoiceNo: input.zoho_gst_invoice_no || null,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning();
    await tx.insert(billLines).values(
      lines.map((l) => ({
        tenantId: user.tenantId,
        billId: b!.id,
        lineNo: l.lineNo,
        skuId: l.skuId,
        itemName: l.productName,
        quantity: String(l.quantity),
        unit: l.unit,
        rate: l.rate,
        hsn: hsn.get(l.skuId) ?? null,
        lineTotal: l.lineTotal,
      })),
    );
    // the customer's advances (money paid before, not used yet) pay the new bill first, oldest payment first
    const { L } = await partyFacts(tx, user.tenantId, o.customerId, (await partyScope(tx, user.tenantId, { kind: "customer", id: o.customerId })).contactIds);
    const advances = L.payments.map((p) => ({ id: p.id, number: p.number, payment_date: p.payment_date, unused: paymentUnused(p, L.allocations) }));
    const used = useAdvances(sub - discount, advances);
    if (used.length)
      await tx.insert(paymentAllocations).values(used.map((u) => ({ tenantId: user.tenantId, paymentId: u.payment_id, billId: b!.id, amount: rupees(u.amount), allocatedOn: today, createdBy: user.userId, createdByName: user.name })));
    await audit(tx, user, "bill.make", b!.id, { number: b!.number, order: formatRef(o.refNo), customer: o.customerName, total: b!.total, discount: b!.discount, advance_used: rupees(used.reduce((s, u) => s + u.amount, 0n)) });
    return { id: b!.id, number: b!.number, total: b!.total, advance_used: rupees(used.reduce((s, u) => s + u.amount, 0n)) };
  });
}

export const ReceivePaymentInput = z.object({
  customer_id: z.uuid(),
  amount: Money,
  payment_date: Day,
  mode: z.enum(["cash", "upi", "bank", "cheque", "other"]),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
  /** the bills it pays; none = every open bill, oldest first */
  bill_ids: z.array(z.uuid()).max(500).default([]),
});

/** Receive a payment from a customer (owner, Order desk): set against bills, the rest stays as their advance. */
export async function receivePayment(user: OcUser, input: z.infer<typeof ReceivePaymentInput>) {
  requireAccess(user, "payment_receive");
  const amount = paise(input.amount);
  if (amount <= 0n) throw badRequest("Amount: more than ₹0");
  if (input.payment_date > istToday()) throw badRequest("The payment date can't be in the future.");
  return withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.payment'), hashtext(${user.tenantId}))`);
    const scope = await partyScope(tx, user.tenantId, { kind: "customer", id: input.customer_id });
    const { L } = await partyFacts(tx, user.tenantId, scope.customer!.id, scope.contactIds);
    const open = L.bills.map((b) => ({ id: b.id, number: b.number, bill_date: b.bill_date, due: billDue(b, L.allocations, L.adjustments) })).filter((b) => b.due > 0n);
    const unknown = input.bill_ids.filter((id) => !open.some((b) => b.id === id));
    if (unknown.length) throw conflict("A ticked bill is already paid or isn't this customer's. Reload the page.");
    const { allocations, unused } = allocatePayment(amount, open, input.bill_ids);
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${payments.refNo}), 0)::int + 1` }).from(payments).where(eq(payments.tenantId, user.tenantId))) as [{ next: number }];
    const [p] = await tx
      .insert(payments)
      .values({
        tenantId: user.tenantId,
        source: "plantops",
        number: paymentRef(next),
        refNo: next,
        paymentDate: input.payment_date,
        customerId: scope.customer!.id,
        customerName: scope.customer!.name,
        mode: input.mode,
        reference: input.reference || null,
        amount: rupees(amount),
        note: input.note || null,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning();
    if (allocations.length)
      await tx
        .insert(paymentAllocations)
        .values(allocations.map((a) => ({ tenantId: user.tenantId, paymentId: p!.id, billId: a.bill_id, amount: rupees(a.amount), allocatedOn: input.payment_date, createdBy: user.userId, createdByName: user.name })));
    const paid = allocations.map((a) => open.find((b) => b.id === a.bill_id)!.number);
    await audit(tx, user, "payment.receive", p!.id, { number: p!.number, customer: scope.customer!.name, amount: p!.amount, mode: p!.mode, bills: paid, advance: rupees(unused) });
    return { id: p!.id, number: p!.number, amount: p!.amount, customer: scope.customer!.name, mode: p!.mode, bills: paid, advance: rupees(unused) };
  });
}

export const CancelInput = z.object({ reason: z.string().trim().min(3, "Reason: at least 3 letters").max(300) });

/** Undo what a payment paid on bills, by adding reversing rows (nothing is changed or deleted). */
async function reverse(tx: OcTx, user: OcUser, where: { billId?: string; paymentId?: string }) {
  const rows = await tx
    .select({ paymentId: paymentAllocations.paymentId, billId: paymentAllocations.billId, s: sql<string>`sum(${paymentAllocations.amount})::text` })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.tenantId, user.tenantId),
        where.billId ? eq(paymentAllocations.billId, where.billId) : sql`true`,
        where.paymentId ? eq(paymentAllocations.paymentId, where.paymentId) : sql`true`,
      ),
    )
    .groupBy(paymentAllocations.paymentId, paymentAllocations.billId);
  const live = rows.filter((r) => paise(r.s) !== 0n);
  if (live.length)
    await tx
      .insert(paymentAllocations)
      .values(live.map((r) => ({ tenantId: user.tenantId, paymentId: r.paymentId, billId: r.billId, amount: rupees(-paise(r.s)), allocatedOn: istToday(), createdBy: user.userId, createdByName: user.name })));
  return live.length;
}

/** Owner: cancel a bill (final). What payments paid on it goes back to those payments as advance. */
export async function cancelBill(user: OcUser, id: string, input: z.infer<typeof CancelInput>) {
  requireAccess(user, "bill_cancel");
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.id, id))).for("update");
    if (!b) throw notFound("Bill not found");
    if (b.cancelledAt) throw conflict(`${b.number} is already cancelled.`);
    const reversed = await reverse(tx, user, { billId: id });
    await tx
      .update(bills)
      .set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason })
      .where(and(eq(bills.tenantId, user.tenantId), eq(bills.id, id)));
    await audit(tx, user, "bill.cancel", id, { number: b.number, customer: b.customerName, total: b.total, reason: input.reason, payments_freed: reversed });
    return { number: b.number, customer: b.customerName, total: b.total, reason: input.reason };
  });
}

/** Owner: cancel a payment (typed twice, cheque bounced): the bills it paid are due again. */
export async function cancelPayment(user: OcUser, id: string, input: z.infer<typeof CancelInput>) {
  requireAccess(user, "payment_cancel");
  return withTenant(user.tenantId, async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.tenantId, user.tenantId), eq(payments.id, id))).for("update");
    if (!p) throw notFound("Payment not found");
    if (p.cancelledAt) throw conflict(`Payment ${p.number} is already cancelled.`);
    await reverse(tx, user, { paymentId: id });
    await tx
      .update(payments)
      .set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason })
      .where(and(eq(payments.tenantId, user.tenantId), eq(payments.id, id)));
    await audit(tx, user, "payment.cancel", id, { number: p.number, customer: p.customerName, amount: p.amount, reason: input.reason });
    return { number: p.number, customer: p.customerName, amount: p.amount, reason: input.reason };
  });
}

export const GstInput = z.object({ zoho_gst_invoice_no: z.string().trim().max(40) });

/** Owner, Order desk: the Zoho GST invoice no. made for this bill (blank removes it). */
export async function setGstInvoice(user: OcUser, id: string, input: z.infer<typeof GstInput>) {
  requireAccess(user, "bill_make");
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.id, id)));
    if (!b) throw notFound("Bill not found");
    if (b.cancelledAt) throw conflict(`${b.number} is cancelled.`);
    const value = input.zoho_gst_invoice_no || null;
    if (value === b.zohoGstInvoiceNo) return { ok: true };
    await tx.update(bills).set({ zohoGstInvoiceNo: value }).where(and(eq(bills.tenantId, user.tenantId), eq(bills.id, id)));
    await audit(tx, user, "bill.gst_invoice", id, { number: b.number, from: b.zohoGstInvoiceNo, to: value });
    return { ok: true };
  });
}

/** For "Undo delivered": an order with an open bill keeps its delivery until the bill is cancelled. */
export async function openBillNumber(tx: OcTx, tenantId: string, orderId: string) {
  const [b] = await tx.select({ number: bills.number }).from(bills).where(and(eq(bills.tenantId, tenantId), eq(bills.orderId, orderId), isNull(bills.cancelledAt)));
  return b?.number ?? null;
}

// ---------- CSV (owner) ----------

export async function billsCsvRows(user: OcUser) {
  requireAccess(user, "ledger_export");
  const { bills: list } = await billsList(user, { show: "all" }, 100_000);
  return [
    ["Bill", "Source", "Date", "Customer", "Order", "Total", "Due", "Status"],
    ...list.map((b) => [b.number, b.opening_balance ? "Zoho opening balance" : b.source === "zoho" ? "Zoho" : "PlantOps", b.bill_date, b.name, b.order_ref ?? "", b.total, b.due, b.status]),
  ];
}

export async function paymentsCsvRows(user: OcUser) {
  requireAccess(user, "ledger_export");
  const { payments: list } = await paymentsList(user, {}, 100_000);
  return [
    ["Payment", "Source", "Date", "Customer", "Mode", "Reference", "Amount", "Unused", "Cancelled"],
    ...list.map((p) => [p.number, p.source === "zoho" ? "Zoho" : "PlantOps", p.payment_date, p.name, p.mode, p.reference ?? "", p.amount, p.unused, p.cancelled ? "yes" : ""]),
  ];
}

export async function statementCsvRows(user: OcUser, party: Party, range: { from?: string; to?: string }) {
  const a = await account(user, party, range);
  return [
    [`Statement: ${a.party.name}`, range.from ?? "", range.to ?? ""],
    ["Date", "What", "Number", "Mode", "Bill", "Paid", "Balance"],
    ["", "Opening balance", "", "", "", "", a.statement.opening],
    ...a.statement.rows.map((r) => [r.date, r.kind === "bill" ? "Bill" : r.kind === "payment" ? "Payment" : "Settled (adjustment)", r.number, r.mode ?? "", r.kind === "bill" ? r.debit : "", r.kind === "bill" ? "" : r.credit, r.balance]),
  ];
}

// "Import from Zoho" (owner only; docs/ZOHO_IMPORT_PHASE_PLAN.md section 8). The browser reads Zoho's Contacts, Invoice
// and Customer_Payment exports and sends only the columns needed; the files are never stored. Preview saves nothing.
// Confirm works the plan out again inside ONE transaction and saves only if it is exactly what the owner saw (same
// fingerprint, 409 otherwise) and every bill's due matches Zoho's. Importing again adds only what is new.
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { rupees } from "@/lib/ledger";
import { formatRef } from "@/lib/ref";
import { planImport, type Existing, type ImportPlan } from "@/lib/zoho-import";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { billAdjustments, billLines, bills, customers, orderLines, paymentAllocations, payments, zohoContacts, zohoImports } = schema;

const S = (max: number) => z.string().max(max);
const Contact = z.object({
  zoho_id: S(60).min(1),
  name: S(500),
  company: S(500),
  mobile_typed: S(100),
  gstin: S(50),
  status: S(50),
  created: S(20),
  opening_balance: S(30),
});
const Line = z.object({
  sku: S(100), item_name: S(500), description: S(2000), quantity: S(30), unit: S(50), rate: S(30), discount: S(30),
  tax_name: S(100), tax_percent: S(30), tax_amount: S(30), hsn: S(30), line_total: S(30),
});
const Invoice = z.object({
  zoho_id: S(60).min(1), number: S(60).min(1), date: S(20), due_date: S(20), status: S(50), contact_id: S(60), customer_name: S(500),
  sub_total: S(30), discount: S(30), adjustment: S(30), total: S(30), balance: S(30), notes: S(5000), salesperson: S(200),
  lines: z.array(Line).max(500),
});
const Payment = z.object({
  zoho_id: S(60).min(1), number: S(60).min(1), date: S(20), contact_id: S(60), customer_name: S(500), mode: S(50), reference: S(200),
  deposit_to: S(200), amount: S(30), status: S(50), applied: z.array(z.object({ invoice: S(100), amount: S(30), date: S(20) })).max(1000),
});
export const ZohoImportInput = z.object({
  files: z.object({ contacts: S(200).optional(), invoices: S(200).optional(), payments: S(200).optional() }).default({}),
  /** the day the files were exported from Zoho: "amount due as of" */
  export_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contacts: z.array(Contact).max(50_000),
  invoices: z.array(Invoice).max(100_000),
  payments: z.array(Payment).max(100_000),
});
export const ZohoImportConfirm = ZohoImportInput.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });

const IST = "Asia/Kolkata";
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);

/** What the plant already has that the import needs to know. */
async function existing(tx: OcTx, tenantId: string): Promise<Existing> {
  const cust = await tx.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(eq(customers.tenantId, tenantId));
  const contacts = await tx
    .select({ id: zohoContacts.id, zoho_contact_id: zohoContacts.zohoContactId, customer_id: zohoContacts.customerId, mobile: zohoContacts.mobile })
    .from(zohoContacts)
    .where(eq(zohoContacts.tenantId, tenantId));
  const zb = await tx.execute<{ id: string; zoho_invoice_id: string; number: string; order_id: string | null; total: string; paid: string; adjusted: string }>(sql`
    select b.id, b.zoho_invoice_id, b.number, b.order_id, b.total::text,
           coalesce((select sum(a.amount) from order_capture.payment_allocations a where a.bill_id = b.id), 0)::text as paid,
           coalesce((select sum(x.amount) from order_capture.bill_adjustments x where x.bill_id = b.id), 0)::text as adjusted
      from order_capture.bills b
     where b.tenant_id = ${tenantId} and b.source = 'zoho' and b.cancelled_at is null`);
  const pays = await tx.select({ id: payments.zohoPaymentId }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.source, "zoho")));
  const delivered = await tx.execute<{ id: string; ref_no: number; phone: string; delivered_at: Date; version: number }>(sql`
    select o.id, o.ref_no, o.customer_phone as phone, o.delivered_at, o.version
      from order_capture.orders o
     where o.tenant_id = ${tenantId} and o.status = 'delivered'
       and not exists (select 1 from order_capture.bills b where b.tenant_id = o.tenant_id and b.order_id = o.id and b.cancelled_at is null)`);
  const ids = delivered.rows.map((o) => o.id);
  const lines = ids.length
    ? await tx.select({ orderId: orderLines.orderId, version: orderLines.version, skuId: orderLines.skuId, quantity: orderLines.quantity }).from(orderLines).where(and(eq(orderLines.tenantId, tenantId), inArray(orderLines.orderId, ids)))
    : [];
  const skus = await kit.products(tenantId);
  const P = (s: string) => BigInt(Math.round(Number(s) * 100));
  return {
    customers: cust,
    contacts,
    bills: zb.rows.map((b) => ({ id: b.id, zoho_invoice_id: b.zoho_invoice_id, number: b.number, order_id: b.order_id, total: P(b.total), paid: P(b.paid), adjusted: P(b.adjusted) })),
    payment_ids: pays.map((p) => p.id!).filter(Boolean),
    skus: skus.map((s) => ({ id: s.id, sku_code: s.sku_code })),
    orders: delivered.rows.map((o) => ({
      id: o.id,
      ref_no: o.ref_no,
      phone: o.phone,
      delivered_on: istDay(new Date(o.delivered_at)),
      lines: lines.filter((l) => l.orderId === o.id && l.version === o.version).map((l) => ({ sku_id: l.skuId, quantity: l.quantity })),
    })),
  };
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export function fingerprint(plan: ImportPlan) {
  const what = {
    c: plan.contacts.map((c) => [c.zoho_id, c.mobile, c.link]),
    b: plan.bills.map((b) => [b.key, b.total]),
    p: plan.payments.map((p) => [p.zoho_id, p.allocations]),
    a: plan.adjustments,
    o: plan.order_links,
  };
  return createHash("sha256").update(json(what)).digest("hex");
}

/** What the screen shows: counts, rupee totals and the lists to look at (not every row). */
function view(plan: ImportPlan) {
  const r = (p: bigint) => rupees(p);
  return {
    counts: plan.counts,
    totals: { billed: r(plan.totals.billed), received: r(plan.totals.received), adjusted: r(plan.totals.adjusted), due_after: r(plan.totals.due_after), zoho_due: r(plan.totals.zoho_due) },
    matches_zoho: plan.mismatches.length === 0 && plan.totals.due_after === plan.totals.zoho_due,
    mismatches: plan.mismatches.slice(0, 200).map((m) => ({ number: m.number, ours: r(m.ours), zoho: r(m.zoho) })),
    shared_mobiles: plan.shared_mobiles,
    skipped: plan.skipped.slice(0, 500),
    unknown_skus: plan.unknown_skus,
    modes: plan.payments.reduce<Record<string, number>>((m, p) => ((m[p.mode] = (m[p.mode] ?? 0) + 1), m), {}),
    order_links: plan.order_links.map((o) => ({ ref: formatRef(o.ref_no), bill: o.number })),
    check_orders: plan.check_orders.map((o) => ({ ref: formatRef(o.ref_no), delivered_on: o.delivered_on, candidates: o.candidates })),
    fingerprint: fingerprint(plan),
  };
}
export type ZohoImportPreview = ReturnType<typeof view>;

const work = async (tx: OcTx, user: OcUser, input: z.infer<typeof ZohoImportInput>) =>
  planImport({ contacts: input.contacts, invoices: input.invoices, payments: input.payments }, await existing(tx, user.tenantId), input.export_date);

export async function previewZohoImport(user: OcUser, input: z.infer<typeof ZohoImportInput>) {
  requireAccess(user, "zoho_import");
  return withTenant(user.tenantId, async (tx) => view(await work(tx, user, input)));
}

const chunks = <T>(xs: T[], n = 500) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const STALE = "Something changed since the preview (customers, orders or an earlier import). Please check the preview again.";

export async function confirmZohoImport(user: OcUser, input: z.infer<typeof ZohoImportConfirm>) {
  requireAccess(user, "zoho_import");
  return withTenant(user.tenantId, async (tx) => {
    // one import (and one customer upload) at a time per plant
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.zoho_import'), hashtext(${user.tenantId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.customer_upload'), hashtext(${user.tenantId}))`);
    const plan = await work(tx, user, input);
    if (fingerprint(plan) !== input.fingerprint) throw conflict(STALE);
    if (plan.mismatches.length || plan.totals.due_after !== plan.totals.zoho_due)
      throw badRequest("What is due doesn't match Zoho for some invoices. Nothing was saved; see the list in the preview.");
    const t = user.tenantId;
    const by = { createdBy: user.userId, createdByName: user.name };

    const [imp] = await tx
      .insert(zohoImports)
      .values({ tenantId: t, files: input.files, counts: { ...plan.counts, totals: JSON.parse(json(plan.totals)) }, exportDate: input.export_date, importedBy: user.userId, importedByName: user.name })
      .returning({ id: zohoImports.id });
    const importId = imp!.id;

    // 1. the contacts (linked to a customer with the same unique mobile, or not matched yet)
    const contactId = new Map<string, string>(
      (await tx.select({ id: zohoContacts.id, z: zohoContacts.zohoContactId }).from(zohoContacts).where(eq(zohoContacts.tenantId, t))).map((c) => [c.z, c.id]),
    );
    for (const part of chunks(plan.contacts)) {
      const rows = await tx
        .insert(zohoContacts)
        .values(
          part.map((c) => ({
            tenantId: t,
            zohoContactId: c.zoho_id,
            name: c.name,
            company: c.company,
            mobileTyped: c.mobile_typed,
            mobile: c.mobile,
            gstin: c.gstin,
            zohoStatus: c.status,
            customerId: c.link?.customer_id ?? null,
            importId,
          })),
        )
        .returning({ id: zohoContacts.id, z: zohoContacts.zohoContactId });
      for (const r of rows) contactId.set(r.z, r.id);
    }

    // 2. bills and their lines
    const billId = new Map<string, string>(
      (await tx.select({ id: bills.id, k: bills.zohoInvoiceId }).from(bills).where(and(eq(bills.tenantId, t), eq(bills.source, "zoho")))).map((b) => [b.k!, b.id]),
    );
    const R = rupees;
    for (const part of chunks(plan.bills)) {
      const rows = await tx
        .insert(bills)
        .values(
          part.map((b) => ({
            tenantId: t,
            source: "zoho" as const,
            number: b.number,
            zohoInvoiceId: b.key,
            billDate: b.bill_date,
            dueDate: b.due_date,
            zohoContactId: contactId.get(b.contact_zoho_id)!,
            customerName: b.customer_name,
            subTotal: R(b.sub_total),
            discount: R(b.discount),
            adjustment: R(b.adjustment),
            taxTotal: R(b.tax_total),
            total: R(b.total),
            notes: b.notes,
            salesperson: b.salesperson,
            zohoStatus: b.zoho_status,
            zohoBalance: R(b.zoho_balance),
            importId,
            ...by,
          })),
        )
        .returning({ id: bills.id, k: bills.zohoInvoiceId });
      for (const r of rows) billId.set(r.k!, r.id);
    }
    const lines = plan.bills.flatMap((b) =>
      b.lines.map((l) => ({
        tenantId: t,
        billId: billId.get(b.key)!,
        lineNo: l.line_no,
        skuId: l.sku_id,
        skuCode: l.sku_code,
        itemName: l.item_name,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: R(l.rate),
        discount: R(l.discount),
        taxName: l.tax_name,
        taxPercent: l.tax_percent,
        taxAmount: R(l.tax_amount),
        hsn: l.hsn,
        lineTotal: R(l.line_total),
      })),
    );
    for (const part of chunks(lines)) await tx.insert(billLines).values(part);

    // 3. payments and what each paid
    const paymentId = new Map<string, string>();
    for (const part of chunks(plan.payments)) {
      const rows = await tx
        .insert(payments)
        .values(
          part.map((p) => ({
            tenantId: t,
            source: "zoho" as const,
            number: p.number,
            zohoPaymentId: p.zoho_id,
            paymentDate: p.payment_date,
            zohoContactId: contactId.get(p.contact_zoho_id)!,
            customerName: p.customer_name,
            mode: p.mode,
            reference: p.reference,
            depositTo: p.deposit_to,
            amount: R(p.amount),
            importId,
            ...by,
          })),
        )
        .returning({ id: payments.id, z: payments.zohoPaymentId });
      for (const r of rows) paymentId.set(r.z!, r.id);
    }
    const allocations = plan.payments.flatMap((p) =>
      p.allocations.map((a) => ({ tenantId: t, paymentId: paymentId.get(p.zoho_id)!, billId: billId.get(a.bill_key)!, amount: R(a.amount), allocatedOn: a.date, ...by })),
    );
    for (const part of chunks(allocations)) await tx.insert(paymentAllocations).values(part);

    // 4. what Zoho settled without a payment in the export (credit notes, write-offs)
    if (plan.adjustments.length) {
      await tx.insert(billAdjustments).values(
        plan.adjustments.map((a) => ({
          tenantId: t,
          billId: billId.get(a.bill_key)!,
          kind: "zoho_closed" as const,
          amount: R(a.amount),
          reason: "Closed in Zoho without a payment in the export (credit note or write-off)",
          adjustedOn: a.date,
          importId,
          ...by,
        })),
      );
    }

    // 5. delivered orders -> their bill
    for (const o of plan.order_links) {
      await tx.update(bills).set({ orderId: o.order_id }).where(and(eq(bills.tenantId, t), eq(bills.id, billId.get(o.bill_key)!), isNull(bills.orderId), isNull(bills.cancelledAt)));
    }

    const counts = { ...plan.counts, billed: R(plan.totals.billed), received: R(plan.totals.received), due_after: R(plan.totals.due_after) };
    await audit(tx, user, "zoho.import", importId, { files: input.files, export_date: input.export_date, ...counts });
    return counts;
  });
}

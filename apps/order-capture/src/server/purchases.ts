// Purchases inside Sales (docs/PURCHASES_PHASE_PLAN.md, P1): "Import from Zoho" for purchases (owner) and the read-only
// Purchases tab (owner, Accounts, PlantOps support): vendors with what is owed, purchase bills, payments made, one
// vendor, one bill. Money is never stored as a running figure: a bill's due = total − what payments paid on it; a
// vendor's balance = open dues − unused payments (advances). Cancelled rows count for nothing.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { billStatus, paise, rupees, type LedgerBill } from "@/lib/ledger";
import { planPurchaseImport, vendorKey, type PurchaseExisting, type PurchasePlan } from "@/lib/purchase-import";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const { purchaseBillLines, purchaseBills, purchaseImports, purchaseItems, vendorPaymentAllocations, vendorPayments, vendors } = schema;

const IST = "Asia/Kolkata";
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const P = (s: string | null) => (s === null ? 0n : paise(s));
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const chunks = <T>(xs: T[], n = 500) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ---------- import ----------

const S = (max: number) => z.string().max(max);
const Vendor = z.object({
  zoho_id: S(60).min(1), name: S(500), company: S(500), phone: S(100), email: S(300), gstin: S(50), gst_treatment: S(60), address: S(2000), terms: S(100), status: S(50),
});
const Item = z.object({
  zoho_id: S(60).min(1), name: S(500), sku: S(100), hsn: S(30), unit: S(50), rate: S(40), gst_percent: S(30), description: S(2000), item_type: S(60), sellable: S(10), status: S(50),
});
const Line = z.object({
  item_id: S(60), item_name: S(500), description: S(2000), quantity: S(30), unit: S(50), rate: S(30), discount: S(30), tax_name: S(100), tax_percent: S(30),
  tax_amount: S(30), hsn: S(30), line_total: S(30), cgst: S(30), sgst: S(30), igst: S(30),
});
const Bill = z.object({
  zoho_id: S(60).min(1), number: S(60).min(1), date: S(20), due_date: S(20), status: S(50), vendor_name: S(500), po_number: S(60), sub_total: S(30), discount: S(30),
  adjustment: S(30), total: S(30), balance: S(30), notes: S(5000), lines: z.array(Line).max(500),
});
const Payment = z.object({
  zoho_id: S(60).min(1), number: S(60).min(1), date: S(20), vendor_name: S(500), mode: S(50), paid_through: S(200), reference: S(200), amount: S(30), status: S(50),
  applied: z.array(z.object({ bill_id: S(60), amount: S(30), date: S(20) })).max(1000),
});
export const PurchaseImportInput = z.object({
  files: z.object({ vendors: S(200).optional(), items: S(200).optional(), bills: S(200).optional(), payments: S(200).optional() }).default({}),
  vendors: z.array(Vendor).max(10_000),
  items: z.array(Item).max(20_000),
  bills: z.array(Bill).max(50_000),
  payments: z.array(Payment).max(50_000),
});
export const PurchaseImportConfirm = PurchaseImportInput.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
type ImportIn = z.infer<typeof PurchaseImportInput>;

async function existing(tx: OcTx, tenantId: string): Promise<PurchaseExisting> {
  const v = await tx.select({ id: vendors.id, zoho_contact_id: vendors.zohoContactId, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  const i = await tx.select({ id: purchaseItems.id, zoho_item_id: purchaseItems.zohoItemId }).from(purchaseItems).where(eq(purchaseItems.tenantId, tenantId));
  const b = await tx.execute<{ id: string; zoho_bill_id: string | null; number: string; ref_no: number | null; total: string; paid: string }>(sql`
    select b.id, b.zoho_bill_id, b.number, b.ref_no, b.total::text,
           coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = b.tenant_id and a.bill_id = b.id), 0)::text as paid
      from order_capture.purchase_bills b
     where b.tenant_id = ${tenantId}`);
  const p = await tx.select({ zoho_payment_id: vendorPayments.zohoPaymentId, number: vendorPayments.number, ref_no: vendorPayments.refNo }).from(vendorPayments).where(eq(vendorPayments.tenantId, tenantId));
  return { vendors: v, items: i, bills: b.rows.map((x) => ({ ...x, total: P(x.total), paid: P(x.paid) })), payments: p };
}

export function purchaseFingerprint(plan: PurchasePlan) {
  const what = {
    v: plan.vendors.map((v) => [v.zoho_id, v.name]),
    i: plan.items.map((i) => i.zoho_id),
    b: plan.bills.map((b) => [b.key, b.number, b.total]),
    p: plan.payments.map((p) => [p.zoho_id, p.number, p.allocations]),
  };
  return createHash("sha256").update(json(what)).digest("hex");
}

function view(plan: PurchasePlan) {
  const r = rupees;
  const byVendor = new Map<string, { name: string; bills: number; billed: bigint }>();
  for (const b of plan.bills) {
    const x = byVendor.get(b.vendor_key) ?? { name: b.vendor_name, bills: 0, billed: 0n };
    x.bills++;
    x.billed += b.total;
    byVendor.set(b.vendor_key, x);
  }
  const dates = plan.bills.map((b) => b.bill_date).sort();
  return {
    counts: plan.counts,
    totals: { billed: r(plan.totals.billed), paid: r(plan.totals.paid), tax: r(plan.totals.tax), due_after: r(plan.totals.due_after), zoho_due: r(plan.totals.zoho_due) },
    first_bill: dates[0] ?? null,
    last_bill: dates.at(-1) ?? null,
    matches_zoho: plan.mismatches.length === 0 && plan.totals.due_after === plan.totals.zoho_due,
    mismatches: plan.mismatches.slice(0, 200).map((m) => ({ number: m.number, ours: r(m.ours), zoho: r(m.zoho) })),
    vendors: [...byVendor.values()].sort((a, b) => (b.billed > a.billed ? 1 : b.billed < a.billed ? -1 : 0)).map((v) => ({ name: v.name, bills: v.bills, billed: r(v.billed) })),
    modes: plan.payments.reduce<Record<string, number>>((m, p) => ((m[`${p.mode}${p.paid_from ? ` (${p.paid_from})` : ""}`] = (m[`${p.mode}${p.paid_from ? ` (${p.paid_from})` : ""}`] ?? 0) + 1), m), {}),
    skipped: plan.skipped.slice(0, 500),
    fingerprint: purchaseFingerprint(plan),
  };
}
export type PurchaseImportPreview = ReturnType<typeof view>;

const work = async (tx: OcTx, input: ImportIn, tenantId: string) =>
  planPurchaseImport({ vendors: input.vendors, items: input.items, bills: input.bills, payments: input.payments }, await existing(tx, tenantId));

export async function previewPurchaseImport(user: OcUser, input: ImportIn) {
  requireAccess(user, "purchase_import");
  return withTenant(user.tenantId, async (tx) => view(await work(tx, input, user.tenantId)));
}

const STALE = "Something changed since the preview (an earlier import or a new purchase). Please check the preview again.";

export async function confirmPurchaseImport(user: OcUser, input: z.infer<typeof PurchaseImportConfirm>) {
  requireAccess(user, "purchase_import");
  return withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.purchase_import'), hashtext(${user.tenantId}))`);
    const plan = await work(tx, input, user.tenantId);
    if (purchaseFingerprint(plan) !== input.fingerprint) throw conflict(STALE);
    if (plan.mismatches.length || plan.totals.due_after !== plan.totals.zoho_due)
      throw badRequest("What is due doesn't match Zoho for some bills. Nothing was saved; see the list in the preview.");
    const t = user.tenantId;
    const by = { createdBy: user.userId, createdByName: user.name };
    const R = rupees;

    const [imp] = await tx
      .insert(purchaseImports)
      .values({ tenantId: t, files: input.files, counts: { ...plan.counts, totals: JSON.parse(json(plan.totals)) }, importedBy: user.userId, importedByName: user.name })
      .returning({ id: purchaseImports.id });
    const importId = imp!.id;

    // 1. vendors (by name key, for bills and payments)
    const vendorId = new Map<string, string>(
      (await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, t))).map((v) => [vendorKey(v.name), v.id]),
    );
    if (plan.vendors.length) {
      const rows = await tx
        .insert(vendors)
        .values(plan.vendors.map((v) => ({ tenantId: t, name: v.name, company: v.company, phone: v.phone, email: v.email, gstin: v.gstin, gstTreatment: v.gst_treatment, state: v.state, address: v.address, terms: v.terms, active: v.active, zohoContactId: v.zoho_id, importId, ...by })))
        .returning({ id: vendors.id, name: vendors.name });
      for (const r of rows) vendorId.set(vendorKey(r.name), r.id);
    }

    // 2. purchase items
    const itemId = new Map<string, string>(
      (await tx.select({ id: purchaseItems.id, z: purchaseItems.zohoItemId }).from(purchaseItems).where(eq(purchaseItems.tenantId, t))).filter((i) => i.z).map((i) => [i.z!, i.id]),
    );
    for (const part of chunks(plan.items)) {
      const rows = await tx
        .insert(purchaseItems)
        .values(part.map((i) => ({ tenantId: t, name: i.name, sku: i.sku, hsn: i.hsn, unit: i.unit, rate: i.rate === null ? null : R(i.rate), gstPercent: i.gst_percent, description: i.description, active: i.active, zohoItemId: i.zoho_id, importId, ...by })))
        .returning({ id: purchaseItems.id, z: purchaseItems.zohoItemId });
      for (const r of rows) itemId.set(r.z!, r.id);
    }

    // 3. bills and their lines
    const billId = new Map<string, string>(
      (await tx.select({ id: purchaseBills.id, k: purchaseBills.zohoBillId }).from(purchaseBills).where(and(eq(purchaseBills.tenantId, t), eq(purchaseBills.source, "zoho")))).map((b) => [b.k!, b.id]),
    );
    for (const part of chunks(plan.bills)) {
      const rows = await tx
        .insert(purchaseBills)
        .values(
          part.map((b) => ({
            tenantId: t,
            source: "zoho" as const,
            number: b.number,
            refNo: b.ref_no,
            zohoBillId: b.key,
            vendorId: vendorId.get(b.vendor_key)!,
            vendorName: b.vendor_name,
            billDate: b.bill_date,
            dueDate: b.due_date,
            poNumber: b.po_number,
            subTotal: R(b.sub_total),
            discount: R(b.discount),
            adjustment: R(b.adjustment),
            taxTotal: R(b.tax_total),
            cgst: R(b.cgst),
            sgst: R(b.sgst),
            igst: R(b.igst),
            total: R(b.total),
            notes: b.notes,
            zohoStatus: b.zoho_status,
            zohoBalance: R(b.zoho_balance),
            importId,
            ...by,
          })),
        )
        .returning({ id: purchaseBills.id, k: purchaseBills.zohoBillId });
      for (const r of rows) billId.set(r.k!, r.id);
    }
    const lines = plan.bills.flatMap((b) =>
      b.lines.map((l) => ({
        tenantId: t,
        billId: billId.get(b.key)!,
        lineNo: l.line_no,
        itemId: l.item_zoho_id ? (itemId.get(l.item_zoho_id) ?? null) : null,
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
    for (const part of chunks(lines)) await tx.insert(purchaseBillLines).values(part);

    // 4. payments made and what each paid
    const paymentId = new Map<string, string>();
    for (const part of chunks(plan.payments)) {
      const rows = await tx
        .insert(vendorPayments)
        .values(
          part.map((p) => ({
            tenantId: t,
            source: "zoho" as const,
            number: p.number,
            refNo: p.ref_no,
            zohoPaymentId: p.zoho_id,
            vendorId: vendorId.get(p.vendor_key)!,
            vendorName: p.vendor_name,
            paymentDate: p.payment_date,
            mode: p.mode,
            paidFrom: p.paid_from,
            reference: p.reference,
            amount: R(p.amount),
            importId,
            ...by,
          })),
        )
        .returning({ id: vendorPayments.id, z: vendorPayments.zohoPaymentId });
      for (const r of rows) paymentId.set(r.z!, r.id);
    }
    const allocations = plan.payments.flatMap((p) =>
      p.allocations.map((a) => ({ tenantId: t, paymentId: paymentId.get(p.zoho_id)!, billId: billId.get(a.bill_key)!, amount: R(a.amount), allocatedOn: a.date, ...by })),
    );
    for (const part of chunks(allocations)) await tx.insert(vendorPaymentAllocations).values(part);

    const counts = { ...plan.counts, billed: R(plan.totals.billed), paid: R(plan.totals.paid), due_after: R(plan.totals.due_after) };
    await audit(tx, user, "purchases.import", importId, { files: input.files, ...counts });
    return counts;
  });
}

// ---------- reading ----------

type BillRow = {
  id: string; number: string; source: string; bill_date: string; due_date: string | null; total: string; paid: string; cancelled: boolean;
  vendor_id: string; vendor_name: string; po_number: string | null; vendor_invoice_no: string | null; lines: number;
};
const billView = (r: BillRow, today: string) => {
  const L: LedgerBill = { id: r.id, number: r.number, bill_date: r.bill_date, due_date: r.due_date, total: P(r.total), cancelled: r.cancelled, order_id: null };
  const due = r.cancelled ? 0n : P(r.total) - P(r.paid);
  return { ...r, due: rupees(due > 0n ? due : 0n), status: billStatus(L, due, today) };
};
const BILL_SELECT = sql`
  select b.id, b.number, b.source, b.bill_date::text, b.due_date::text, b.total::text, b.cancelled_at is not null as cancelled,
         coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = b.tenant_id and a.bill_id = b.id), 0)::numeric(18, 2)::text as paid,
         b.vendor_id, coalesce(v.name, b.vendor_name) as vendor_name, b.po_number, b.vendor_invoice_no,
         (select count(*)::int from order_capture.purchase_bill_lines l where l.tenant_id = b.tenant_id and l.bill_id = b.id) as lines
    from order_capture.purchase_bills b
    left join order_capture.vendors v on v.tenant_id = b.tenant_id and v.id = b.vendor_id`;

export type PurchaseBillFilter = "all" | "open" | "overdue" | "paid" | "cancelled";

export async function purchaseBillsList(user: OcUser, f: { show?: string; q?: string; from?: string; to?: string; vendor?: string } = {}, limit = 200) {
  requireAccess(user, "purchases_view");
  return withTenant(user.tenantId, async (tx) => {
    const q = (f.q ?? "").trim().slice(0, 100);
    const from = f.from && YMD.test(f.from) ? f.from : "1900-01-01";
    const to = f.to && YMD.test(f.to) ? f.to : "2999-12-31";
    const vendor = f.vendor && /^[0-9a-f-]{36}$/i.test(f.vendor) ? f.vendor : null;
    const rows = await tx.execute<BillRow>(sql`${BILL_SELECT}
       where b.tenant_id = ${user.tenantId}
         and b.bill_date between ${from}::date and ${to}::date
         and (${vendor}::uuid is null or b.vendor_id = ${vendor}::uuid)
         and (${q} = '' or b.number ilike ${"%" + q + "%"} or coalesce(v.name, b.vendor_name) ilike ${"%" + q + "%"} or coalesce(b.po_number, '') ilike ${"%" + q + "%"}
              or coalesce(b.vendor_invoice_no, '') ilike ${"%" + q + "%"}
              or exists (select 1 from order_capture.purchase_bill_lines l where l.tenant_id = b.tenant_id and l.bill_id = b.id and l.item_name ilike ${"%" + q + "%"}))
       order by b.bill_date desc, b.number desc`);
    const today = istToday();
    const show = (["all", "open", "overdue", "paid", "cancelled"].includes(f.show ?? "") ? f.show : "all") as PurchaseBillFilter;
    const all = rows.rows.map((r) => billView(r, today));
    const live = all.filter((b) => !b.cancelled);
    const sumOf = (xs: typeof all, k: "total" | "due") => rupees(xs.reduce((a, b) => a + P(b[k]), 0n));
    const shown = all.filter((b) =>
      show === "all" ? true : show === "open" ? b.status === "due" || b.status === "part_paid" || b.status === "overdue" : b.status === show,
    );
    return {
      bills: shown.slice(0, limit),
      more: shown.length > limit,
      summary: { n: live.length, billed: sumOf(live, "total"), due: sumOf(live, "due"), overdue: sumOf(live.filter((b) => b.status === "overdue"), "due") },
    };
  });
}

export async function vendorPaymentsList(user: OcUser, f: { q?: string; from?: string; to?: string; mode?: string } = {}, limit = 200) {
  requireAccess(user, "purchases_view");
  return withTenant(user.tenantId, async (tx) => {
    const q = (f.q ?? "").trim().slice(0, 100);
    const mode = ["cash", "upi", "bank", "cheque", "other"].includes(f.mode ?? "") ? f.mode! : "";
    const from = f.from && YMD.test(f.from) ? f.from : "1900-01-01";
    const to = f.to && YMD.test(f.to) ? f.to : "2999-12-31";
    const where = sql`p.tenant_id = ${user.tenantId} and (${mode} = '' or p.mode = ${mode}) and p.payment_date between ${from}::date and ${to}::date
         and (${q} = '' or p.number ilike ${"%" + q + "%"} or coalesce(v.name, p.vendor_name) ilike ${"%" + q + "%"} or coalesce(p.reference, '') ilike ${"%" + q + "%"})`;
    const rows = await tx.execute<{
      id: string; number: string; source: string; payment_date: string; mode: string; paid_from: string | null; reference: string | null; amount: string;
      unused: string; cancelled: boolean; vendor_id: string; vendor_name: string; bills: string | null;
    }>(sql`
      select p.id, p.number, p.source, p.payment_date::text, p.mode, p.paid_from, p.reference, p.amount::text,
             case when p.cancelled_at is null then greatest(p.amount - coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = p.tenant_id and a.payment_id = p.id), 0), 0) else 0 end::numeric(18, 2)::text as unused,
             p.cancelled_at is not null as cancelled, p.vendor_id, coalesce(v.name, p.vendor_name) as vendor_name,
             (select string_agg(distinct b.number, ', ') from order_capture.vendor_payment_allocations a
                join order_capture.purchase_bills b on b.tenant_id = a.tenant_id and b.id = a.bill_id
               where a.tenant_id = p.tenant_id and a.payment_id = p.id and a.amount > 0) as bills
        from order_capture.vendor_payments p
        left join order_capture.vendors v on v.tenant_id = p.tenant_id and v.id = p.vendor_id
       where ${where}
       order by p.payment_date desc, p.number desc
       limit ${limit + 1}`);
    const total = await tx.execute<{ n: number; sum: string }>(sql`
      select count(*)::int as n, coalesce(sum(p.amount), 0)::numeric(18, 2)::text as sum
        from order_capture.vendor_payments p left join order_capture.vendors v on v.tenant_id = p.tenant_id and v.id = p.vendor_id
       where ${where} and p.cancelled_at is null`);
    return { payments: rows.rows.slice(0, limit), more: rows.rows.length > limit, total: total.rows[0]! };
  });
}

/** Every vendor with what was bought, paid and is still owed (owed = open dues − advances). */
export async function vendorsList(user: OcUser, f: { q?: string } = {}) {
  requireAccess(user, "purchases_view");
  return withTenant(user.tenantId, async (tx) => {
    const q = (f.q ?? "").trim().slice(0, 100);
    const rows = await tx.execute<{ id: string; name: string; phone: string | null; gstin: string | null; active: boolean; bills: number; billed: string; paid: string; last_bill: string | null }>(sql`
      select v.id, v.name, v.phone, v.gstin, v.active,
             (select count(*)::int from order_capture.purchase_bills b where b.tenant_id = v.tenant_id and b.vendor_id = v.id and b.cancelled_at is null) as bills,
             (select coalesce(sum(b.total), 0) from order_capture.purchase_bills b where b.tenant_id = v.tenant_id and b.vendor_id = v.id and b.cancelled_at is null)::numeric(18, 2)::text as billed,
             (select coalesce(sum(p.amount), 0) from order_capture.vendor_payments p where p.tenant_id = v.tenant_id and p.vendor_id = v.id and p.cancelled_at is null)::numeric(18, 2)::text as paid,
             (select max(b.bill_date)::text from order_capture.purchase_bills b where b.tenant_id = v.tenant_id and b.vendor_id = v.id and b.cancelled_at is null) as last_bill
        from order_capture.vendors v
       where v.tenant_id = ${user.tenantId}
         and (${q} = '' or v.name ilike ${"%" + q + "%"} or coalesce(v.phone, '') ilike ${"%" + q + "%"} or coalesce(v.gstin, '') ilike ${"%" + q + "%"})`);
    const list = rows.rows
      .map((v) => ({ ...v, balance: rupees(P(v.billed) - P(v.paid)) }))
      .sort((a, b) => Number(P(b.billed) - P(a.billed)) || a.name.localeCompare(b.name));
    const owed = list.reduce((a, v) => a + P(v.balance), 0n);
    return { vendors: list, totals: { billed: rupees(list.reduce((a, v) => a + P(v.billed), 0n)), paid: rupees(list.reduce((a, v) => a + P(v.paid), 0n)), owed: rupees(owed) } };
  });
}

export async function vendorDetail(user: OcUser, id: string) {
  requireAccess(user, "purchases_view");
  return withTenant(user.tenantId, async (tx) => {
    const [v] = await tx.select().from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, id)));
    if (!v) throw notFound("Vendor not found");
    const today = istToday();
    const billRows = await tx.execute<BillRow>(sql`${BILL_SELECT} where b.tenant_id = ${user.tenantId} and b.vendor_id = ${id} order by b.bill_date desc, b.number desc`);
    const pays = await tx
      .select()
      .from(vendorPayments)
      .where(and(eq(vendorPayments.tenantId, user.tenantId), eq(vendorPayments.vendorId, id)))
      .orderBy(sql`${vendorPayments.paymentDate} desc`, sql`${vendorPayments.number} desc`);
    const usedRows = await tx.execute<{ payment_id: string; used: string }>(sql`
      select a.payment_id, sum(a.amount)::text as used from order_capture.vendor_payment_allocations a
        join order_capture.vendor_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
       where a.tenant_id = ${user.tenantId} and p.vendor_id = ${id} group by a.payment_id`);
    const used = new Map(usedRows.rows.map((r) => [r.payment_id, P(r.used)]));
    const items = await tx.execute<{ item: string; unit: string | null; quantity: string; amount: string; last: string }>(sql`
      select l.item_name as item, max(l.unit) as unit, sum(l.quantity)::text as quantity, sum(l.line_total)::numeric(18, 2)::text as amount, max(b.bill_date)::text as last
        from order_capture.purchase_bill_lines l
        join order_capture.purchase_bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id
       where l.tenant_id = ${user.tenantId} and b.vendor_id = ${id} and b.cancelled_at is null
       group by l.item_name order by sum(l.line_total) desc`);
    const bills = billRows.rows.map((r) => billView(r, today));
    const live = bills.filter((b) => !b.cancelled);
    const billed = live.reduce((a, b) => a + P(b.total), 0n);
    const paid = pays.filter((p) => !p.cancelledAt).reduce((a, p) => a + P(p.amount), 0n);
    return {
      vendor: {
        id: v.id, name: v.name, company: v.company, phone: v.phone, email: v.email, gstin: v.gstin, gst_treatment: v.gstTreatment, state: v.state,
        address: v.address, terms: v.terms, notes: v.notes, active: v.active, from_zoho: !!v.zohoContactId,
      },
      totals: { billed: rupees(billed), paid: rupees(paid), balance: rupees(billed - paid), overdue: rupees(live.filter((b) => b.status === "overdue").reduce((a, b) => a + P(b.due), 0n)) },
      bills,
      payments: pays.map((p) => {
        const unused = p.cancelledAt ? 0n : P(p.amount) - (used.get(p.id) ?? 0n);
        return { id: p.id, number: p.number, source: p.source, date: p.paymentDate, mode: p.mode, paid_from: p.paidFrom, reference: p.reference, amount: p.amount, unused: rupees(unused > 0n ? unused : 0n), cancelled: !!p.cancelledAt };
      }),
      items: items.rows,
      today,
    };
  });
}
export type VendorDetail = Awaited<ReturnType<typeof vendorDetail>>;

export async function purchaseBillDetail(user: OcUser, id: string) {
  requireAccess(user, "purchases_view");
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, user.tenantId), eq(purchaseBills.id, id)));
    if (!b) throw notFound("Purchase bill not found");
    const [v] = await tx.select({ id: vendors.id, name: vendors.name, gstin: vendors.gstin, state: vendors.state }).from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, b.vendorId)));
    const lines = await tx.select().from(purchaseBillLines).where(and(eq(purchaseBillLines.tenantId, user.tenantId), eq(purchaseBillLines.billId, id))).orderBy(purchaseBillLines.lineNo);
    const allocs = await tx
      .select({ a: vendorPaymentAllocations, number: vendorPayments.number, mode: vendorPayments.mode, paidFrom: vendorPayments.paidFrom })
      .from(vendorPaymentAllocations)
      .innerJoin(vendorPayments, and(eq(vendorPayments.tenantId, vendorPaymentAllocations.tenantId), eq(vendorPayments.id, vendorPaymentAllocations.paymentId)))
      .where(and(eq(vendorPaymentAllocations.tenantId, user.tenantId), eq(vendorPaymentAllocations.billId, id)));
    const paid = allocs.reduce((a, x) => a + P(x.a.amount), 0n);
    const due = b.cancelledAt ? 0n : P(b.total) - paid;
    const L: LedgerBill = { id: b.id, number: b.number, bill_date: b.billDate, due_date: b.dueDate, total: P(b.total), cancelled: !!b.cancelledAt, order_id: null };
    return {
      id: b.id,
      number: b.number,
      source: b.source,
      bill_date: b.billDate,
      due_date: b.dueDate,
      status: billStatus(L, due, istToday()),
      vendor: v ? { id: v.id, name: v.name, gstin: v.gstin, state: v.state } : { id: b.vendorId, name: b.vendorName, gstin: null, state: null },
      vendor_invoice_no: b.vendorInvoiceNo,
      po_number: b.poNumber,
      sub_total: b.subTotal,
      discount: b.discount,
      adjustment: b.adjustment,
      tax_total: b.taxTotal,
      cgst: b.cgst,
      sgst: b.sgst,
      igst: b.igst,
      total: b.total,
      due: rupees(due > 0n ? due : 0n),
      notes: b.notes,
      created_by: b.createdByName,
      cancelled: b.cancelledAt ? { at: b.cancelledAt.toISOString(), by: b.cancelledByName, reason: b.cancelReason } : null,
      lines: lines.map((l) => ({ line_no: l.lineNo, item: l.itemName, description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rate, discount: l.discount, tax: l.taxName, tax_percent: l.taxPercent, tax_amount: l.taxAmount, hsn: l.hsn, total: l.lineTotal })),
      payments: allocs
        .map((x) => ({ payment_id: x.a.paymentId, number: x.number, mode: x.mode, paid_from: x.paidFrom, date: x.a.allocatedOn, amount: x.a.amount }))
        .sort((a, c) => a.date.localeCompare(c.date)),
    };
  });
}
export type PurchaseBillDetail = Awaited<ReturnType<typeof purchaseBillDetail>>;

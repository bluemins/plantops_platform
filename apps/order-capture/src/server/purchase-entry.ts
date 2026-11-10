// Purchases P2 (docs/PURCHASES_PHASE_PLAN.md section 3): entering purchases in PlantOps. Owner + Accounts (owner,
// 2026-11-10: "the account guy will add the data"): add / edit a vendor, record a purchase bill (CGST + SGST for a vendor
// in the plant's state, IGST otherwise; "Paid now" records the payment in the same save), pay a vendor (oldest open bills
// first, or the ticked ones; the rest is an advance that the next bill uses), correct a payment's mode / "paid from".
// Owner only: cancel a purchase bill or a payment, with a reason (what was paid goes back as advance / the bills are due
// again; reversing rows, nothing changed or deleted). Owners get a bell for what Accounts records (sent by the routes after the answer).
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { gstinProblem, gstinState, GST_STATES, normaliseGstin, type NotificationInput } from "@plantops/types";
import { allocatePayment, BillAmountError, paise, rupees, useAdvances } from "@/lib/ledger";
import { isIntraState, purchaseAmounts } from "@/lib/purchase-amounts";
import { money } from "@/lib/money";
import { purchaseBillRef, vendorKey, vendorPaymentRef } from "@/lib/purchase-import";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { purchaseBillLines, purchaseBills, purchaseItems, vendorPaymentAllocations, vendorPayments, vendors } = schema;

const IST = "Asia/Kolkata";
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
const P = (s: string | null) => (s === null ? 0n : paise(s));
const opt = (max: number) => z.string().trim().max(max).optional().transform((s) => (s ? s : null));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const rupeeText = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Amount: a number like 1180 or 1180.50");
const MODES = ["cash", "upi", "bank", "cheque", "other"] as const;

// ---------- vendors ----------

export const VendorInput = z.object({
  name: z.string().trim().min(2, "Name: at least 2 letters").max(200),
  company: opt(200),
  phone: opt(30),
  email: opt(200),
  gstin: opt(20),
  /** for a vendor without a GSTIN: the GST state code (e.g. 21 = Odisha), so CGST + SGST or IGST is right */
  state: z.string().regex(/^\d{2}$/).optional().nullable(),
  address: opt(500),
  terms: opt(60),
  notes: opt(1000),
  active: z.boolean().default(true),
});
type VendorIn = z.infer<typeof VendorInput>;

function vendorFields(input: VendorIn) {
  let gstin: string | null = null;
  if (input.gstin) {
    gstin = normaliseGstin(input.gstin);
    const problem = gstinProblem(gstin);
    if (problem) throw badRequest(`GSTIN: ${problem}`);
  }
  const state = gstin ? gstinState(gstin) : (input.state ?? null);
  if (state && !GST_STATES[state]) throw badRequest("State: pick one from the list");
  return {
    name: input.name.replace(/\s+/g, " "),
    company: input.company,
    phone: input.phone,
    email: input.email,
    gstin,
    gstTreatment: (gstin ? "registered" : "unregistered") as "registered" | "unregistered",
    state,
    address: input.address,
    terms: input.terms,
    notes: input.notes,
    active: input.active,
  };
}

async function sameName(tx: OcTx, tenantId: string, name: string, notId?: string) {
  const rows = await tx.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.tenantId, tenantId));
  return rows.find((v) => v.id !== notId && vendorKey(v.name) === vendorKey(name));
}

export async function addVendor(user: OcUser, input: VendorIn) {
  requireAccess(user, "purchase_enter");
  const f = vendorFields(input);
  return withTenant(user.tenantId, async (tx) => {
    if (await sameName(tx, user.tenantId, f.name)) throw conflict(`A vendor called "${f.name}" is already here.`);
    const [v] = await tx.insert(vendors).values({ tenantId: user.tenantId, ...f, createdBy: user.userId, createdByName: user.name }).returning({ id: vendors.id, name: vendors.name });
    await audit(tx, user, "vendor.add", v!.id, { name: v!.name, gstin: f.gstin });
    return v!;
  });
}

export async function updateVendor(user: OcUser, id: string, input: VendorIn) {
  requireAccess(user, "purchase_enter");
  const f = vendorFields(input);
  return withTenant(user.tenantId, async (tx) => {
    const [old] = await tx.select().from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, id))).for("update");
    if (!old) throw notFound("Vendor not found");
    if (await sameName(tx, user.tenantId, f.name, id)) throw conflict(`A vendor called "${f.name}" is already here.`);
    const changed = (Object.keys(f) as (keyof typeof f)[]).filter((k) => (old[k] ?? null) !== (f[k] ?? null));
    if (!changed.length) return { id, name: old.name, changed: [] };
    await tx.update(vendors).set({ ...f, updatedAt: new Date() }).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, id)));
    await audit(tx, user, "vendor.update", id, { name: f.name, changed });
    return { id, name: f.name, changed };
  });
}

/** For the forms: every vendor (switched-on first) and every purchase item with its last unit / rate / GST. */
export async function entryChoices(user: OcUser) {
  requireAccess(user, "purchase_enter");
  return withTenant(user.tenantId, async (tx) => {
    const v = await tx.select({ id: vendors.id, name: vendors.name, state: vendors.state, gstin: vendors.gstin, active: vendors.active, terms: vendors.terms }).from(vendors).where(eq(vendors.tenantId, user.tenantId));
    const i = await tx.execute<{ id: string; name: string; unit: string | null; rate: string | null; gst_percent: string | null; hsn: string | null }>(sql`
      select i.id, i.name, coalesce(last.unit, i.unit) as unit, coalesce(last.rate, i.rate)::text as rate, coalesce(last.tax_percent, i.gst_percent)::text as gst_percent, coalesce(last.hsn, i.hsn) as hsn
        from order_capture.purchase_items i
        left join lateral (
          select l.unit, l.rate, l.tax_percent, l.hsn from order_capture.purchase_bill_lines l
            join order_capture.purchase_bills b on b.tenant_id = l.tenant_id and b.id = l.bill_id and b.cancelled_at is null
           where l.tenant_id = i.tenant_id and l.item_id = i.id order by b.bill_date desc, b.created_at desc limit 1) last on true
       where i.tenant_id = ${user.tenantId} and i.active
       order by i.name`);
    const plant = (await kit.branding(user.tenantId))?.gstin ?? null;
    return {
      vendors: v.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
      items: i.rows,
      plant_state: plant ? gstinState(plant) : null,
      today: istToday(),
    };
  });
}
export type EntryChoices = Awaited<ReturnType<typeof entryChoices>>;

// ---------- purchase bills ----------

const LineInput = z.object({
  item_id: z.uuid().optional().nullable(),
  item_name: z.string().trim().min(1, "Item: type its name").max(200),
  description: opt(500),
  quantity: z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "Quantity: a number like 25 or 12.5"),
  unit: opt(20),
  rate: rupeeText,
  gst_rate: z.number().min(0).max(40),
  hsn: opt(12),
});
const PaidNow = z.object({ mode: z.enum(MODES), paid_from: opt(100), reference: opt(100) });
export const PurchaseBillInput = z.object({
  vendor_id: z.uuid(),
  bill_date: day,
  due_date: day.optional().nullable(),
  vendor_invoice_no: opt(60),
  po_number: opt(40),
  notes: opt(2000),
  /** rounding, e.g. "-0.40" */
  adjustment: z.string().trim().regex(/^-?\d{1,4}(\.\d{1,2})?$/, "Rounding: a small number like -0.40").default("0"),
  lines: z.array(LineInput).min(1, "Add at least one item").max(100),
  paid_now: PaidNow.optional().nullable(),
});
type BillIn = z.infer<typeof PurchaseBillInput>;

const taxName = (rate: number, intra: boolean) => `${intra ? "GST" : "IGST"}${rate}`;

async function openBillsOf(tx: OcTx, tenantId: string, vendorId: string) {
  const r = await tx.execute<{ id: string; number: string; bill_date: string; total: string; paid: string }>(sql`
    select b.id, b.number, b.bill_date::text, b.total::text,
           coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = b.tenant_id and a.bill_id = b.id), 0)::text as paid
      from order_capture.purchase_bills b
     where b.tenant_id = ${tenantId} and b.vendor_id = ${vendorId} and b.cancelled_at is null`);
  return r.rows.map((b) => ({ id: b.id, number: b.number, bill_date: b.bill_date, due: P(b.total) - P(b.paid) })).filter((b) => b.due > 0n);
}

async function advancesOf(tx: OcTx, tenantId: string, vendorId: string) {
  const r = await tx.execute<{ id: string; number: string; payment_date: string; amount: string; used: string }>(sql`
    select p.id, p.number, p.payment_date::text, p.amount::text,
           coalesce((select sum(a.amount) from order_capture.vendor_payment_allocations a where a.tenant_id = p.tenant_id and a.payment_id = p.id), 0)::text as used
      from order_capture.vendor_payments p
     where p.tenant_id = ${tenantId} and p.vendor_id = ${vendorId} and p.cancelled_at is null`);
  return r.rows.map((p) => ({ id: p.id, number: p.number, payment_date: p.payment_date, unused: P(p.amount) - P(p.used) })).filter((p) => p.unused > 0n);
}

export async function recordPurchaseBill(user: OcUser, input: BillIn) {
  requireAccess(user, "purchase_enter");
  const today = istToday();
  if (input.bill_date > today) throw badRequest("The bill date can't be in the future.");
  if (input.due_date && input.due_date < input.bill_date) throw badRequest("The due date can't be before the bill date.");
  const plantGstin = (await kit.branding(user.tenantId))?.gstin ?? null;
  const result = await withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.purchase_bill'), hashtext(${user.tenantId}))`);
    const [v] = await tx.select().from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, input.vendor_id)));
    if (!v) throw notFound("Vendor not found");
    if (!v.active) throw badRequest(`${v.name} is switched off. Switch the vendor on first.`);
    if (input.vendor_invoice_no) {
      const dup = await tx.execute<{ number: string }>(sql`
        select number from order_capture.purchase_bills where tenant_id = ${user.tenantId} and vendor_id = ${v.id} and cancelled_at is null
           and lower(vendor_invoice_no) = lower(${input.vendor_invoice_no}) limit 1`);
      if (dup.rows[0]) throw conflict(`${v.name}'s invoice ${input.vendor_invoice_no} is already here as ${dup.rows[0].number}.`);
    }
    // CGST + SGST when the vendor is in the plant's state (or either state isn't known), IGST otherwise
    const intra = isIntraState(v.state, plantGstin ? gstinState(plantGstin) : null);
    let amounts;
    try {
      amounts = purchaseAmounts(input.lines, paise(input.adjustment), intra);
    } catch (e) {
      if (e instanceof BillAmountError) throw badRequest(e.message);
      throw e;
    }
    if (amounts.total <= 0n) throw badRequest("The bill total must be more than ₹0.");

    // items: the one picked, else one with the same name, else a new purchase item
    const known = await tx.select({ id: purchaseItems.id, name: purchaseItems.name }).from(purchaseItems).where(eq(purchaseItems.tenantId, user.tenantId));
    const byName = new Map(known.map((i) => [vendorKey(i.name), i.id]));
    const ids = new Set(known.map((i) => i.id));
    const itemIds: string[] = [];
    let newItems = 0;
    for (const l of input.lines) {
      if (l.item_id) {
        if (!ids.has(l.item_id)) throw badRequest(`Item "${l.item_name}" isn't in your purchase items. Pick it again.`);
        itemIds.push(l.item_id);
        continue;
      }
      const found = byName.get(vendorKey(l.item_name));
      if (found) {
        itemIds.push(found);
        continue;
      }
      const [it] = await tx
        .insert(purchaseItems)
        .values({ tenantId: user.tenantId, name: l.item_name.replace(/\s+/g, " "), unit: l.unit, rate: rupees(paise(l.rate)), gstPercent: l.gst_rate.toFixed(2), hsn: l.hsn, createdBy: user.userId, createdByName: user.name })
        .returning({ id: purchaseItems.id });
      byName.set(vendorKey(l.item_name), it!.id);
      itemIds.push(it!.id);
      newItems++;
    }

    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${purchaseBills.refNo}), 0)::int + 1` }).from(purchaseBills).where(eq(purchaseBills.tenantId, user.tenantId))) as [{ next: number }];
    const [b] = await tx
      .insert(purchaseBills)
      .values({
        tenantId: user.tenantId,
        source: "plantops",
        number: purchaseBillRef(next),
        refNo: next,
        vendorId: v.id,
        vendorName: v.name,
        billDate: input.bill_date,
        dueDate: input.due_date ?? input.bill_date,
        vendorInvoiceNo: input.vendor_invoice_no,
        poNumber: input.po_number,
        subTotal: rupees(amounts.sub_total),
        adjustment: rupees(amounts.adjustment),
        taxTotal: rupees(amounts.tax_total),
        cgst: rupees(amounts.cgst),
        sgst: rupees(amounts.sgst),
        igst: rupees(amounts.igst),
        total: rupees(amounts.total),
        notes: input.notes,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning();
    await tx.insert(purchaseBillLines).values(
      input.lines.map((l, i) => ({
        tenantId: user.tenantId,
        billId: b!.id,
        lineNo: i + 1,
        itemId: itemIds[i]!,
        itemName: l.item_name.replace(/\s+/g, " "),
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: rupees(paise(l.rate)),
        taxName: taxName(l.gst_rate, intra),
        taxPercent: l.gst_rate.toFixed(2),
        taxAmount: rupees(amounts.lines[i]!.tax),
        hsn: l.hsn,
        lineTotal: rupees(amounts.lines[i]!.amount),
      })),
    );

    const by = { createdBy: user.userId, createdByName: user.name };
    // an advance already paid to this vendor pays the new bill first (oldest payment first)
    const used = useAdvances(amounts.total, await advancesOf(tx, user.tenantId, v.id));
    if (used.length)
      await tx.insert(vendorPaymentAllocations).values(used.map((u) => ({ tenantId: user.tenantId, paymentId: u.payment_id, billId: b!.id, amount: rupees(u.amount), allocatedOn: input.bill_date, ...by })));
    const fromAdvance = used.reduce((a, u) => a + u.amount, 0n);

    // "Paid now": a payment for what is left, in the same save
    let payment: { id: string; number: string; amount: string } | null = null;
    const left = amounts.total - fromAdvance;
    if (input.paid_now && left > 0n) {
      const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${vendorPayments.refNo}), 0)::int + 1` }).from(vendorPayments).where(eq(vendorPayments.tenantId, user.tenantId))) as [{ n: number }];
      const [p] = await tx
        .insert(vendorPayments)
        .values({ tenantId: user.tenantId, source: "plantops", number: vendorPaymentRef(n), refNo: n, vendorId: v.id, vendorName: v.name, paymentDate: input.bill_date, mode: input.paid_now.mode, paidFrom: input.paid_now.paid_from, reference: input.paid_now.reference, amount: rupees(left), ...by })
        .returning({ id: vendorPayments.id, number: vendorPayments.number, amount: vendorPayments.amount });
      await tx.insert(vendorPaymentAllocations).values({ tenantId: user.tenantId, paymentId: p!.id, billId: b!.id, amount: rupees(left), allocatedOn: input.bill_date, ...by });
      payment = p!;
    }

    await audit(tx, user, "purchase.bill", b!.id, {
      number: b!.number, vendor: v.name, total: b!.total, lines: input.lines.length, new_items: newItems, from_advance: rupees(fromAdvance), paid_now: payment?.number ?? null,
    });
    return { id: b!.id, number: b!.number, vendor: v.name, total: b!.total, cgst: b!.cgst, sgst: b!.sgst, igst: b!.igst, new_items: newItems, from_advance: rupees(fromAdvance), payment };
  });
  return result;
}

// ---------- payments made ----------

export const PayVendorInput = z.object({
  vendor_id: z.uuid(),
  payment_date: day,
  amount: rupeeText,
  mode: z.enum(MODES),
  paid_from: opt(100),
  reference: opt(100),
  note: opt(300),
  /** the bills it pays; none = every open bill, oldest first */
  bill_ids: z.array(z.uuid()).max(500).default([]),
});

export async function payVendor(user: OcUser, input: z.infer<typeof PayVendorInput>) {
  requireAccess(user, "purchase_enter");
  const amount = paise(input.amount);
  if (amount <= 0n) throw badRequest("Amount: more than ₹0");
  if (input.payment_date > istToday()) throw badRequest("The payment date can't be in the future.");
  const result = await withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.purchase_bill'), hashtext(${user.tenantId}))`);
    const [v] = await tx.select().from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, input.vendor_id)));
    if (!v) throw notFound("Vendor not found");
    const open = await openBillsOf(tx, user.tenantId, v.id);
    if (input.bill_ids.some((id) => !open.some((b) => b.id === id))) throw conflict("A ticked bill is already paid or isn't this vendor's. Reload the page.");
    const { allocations, unused } = allocatePayment(amount, open, input.bill_ids);
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${vendorPayments.refNo}), 0)::int + 1` }).from(vendorPayments).where(eq(vendorPayments.tenantId, user.tenantId))) as [{ n: number }];
    const by = { createdBy: user.userId, createdByName: user.name };
    const [p] = await tx
      .insert(vendorPayments)
      .values({ tenantId: user.tenantId, source: "plantops", number: vendorPaymentRef(n), refNo: n, vendorId: v.id, vendorName: v.name, paymentDate: input.payment_date, mode: input.mode, paidFrom: input.paid_from, reference: input.reference, amount: rupees(amount), note: input.note, ...by })
      .returning();
    if (allocations.length)
      await tx.insert(vendorPaymentAllocations).values(allocations.map((a) => ({ tenantId: user.tenantId, paymentId: p!.id, billId: a.bill_id, amount: rupees(a.amount), allocatedOn: input.payment_date, ...by })));
    const bills = allocations.map((a) => open.find((b) => b.id === a.bill_id)!.number);
    await audit(tx, user, "purchase.payment", p!.id, { number: p!.number, vendor: v.name, amount: p!.amount, mode: p!.mode, bills, advance: rupees(unused) });
    return { id: p!.id, number: p!.number, vendor: v.name, amount: p!.amount, mode: p!.mode, bills, advance: rupees(unused) };
  });
  return result;
}

export const PaymentModeInput = z.object({ mode: z.enum(MODES), paid_from: opt(100) });

/** Owner, Accounts: the real mode / "paid from" of a payment (Zoho had every one as Cash / Petty Cash). */
export async function setPaymentMode(user: OcUser, id: string, input: z.infer<typeof PaymentModeInput>) {
  requireAccess(user, "purchase_enter");
  return withTenant(user.tenantId, async (tx) => {
    const [p] = await tx.select().from(vendorPayments).where(and(eq(vendorPayments.tenantId, user.tenantId), eq(vendorPayments.id, id))).for("update");
    if (!p) throw notFound("Payment not found");
    if (p.cancelledAt) throw conflict(`Payment ${p.number} is cancelled.`);
    if (p.mode === input.mode && (p.paidFrom ?? null) === input.paid_from) return { number: p.number, mode: p.mode, paid_from: p.paidFrom };
    await tx.update(vendorPayments).set({ mode: input.mode, paidFrom: input.paid_from }).where(and(eq(vendorPayments.tenantId, user.tenantId), eq(vendorPayments.id, id)));
    await audit(tx, user, "purchase.payment_mode", id, { number: p.number, vendor: p.vendorName, from: `${p.mode}${p.paidFrom ? ` (${p.paidFrom})` : ""}`, to: `${input.mode}${input.paid_from ? ` (${input.paid_from})` : ""}` });
    return { number: p.number, mode: input.mode, paid_from: input.paid_from };
  });
}

// ---------- cancel (owner) ----------

export const CancelPurchaseInput = z.object({ reason: z.string().trim().min(3, "Reason: at least 3 letters").max(300) });

async function reverse(tx: OcTx, user: OcUser, where: { billId?: string; paymentId?: string }) {
  const rows = await tx
    .select({ paymentId: vendorPaymentAllocations.paymentId, billId: vendorPaymentAllocations.billId, s: sql<string>`sum(${vendorPaymentAllocations.amount})::text` })
    .from(vendorPaymentAllocations)
    .where(
      and(
        eq(vendorPaymentAllocations.tenantId, user.tenantId),
        where.billId ? eq(vendorPaymentAllocations.billId, where.billId) : sql`true`,
        where.paymentId ? eq(vendorPaymentAllocations.paymentId, where.paymentId) : sql`true`,
      ),
    )
    .groupBy(vendorPaymentAllocations.paymentId, vendorPaymentAllocations.billId);
  const live = rows.filter((r) => paise(r.s) !== 0n);
  if (live.length)
    await tx.insert(vendorPaymentAllocations).values(
      live.map((r) => ({ tenantId: user.tenantId, paymentId: r.paymentId, billId: r.billId, amount: rupees(-paise(r.s)), allocatedOn: istToday(), createdBy: user.userId, createdByName: user.name })),
    );
  return live.length;
}

/** Owner: cancel a purchase bill (final). What payments paid on it goes back to them as advance. */
export async function cancelPurchaseBill(user: OcUser, id: string, input: z.infer<typeof CancelPurchaseInput>) {
  requireAccess(user, "purchase_cancel");
  const result = await withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(purchaseBills).where(and(eq(purchaseBills.tenantId, user.tenantId), eq(purchaseBills.id, id))).for("update");
    if (!b) throw notFound("Purchase bill not found");
    if (b.cancelledAt) throw conflict(`${b.number} is already cancelled.`);
    const freed = await reverse(tx, user, { billId: id });
    await tx.update(purchaseBills).set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason }).where(and(eq(purchaseBills.tenantId, user.tenantId), eq(purchaseBills.id, id)));
    await audit(tx, user, "purchase.bill_cancel", id, { number: b.number, vendor: b.vendorName, total: b.total, reason: input.reason, payments_freed: freed });
    return { id, number: b.number, vendor: b.vendorName, amount: b.total, reason: input.reason };
  });
  return result;
}

/** Owner: cancel a payment made (typed twice, cheque bounced): the bills it paid are due again. */
export async function cancelVendorPayment(user: OcUser, id: string, input: z.infer<typeof CancelPurchaseInput>) {
  requireAccess(user, "purchase_cancel");
  const result = await withTenant(user.tenantId, async (tx) => {
    const [p] = await tx.select().from(vendorPayments).where(and(eq(vendorPayments.tenantId, user.tenantId), eq(vendorPayments.id, id))).for("update");
    if (!p) throw notFound("Payment not found");
    if (p.cancelledAt) throw conflict(`Payment ${p.number} is already cancelled.`);
    await reverse(tx, user, { paymentId: id });
    await tx.update(vendorPayments).set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason }).where(and(eq(vendorPayments.tenantId, user.tenantId), eq(vendorPayments.id, id)));
    await audit(tx, user, "purchase.payment_cancel", id, { number: p.number, vendor: p.vendorName, amount: p.amount, reason: input.reason });
    return { id, number: p.number, vendor: p.vendorName, amount: p.amount, vendor_id: p.vendorId, reason: input.reason };
  });
  return result;
}

// ---------- notifications (bell, owners + ticked people, never whoever did it) ----------

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function purchaseBillNotification(user: OcUser, b: { id: string; number: string; vendor: string; total: string; payment: { number: string } | null }): NotificationInput {
  return {
    kind: "order_capture.purchase_bill",
    title: cut(`Purchase ${money(b.total)} from ${b.vendor}`, 80),
    body: cut(`${b.number}${b.payment ? `, paid now (${b.payment.number})` : ", to pay"} (by ${user.name})`, 300),
    link: `/purchases/bills/${b.id}`,
    level: "bell",
    dedupe_key: `purchase_bill:${b.id}`,
    exclude_user_id: user.userId,
  };
}

export function vendorPaymentNotification(user: OcUser, p: { id: string; number: string; vendor: string; amount: string; mode: string; bills: string[]; advance: string }): NotificationInput {
  const paid = p.bills.length ? `Paid ${p.bills.join(", ")}` : "Kept as advance";
  return {
    kind: "order_capture.vendor_payment",
    title: cut(`Paid ${money(p.amount)} to ${p.vendor}`, 80),
    body: cut(`${p.number}, ${p.mode}. ${paid}${p.bills.length && p.advance !== "0.00" ? `; ${money(p.advance)} advance` : ""} (by ${user.name})`, 300),
    link: `/purchases/payments?q=${encodeURIComponent(p.number)}`,
    level: "bell",
    dedupe_key: `vendor_payment:${p.id}`,
    exclude_user_id: user.userId,
  };
}

export function purchaseCancelNotification(user: OcUser, what: "bill" | "payment", x: { id: string; number: string; vendor: string; amount: string; reason: string }): NotificationInput {
  return {
    kind: "order_capture.purchase_cancelled",
    title: cut(`${what === "bill" ? "Purchase bill" : "Payment"} ${x.number} cancelled: ${money(x.amount)}`, 80),
    body: cut(`${x.vendor}. ${x.reason} (by ${user.name})`, 300),
    link: what === "bill" ? `/purchases/bills/${x.id}` : `/purchases/payments?q=${encodeURIComponent(x.number)}`,
    level: "bell",
    dedupe_key: `purchase_cancelled:${what}:${x.id}`,
    exclude_user_id: user.userId,
  };
}

// Make bill with Zoho-like fields, GST bills and "GST invoices to make" → Zoho (owner, 2026-11-07;
// docs/BILL_FIELDS_PHASE_PLAN.md, mock-ups linked there). The money rules are billAmounts / dueFromTerms in
// src/lib/ledger.ts; this file reads what the form needs, saves the bill, keeps the plant's bill settings and makes the
// file Zoho imports. Nothing on a saved bill changes later except "sent to Zoho" (once) and the Zoho GST invoice no.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { GST_STATES, gstinProblem, gstinState, normaliseGstin } from "@plantops/types";
import {
  BILL_TERMS,
  BillAmountError,
  billAmounts,
  billRef,
  dueFromTerms,
  paise,
  rupees,
  TERMS_LABEL,
  useAdvances,
  type BillTerms,
} from "@/lib/ledger";
import { billToAddress, billToParts, ZOHO_TREATMENT } from "@/lib/customer-page";
import { formatRef } from "@/lib/ref";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import { customerAdvances, istToday } from "./ledger";
import type { OcUser } from "./session";

const { billLines, billSettings, bills, customers, orderLines, orders, paymentAllocations, zohoContacts } = schema;
const { GST_TREATMENTS } = schema;
type GstTreatment = (typeof GST_TREATMENTS)[number];

const Money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Amount: rupees, up to 2 decimals");
const SignedMoney = z.string().trim().regex(/^-?\d{1,7}(\.\d{1,2})?$/, "Adjustment: rupees, e.g. -0.40 or 2");
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date: YYYY-MM-DD");
const text = (max: number) => z.string().trim().max(max).optional();

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

// ---------- the plant's bill settings ----------

export type BillSettings = { rates_include_gst: boolean; default_terms: BillTerms; default_notes: string | null };
const DEFAULT_SETTINGS: BillSettings = { rates_include_gst: true, default_terms: "receipt", default_notes: null };

async function readSettings(tx: OcTx, tenantId: string): Promise<BillSettings> {
  const [s] = await tx.select().from(billSettings).where(eq(billSettings.tenantId, tenantId));
  return s ? { rates_include_gst: s.ratesIncludeGst, default_terms: s.defaultTerms, default_notes: s.defaultNotes } : DEFAULT_SETTINGS;
}

export async function getBillSettings(user: OcUser) {
  requireAccess(user, "view_rates");
  return withTenant(user.tenantId, (tx) => readSettings(tx, user.tenantId));
}

export const BillSettingsInput = z.object({
  rates_include_gst: z.boolean(),
  default_terms: z.enum(BILL_TERMS as [BillTerms, ...BillTerms[]]),
  default_notes: z.string().trim().max(2000),
});

/** Owner: the usual "rates include GST", terms and customer notes for new bills. */
export async function setBillSettings(user: OcUser, input: z.infer<typeof BillSettingsInput>) {
  requireAccess(user, "rates");
  return withTenant(user.tenantId, async (tx) => {
    const before = await readSettings(tx, user.tenantId);
    const values = {
      ratesIncludeGst: input.rates_include_gst,
      defaultTerms: input.default_terms,
      defaultNotes: input.default_notes || null,
      updatedBy: user.userId,
      updatedByName: user.name,
      updatedAt: new Date(),
    };
    await tx.insert(billSettings).values({ tenantId: user.tenantId, ...values }).onConflictDoUpdate({ target: billSettings.tenantId, set: values });
    const after = await readSettings(tx, user.tenantId);
    await audit(tx, user, "bill.settings", user.tenantId, { before, after });
    return after;
  });
}

// ---------- what the Make bill form needs ----------

/** The plant's GST state: the first two digits of its GSTIN on Business details (null = no GSTIN yet). */
async function plantGst(tenantId: string) {
  const g = (await kit.branding(tenantId))?.gstin ?? null;
  return g ? { gstin: g, state: gstinState(g) } : null;
}

/** People a bill can name as salesperson: the plant's owners + everyone with an Order Capture role. */
async function salespeople(tenantId: string) {
  return ((await kit.contacts(tenantId)) ?? []).map((c) => ({ id: c.user_id, name: c.display_name }));
}

export async function billForm(user: OcUser, orderId: string) {
  requireAccess(user, "bill_make");
  const [products, gst, people] = await Promise.all([kit.products(user.tenantId), plantGst(user.tenantId), salespeople(user.tenantId)]);
  const sku = new Map(products.map((p) => [p.id, p]));
  return withTenant(user.tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, orderId)));
    if (!o) throw notFound("Order not found");
    const lines = await tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.tenantId, user.tenantId), eq(orderLines.orderId, o.id), eq(orderLines.version, o.version)))
      .orderBy(orderLines.lineNo);
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, o.customerId)));
    const zohoName = await linkedZohoName(tx, user.tenantId, o.customerId);
    const [last] = await tx
      .select({ salespersonId: bills.salespersonId, vehicle: bills.vehicle })
      .from(bills)
      .where(and(eq(bills.tenantId, user.tenantId), eq(bills.customerId, o.customerId), eq(bills.source, "plantops"), isNull(bills.cancelledAt)))
      .orderBy(desc(bills.createdAt))
      .limit(1);
    const vehicles = await tx.execute<{ vehicle: string }>(sql`
      select vehicle from order_capture.bills where tenant_id = ${user.tenantId} and vehicle is not null
       group by vehicle order by max(created_at) desc limit 30`);
    const settings = await readSettings(tx, user.tenantId);
    const today = istToday();
    return {
      order: { id: o.id, ref: formatRef(o.refNo), total: o.total, delivered_on: o.deliveredAt ? istDay(o.deliveredAt) : today },
      today,
      settings,
      plant_state: gst?.state ?? null,
      customer: {
        name: o.customerName,
        gstin: c?.gstin ?? null,
        state_code: c?.stateCode ?? null,
        // GST details (D8): saved on the customer by the last GST bill or the owner's Edit; the legal name falls back to
        // the linked Zoho contact's name (what Zoho knows the customer as), then the calling name
        legal_name: c?.legalName ?? zohoName ?? o.customerName,
        gst_treatment: c?.gstTreatment ?? null,
        billing_address: c?.billingAddress ?? null,
        billing_city: c?.billingCity ?? null,
        billing_pin: c?.billingPin ?? null,
      },
      salespeople: people,
      last: { salesperson_id: last?.salespersonId && people.some((p) => p.id === last.salespersonId) ? last.salespersonId : null, vehicle: last?.vehicle ?? null },
      vehicles: vehicles.rows.map((v) => v.vehicle),
      lines: lines.map((l) => ({
        line_no: l.lineNo,
        name: l.productName,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        amount: l.lineTotal,
        /** free boxes (scheme): amount 0, `rate` = what they are worth */
        free: l.free,
        hsn: sku.get(l.skuId)?.hsn ?? null,
        gst_rate: sku.get(l.skuId)?.gst_rate ?? null,
      })),
      states: Object.entries(GST_STATES).map(([code, name]) => ({ code, name })),
    };
  });
}
export type BillForm = Awaited<ReturnType<typeof billForm>>;

/** The name Zoho knows a customer by: a linked Zoho contact's (one with a GSTIN first). */
async function linkedZohoName(tx: OcTx, tenantId: string, customerId: string) {
  const rows = await tx.select({ name: zohoContacts.name, gstin: zohoContacts.gstin }).from(zohoContacts).where(and(eq(zohoContacts.tenantId, tenantId), eq(zohoContacts.customerId, customerId)));
  return (rows.find((r) => r.gstin) ?? rows[0])?.name ?? null;
}

// ---------- Make bill ----------

const LineIn = z.object({
  line_no: z.number().int().min(1).max(500),
  description: text(500),
  /** the line's discount in rupees, or … */
  discount: Money.optional(),
  /** … in percent of the line */
  discount_pct: z.number().min(0).max(100).optional(),
});

export const MakeBillInput = z.object({
  order_id: z.uuid(),
  bill_date: Day.optional(),
  terms: z.enum(BILL_TERMS as [BillTerms, ...BillTerms[]]).optional(),
  /** a due date typed by hand (else the terms give it) */
  due_date: Day.optional(),
  salesperson_id: z.uuid().nullable().optional(),
  vehicle: text(30),
  reference_no: text(50),
  notes: z.string().trim().max(2000).optional(),
  private_note: text(500),
  discount: Money.optional(),
  adjustment: SignedMoney.optional(),
  needs_gst: z.boolean().default(false),
  gstin: z.string().max(30).optional(),
  place_of_supply: z.string().regex(/^\d{2}$/, "Place of supply: a GST state code").optional(),
  tax_inclusive: z.boolean().optional(),
  /** GST bills only (D8): who the GST invoice is for; saved on the customer for the next one */
  legal_name: text(200),
  gst_treatment: z.enum(GST_TREATMENTS).optional(),
  billing_address: text(300),
  billing_city: text(80),
  billing_pin: z.string().trim().regex(/^([1-9]\d{5})?$/, "PIN code: 6 digits").optional(),
  lines: z.array(LineIn).max(500).default([]),
  zoho_gst_invoice_no: text(40),
});

/** Make the bill of a delivered order (owner, Accounts): its current lines; the customer's advances pay it first. */
export async function makeBill(user: OcUser, raw: z.input<typeof MakeBillInput>) {
  requireAccess(user, "bill_make");
  const input = MakeBillInput.parse(raw);
  const today = istToday();
  const billDate = input.bill_date ?? today;
  if (billDate > today) throw badRequest("The bill date can't be in the future.");

  let gstin: string | null = null;
  if (input.gstin?.trim()) {
    gstin = normaliseGstin(input.gstin);
    const problem = gstinProblem(gstin);
    if (problem) throw badRequest(`Customer ${problem}`);
  }
  const [products, gst, people] = await Promise.all([
    kit.products(user.tenantId),
    input.needs_gst ? plantGst(user.tenantId) : Promise.resolve(null),
    input.salesperson_id ? salespeople(user.tenantId) : Promise.resolve([]),
  ]);
  if (input.needs_gst && !gst) throw badRequest("A GST bill needs your GSTIN: add it on PlantOps → Business details first.");
  const salesperson = input.salesperson_id ? people.find((p) => p.id === input.salesperson_id) : null;
  if (input.salesperson_id && !salesperson) throw badRequest("That salesperson isn't one of the plant's Sales people. Pick again or choose None.");
  const sku = new Map(products.map((p) => [p.id, p]));

  return withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.bill'), hashtext(${user.tenantId}))`);
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, input.order_id))).for("update");
    if (!o) throw notFound("Order not found");
    if (o.status !== "delivered") throw conflict("Only a delivered order gets a bill. Mark it delivered first.");
    const [open] = await tx.select({ number: bills.number }).from(bills).where(and(eq(bills.tenantId, user.tenantId), eq(bills.orderId, o.id), isNull(bills.cancelledAt)));
    if (open) throw conflict(`This order already has bill ${open.number}.`);
    const delivered = istDay(o.deliveredAt!);
    if (billDate < delivered) throw badRequest("The bill date can't be before the delivery.");
    const settings = await readSettings(tx, user.tenantId);
    const terms = input.terms ?? settings.default_terms;
    const due = input.due_date ?? dueFromTerms(billDate, terms);
    if (due < billDate) throw badRequest("The due date can't be before the bill date.");

    const lines = await tx.select().from(orderLines).where(and(eq(orderLines.tenantId, user.tenantId), eq(orderLines.orderId, o.id), eq(orderLines.version, o.version))).orderBy(orderLines.lineNo);
    const extra = new Map(input.lines.map((l) => [l.line_no, l]));
    for (const n of extra.keys()) if (!lines.some((l) => l.lineNo === n)) throw badRequest(`The order has no line ${n}.`);

    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, o.customerId)));
    const place = input.needs_gst ? (input.place_of_supply ?? (gstin ? gstinState(gstin) : null) ?? c?.stateCode ?? gst!.state) : null;
    if (place && !GST_STATES[place]) throw badRequest("Place of supply: not a GST state code.");
    const inclusive = input.needs_gst ? (input.tax_inclusive ?? settings.rates_include_gst) : null;
    // GST details (D8): typed on the form, else the customer's saved ones; a registered business needs name + address
    let billTo: { name: string; treatment: GstTreatment; address: string | null; city: string | null; pin: string | null } | null = null;
    if (input.needs_gst) {
      const pick = (typed: string | undefined, saved: string | null | undefined) => (typed !== undefined ? typed.trim() || null : (saved ?? null));
      const treatment: GstTreatment = gstin ? "registered" : input.gst_treatment && input.gst_treatment !== "registered" ? input.gst_treatment : c?.gstTreatment && c.gstTreatment !== "registered" ? c.gstTreatment : "consumer";
      const name = pick(input.legal_name, c?.legalName) ?? (await linkedZohoName(tx, user.tenantId, o.customerId)) ?? o.customerName;
      if (name.length < 2) throw badRequest("Legal name: at least 2 characters.");
      billTo = { name, treatment, address: pick(input.billing_address, c?.billingAddress), city: pick(input.billing_city, c?.billingCity), pin: pick(input.billing_pin, c?.billingPin) };
      if (treatment === "registered" && (!billTo.address || !billTo.city || !billTo.pin))
        throw badRequest("A GST bill for a registered business needs the billing address, city and PIN code (as on their GST registration).");
    }

    let amounts;
    try {
      amounts = billAmounts(
        lines.map((l) => {
          const amount = paise(l.lineTotal);
          const x = extra.get(l.lineNo);
          // a free line (amount 0) takes no discount of its own
          const lineDiscount = l.free ? 0n : x?.discount ? paise(x.discount) : x?.discount_pct ? (amount * BigInt(Math.round(x.discount_pct * 100)) + 5000n) / 10000n : 0n;
          return { amount, discount: lineDiscount, gst_rate: sku.get(l.skuId)?.gst_rate ?? null };
        }),
        input.discount ? paise(input.discount) : 0n,
        input.adjustment ? paise(input.adjustment) : 0n,
        input.needs_gst ? { inclusive: inclusive!, intra: place === gst!.state } : null,
      );
    } catch (e) {
      if (e instanceof BillAmountError) throw badRequest(e.message.replace(/Line (\d+)/, (_, n) => lines[Number(n) - 1]?.productName ?? `Line ${n}`));
      throw e;
    }

    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${bills.refNo}), 0)::int + 1` }).from(bills).where(eq(bills.tenantId, user.tenantId))) as [{ next: number }];
    const [b] = await tx
      .insert(bills)
      .values({
        tenantId: user.tenantId,
        source: "plantops",
        number: billRef(next),
        refNo: next,
        billDate,
        dueDate: due,
        terms,
        customerId: o.customerId,
        customerName: o.customerName,
        orderId: o.id,
        subTotal: rupees(amounts.sub_total),
        discount: rupees(amounts.discount),
        adjustment: rupees(amounts.adjustment),
        taxTotal: rupees(amounts.tax_total),
        cgst: rupees(amounts.cgst),
        sgst: rupees(amounts.sgst),
        igst: rupees(amounts.igst),
        total: rupees(amounts.total),
        notes: input.notes === undefined ? settings.default_notes : input.notes || null,
        salesperson: salesperson?.name ?? null,
        salespersonId: salesperson?.id ?? null,
        vehicle: input.vehicle || null,
        referenceNo: input.reference_no || null,
        privateNote: input.private_note || null,
        needsGst: input.needs_gst,
        gstin: input.needs_gst ? gstin : null,
        placeOfSupply: place,
        billToName: billTo?.name ?? null,
        billToAddress: billTo ? billToAddress(billTo) : null,
        gstTreatment: billTo?.treatment ?? null,
        taxInclusive: inclusive,
        zohoGstInvoiceNo: input.zoho_gst_invoice_no || null,
        createdBy: user.userId,
        createdByName: user.name,
      })
      .returning();
    await tx.insert(billLines).values(
      lines.map((l, i) => {
        const a = amounts.lines[i]!;
        const rate = sku.get(l.skuId)?.gst_rate ?? null;
        return {
          tenantId: user.tenantId,
          billId: b!.id,
          lineNo: l.lineNo,
          skuId: l.skuId,
          skuCode: sku.get(l.skuId)?.sku_code ?? null,
          itemName: l.productName,
          description: extra.get(l.lineNo)?.description || (l.free ? "Free" : null),
          quantity: String(l.quantity),
          unit: l.unit,
          rate: l.rate,
          // a free line: worth rate × quantity, all of it taken off (line 0), so the bill and the Zoho file show the value
          discount: l.free ? rupees(paise(l.rate) * BigInt(l.quantity)) : rupees(paise(l.lineTotal) - a.amount),
          free: l.free,
          taxName: input.needs_gst ? `${place === gst!.state ? "GST" : "IGST"}${rate}` : null,
          taxPercent: input.needs_gst ? String(rate) : null,
          taxAmount: rupees(a.tax),
          taxable: a.taxable === null ? null : rupees(a.taxable),
          hsn: sku.get(l.skuId)?.hsn ?? null,
          lineTotal: rupees(a.amount),
        };
      }),
    );
    // the customer keeps the GST details of their latest GST bill (GSTIN, state, legal name, address), so the next one
    // is filled in; the calling name never changes here
    if (billTo && c) {
      const next = {
        gstin: gstin ?? c.gstin,
        stateCode: place,
        legalName: billTo.name,
        gstTreatment: billTo.treatment,
        billingAddress: billTo.address,
        billingCity: billTo.city,
        billingPin: billTo.pin,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== c[k]);
      if (changed.length) await tx.update(customers).set(next).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, c.id)));
    }
    // the customer's advances (money paid before, not used yet) pay the new bill first, oldest payment first
    const advances = await customerAdvances(tx, user.tenantId, o.customerId);
    const used = useAdvances(amounts.total, advances);
    if (used.length)
      await tx.insert(paymentAllocations).values(used.map((u) => ({ tenantId: user.tenantId, paymentId: u.payment_id, billId: b!.id, amount: rupees(u.amount), allocatedOn: today, createdBy: user.userId, createdByName: user.name })));
    const advanceUsed = rupees(used.reduce((s, u) => s + u.amount, 0n));
    await audit(tx, user, "bill.make", b!.id, {
      number: b!.number,
      order: formatRef(o.refNo),
      customer: o.customerName,
      total: b!.total,
      discount: b!.discount,
      tax: b!.taxTotal,
      gst: input.needs_gst ? { gstin, place, inclusive, bill_to: billTo?.name, treatment: billTo?.treatment } : null,
      salesperson: b!.salesperson,
      vehicle: b!.vehicle,
      advance_used: advanceUsed,
    });
    return { id: b!.id, number: b!.number, total: b!.total, advance_used: advanceUsed };
  });
}

// ---------- GST invoices to make → Zoho ----------

/** Zoho Books' place-of-supply codes (its invoice export writes Odisha as "OD"). */
const ZOHO_STATE: Record<string, string> = {
  "01": "JK", "02": "HP", "03": "PB", "04": "CH", "05": "UK", "06": "HR", "07": "DL", "08": "RJ", "09": "UP", "10": "BR",
  "11": "SK", "12": "AR", "13": "NL", "14": "MN", "15": "MZ", "16": "TR", "17": "ML", "18": "AS", "19": "WB", "20": "JH",
  "21": "OD", "22": "CG", "23": "MP", "24": "GJ", "26": "DN", "27": "MH", "29": "KA", "30": "GA", "31": "LD", "32": "KL",
  "33": "TN", "34": "PY", "35": "AN", "36": "TS", "37": "AD", "38": "LA", "97": "OT",
};
const ZOHO_TERMS: Record<BillTerms, string> = { receipt: "0", net7: "7", net15: "15", net30: "30", eom: "-1" };

export async function gstQueue(user: OcUser) {
  requireAccess(user, "ledger_view");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(bills)
      .where(and(eq(bills.tenantId, user.tenantId), eq(bills.needsGst, true), isNull(bills.cancelledAt)))
      .orderBy(desc(bills.billDate), desc(bills.refNo));
    const view = (b: (typeof rows)[number]) => ({
      id: b.id,
      number: b.number,
      bill_date: b.billDate,
      customer: b.customerName,
      bill_to: b.billToName,
      gstin: b.gstin,
      place: b.placeOfSupply ? `${GST_STATES[b.placeOfSupply] ?? ""} (${b.placeOfSupply})` : null,
      inclusive: b.taxInclusive,
      taxable: rupees(paise(b.subTotal) - paise(b.discount) - (b.taxInclusive ? paise(b.taxTotal) : 0n)),
      cgst: b.cgst,
      sgst: b.sgst,
      igst: b.igst,
      tax: b.taxTotal,
      total: b.total,
      sent_at: b.sentToZohoAt?.toISOString() ?? null,
      sent_by: b.sentToZohoByName,
      invoice_no: b.zohoGstInvoiceNo,
    });
    return {
      not_sent: rows.filter((b) => !b.zohoGstInvoiceNo && !b.sentToZohoAt).map(view).reverse(),
      sent: rows.filter((b) => !b.zohoGstInvoiceNo && b.sentToZohoAt).map(view),
      done: rows.filter((b) => b.zohoGstInvoiceNo).slice(0, 30).map(view),
    };
  });
}
export type GstQueue = Awaited<ReturnType<typeof gstQueue>>;

export const ZOHO_COLUMNS = [
  "Invoice Date", "Invoice Number", "Invoice Status", "Customer Name", "GST Treatment", "GST Identification Number (GSTIN)",
  "Place of Supply", "Payment Terms", "Payment Terms Label", "Due Date", "Sales person", "PurchaseOrder", "Subject",
  "Is Inclusive Tax", "Discount Type", "Is Discount Before Tax", "Entity Discount Amount", "Adjustment", "Notes",
  "Currency Code", "Item Name", "SKU", "Item Desc", "HSN/SAC", "Quantity", "Usage unit", "Item Price", "Discount Amount",
  "Item Tax", "Item Tax %", "Item Tax Type", "Item Type",
  // the GST details' address (D8, v0.45.0); Zoho also keeps the address on its contact
  "Billing Address", "Billing City", "Billing State", "Billing Code", "Billing Country",
] as const;

/**
 * The CSV Zoho Books imports as invoices (one row per line, Zoho's own column names, as in the plant's Zoho export), for
 * the GST bills not sent yet ("new") or those already sent once ("again"). "new" marks them sent (who / when; once).
 */
export async function zohoCsvRows(user: OcUser, which: "new" | "again") {
  requireAccess(user, "bill_make");
  return withTenant(user.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.zoho_send'), hashtext(${user.tenantId}))`);
    const list = await tx
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.tenantId, user.tenantId),
          eq(bills.needsGst, true),
          isNull(bills.cancelledAt),
          isNull(bills.zohoGstInvoiceNo),
          which === "new" ? isNull(bills.sentToZohoAt) : isNotNull(bills.sentToZohoAt),
        ),
      )
      .orderBy(bills.billDate, bills.refNo);
    const rows: string[][] = [[...ZOHO_COLUMNS]];
    for (const b of list) {
      const lines = await tx.select().from(billLines).where(and(eq(billLines.tenantId, user.tenantId), eq(billLines.billId, b.id))).orderBy(billLines.lineNo);
      const terms = (b.terms ?? "receipt") as BillTerms;
      const addr = billToParts(b.billToAddress);
      for (const l of lines) {
        rows.push([
          // "Customer Name" = the legal name (Zoho finds its contact by it); bills before v0.45.0 had only the calling name
          b.billDate, b.number, "Draft", b.billToName ?? b.customerName, b.gstTreatment ? ZOHO_TREATMENT[b.gstTreatment] : b.gstin ? "business_gst" : "consumer", b.gstin ?? "",
          ZOHO_STATE[b.placeOfSupply ?? ""] ?? "", ZOHO_TERMS[terms], TERMS_LABEL[terms], b.dueDate ?? b.billDate, b.salesperson ?? "",
          b.referenceNo ?? "", `PlantOps ${b.number}`,
          b.taxInclusive ? "true" : "false", "entity_level", "true", b.discount, b.adjustment, b.notes ?? "",
          "INR", l.itemName, l.skuCode ?? "", l.description ?? "", l.hsn ?? "", l.quantity, l.unit ?? "", l.rate, l.discount,
          l.taxName ?? "", l.taxPercent ?? "", l.taxName?.startsWith("IGST") ? "Tax" : "Tax Group", "goods",
          addr.address, addr.city, b.placeOfSupply ? (GST_STATES[b.placeOfSupply] ?? "") : "", addr.pin, b.billToAddress ? "India" : "",
        ]);
      }
    }
    if (which === "new" && list.length) {
      const ids = list.map((b) => b.id);
      await tx
        .update(bills)
        .set({ sentToZohoAt: new Date(), sentToZohoBy: user.userId, sentToZohoByName: user.name })
        .where(and(eq(bills.tenantId, user.tenantId), inArray(bills.id, ids), isNull(bills.sentToZohoAt)));
    }
    await audit(tx, user, which === "new" ? "bill.zoho_send" : "bill.zoho_send_again", user.tenantId, { bills: list.map((b) => b.number) });
    return { rows, count: list.length };
  });
}

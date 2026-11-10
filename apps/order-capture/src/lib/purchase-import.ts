// Zoho Books Purchases → Sales' purchases (docs/PURCHASES_PHASE_PLAN.md, P1). Pure functions: the browser reads Zoho's
// Vendors / Items / Bill / Vendor_Payment exports into the shapes below (only the columns needed), the server works out
// the plan against what the plant already has, then saves it in one transaction.
//
// Rules (owner, 2026-11-10):
// - vendors by Zoho's Contact ID; bills and payments name their vendor (Zoho's export has the name, not the id), matched
//   on the name with spaces / case ignored.
// - items: Zoho's purchase-only items, plus any item a bill uses; the products the plant sells stay PlantOps products.
// - Zoho's bill numbers 1, 2, 3… become PB-0001, PB-0002…; payment numbers PM-0001…; new ones continue after them.
// - payments keep Zoho's mode and "paid through" (all Cash / Petty Cash at plant 001; the owner corrects them later).
// - every bill's due after the import must equal Zoho's Balance, or nothing is saved.
// - importing again adds only what is new (by Zoho's ids); it never changes what an earlier import saved.
import { paise } from "./ledger";
import { paymentMode, type Mode } from "./zoho-import";

// ---------- what the browser sends (read from the CSVs) ----------

export type ZVendor = {
  zoho_id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  gstin: string;
  gst_treatment: string;
  address: string;
  terms: string;
  status: string;
};
export type ZItem = {
  zoho_id: string;
  name: string;
  sku: string;
  hsn: string;
  unit: string;
  rate: string;
  gst_percent: string;
  description: string;
  item_type: string;
  sellable: string;
  status: string;
};
export type ZBillLine = {
  item_id: string;
  item_name: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  discount: string;
  tax_name: string;
  tax_percent: string;
  tax_amount: string;
  hsn: string;
  line_total: string;
  cgst: string;
  sgst: string;
  igst: string;
};
export type ZBill = {
  zoho_id: string;
  number: string;
  date: string;
  due_date: string;
  status: string;
  vendor_name: string;
  po_number: string;
  sub_total: string;
  discount: string;
  adjustment: string;
  total: string;
  balance: string;
  notes: string;
  lines: ZBillLine[];
};
export type ZVendorPayment = {
  zoho_id: string;
  number: string;
  date: string;
  vendor_name: string;
  mode: string;
  paid_through: string;
  reference: string;
  amount: string;
  status: string;
  applied: { bill_id: string; amount: string; date: string }[];
};

export type PurchaseFiles = { vendors: ZVendor[]; items: ZItem[]; bills: ZBill[]; payments: ZVendorPayment[] };

// ---------- reading the CSVs ----------

const columns = (rows: string[][], need: string[], what: string) => {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = need.filter((n) => !header.includes(n.toLowerCase()));
  if (missing.length) throw new Error(`This isn't Zoho's ${what} export: it needs the columns ${missing.join(", ")}.`);
  return (r: string[], name: string) => {
    const i = header.indexOf(name.toLowerCase());
    return i < 0 ? "" : (r[i] ?? "").trim();
  };
};
const body = (rows: string[][]) => rows.slice(1).filter((r) => r.some((c) => c.trim()));
const day = (s: string) => s.slice(0, 10);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function readVendors(rows: string[][]): ZVendor[] {
  const c = columns(rows, ["Contact ID", "Display Name", "GST Treatment"], "Vendors");
  return body(rows).map((r) => ({
    zoho_id: c(r, "Contact ID"),
    name: oneLine(c(r, "Display Name")),
    company: oneLine(c(r, "Company Name")),
    phone: (c(r, "MobilePhone") || c(r, "Phone")).replace(/^'+/, "").trim(),
    email: c(r, "EmailID"),
    gstin: c(r, "GST Identification Number (GSTIN)").toUpperCase(),
    gst_treatment: c(r, "GST Treatment"),
    address: [c(r, "Billing Address"), c(r, "Billing Street2"), c(r, "Billing City"), c(r, "Billing State"), c(r, "Billing Code")]
      .map(oneLine)
      .filter(Boolean)
      .join(", "),
    terms: c(r, "Payment Terms Label"),
    status: c(r, "Status"),
  }));
}

export function readItems(rows: string[][]): ZItem[] {
  const c = columns(rows, ["Item ID", "Item Name", "Item Type"], "Items");
  return body(rows).map((r) => ({
    zoho_id: c(r, "Item ID"),
    name: oneLine(c(r, "Item Name")),
    sku: c(r, "SKU"),
    hsn: c(r, "HSN/SAC"),
    unit: c(r, "Usage unit") || c(r, "Unit Name"),
    rate: c(r, "Purchase Rate"),
    gst_percent: c(r, "Intra State Tax Rate"),
    description: c(r, "Purchase Description"),
    item_type: c(r, "Item Type"),
    sellable: c(r, "Sellable"),
    status: c(r, "Status"),
  }));
}

export function readBills(rows: string[][]): ZBill[] {
  const c = columns(rows, ["Bill ID", "Bill Number", "Bill Date", "Vendor Name", "Total", "Balance", "Item Total"], "Bill");
  const byId = new Map<string, ZBill>();
  for (const r of body(rows)) {
    const id = c(r, "Bill ID");
    let b = byId.get(id);
    if (!b) {
      b = {
        zoho_id: id,
        number: c(r, "Bill Number"),
        date: day(c(r, "Bill Date")),
        due_date: day(c(r, "Due Date")),
        status: c(r, "Bill Status"),
        vendor_name: oneLine(c(r, "Vendor Name")),
        po_number: c(r, "Purchase Order Number") || c(r, "PurchaseOrder"),
        sub_total: c(r, "SubTotal"),
        discount: c(r, "Entity Discount Amount"),
        adjustment: c(r, "Adjustment"),
        total: c(r, "Total"),
        balance: c(r, "Balance"),
        notes: c(r, "Vendor Notes"),
        lines: [],
      };
      byId.set(id, b);
    }
    b.lines.push({
      item_id: c(r, "Product ID"),
      item_name: oneLine(c(r, "Item Name")),
      description: oneLine(c(r, "Description")),
      quantity: c(r, "Quantity"),
      unit: c(r, "Usage unit"),
      rate: c(r, "Rate"),
      discount: c(r, "Discount Amount"),
      tax_name: c(r, "Tax Name"),
      tax_percent: c(r, "Tax Percentage"),
      tax_amount: c(r, "Tax Amount"),
      hsn: c(r, "HSN/SAC"),
      line_total: c(r, "Item Total"),
      cgst: c(r, "CGST"),
      sgst: c(r, "SGST"),
      igst: c(r, "IGST"),
    });
  }
  return [...byId.values()];
}

export function readVendorPayments(rows: string[][]): ZVendorPayment[] {
  const c = columns(rows, ["VendorPayment ID", "Payment Number", "Date", "Vendor Name", "Amount"], "Vendor Payment");
  const byId = new Map<string, ZVendorPayment>();
  for (const r of body(rows)) {
    const id = c(r, "VendorPayment ID");
    let p = byId.get(id);
    if (!p) {
      p = {
        zoho_id: id,
        number: c(r, "Payment Number"),
        date: day(c(r, "Date")),
        vendor_name: oneLine(c(r, "Vendor Name")),
        mode: c(r, "Mode"),
        paid_through: c(r, "Paid Through"),
        reference: c(r, "Reference Number"),
        amount: c(r, "Amount"),
        status: c(r, "Payment Status"),
        applied: [],
      };
      byId.set(id, p);
    }
    const bill = c(r, "Bill ID");
    if (bill) p.applied.push({ bill_id: bill, amount: c(r, "Bill Amount"), date: day(c(r, "Bill Payment Applied Date")) || p.date });
  }
  return [...byId.values()];
}

// ---------- small rules ----------

/** "BALAJI SALES  Sambalpur " and "Balaji Sales Sambalpur" are the same vendor. */
export const vendorKey = (name: string) => oneLine(name).toLowerCase();

/** "INR 105.00" / "1,186.00" / "" -> paise (0 when empty). */
export const amount = (s: string) => {
  const t = s.replace(/^[A-Z]{3}\s*/i, "").replace(/,/g, "").trim();
  return t ? paise(Number(t).toFixed(2)) : 0n;
};

export const purchaseBillRef = (n: number) => `PB-${String(n).padStart(4, "0")}`;
export const vendorPaymentRef = (n: number) => `PM-${String(n).padStart(4, "0")}`;

/** Zoho's GST treatment -> ours. */
export function gstTreatment(t: string): "registered" | "unregistered" | "overseas" | "other" | null {
  const x = t.toLowerCase();
  if (!x) return null;
  if (x.includes("overseas")) return "overseas";
  if (x === "business_none" || x.includes("unregistered") || x === "consumer") return "unregistered";
  if (x.startsWith("business_")) return "registered";
  return "other";
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const plainNumber = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);
const cut = (s: string, n: number) => (s ? s.slice(0, n) : null);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// ---------- the plan ----------

export type PurchaseExisting = {
  vendors: { id: string; zoho_contact_id: string | null; name: string }[];
  items: { id: string; zoho_item_id: string | null }[];
  /** bills already here (any source), with what is paid on them */
  bills: { id: string; zoho_bill_id: string | null; number: string; ref_no: number | null; total: bigint; paid: bigint }[];
  payments: { zoho_payment_id: string | null; number: string; ref_no: number | null }[];
};

export type NewVendor = {
  zoho_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  gst_treatment: ReturnType<typeof gstTreatment>;
  state: string | null;
  address: string | null;
  terms: string | null;
  active: boolean;
};
export type NewItem = {
  zoho_id: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit: string | null;
  rate: bigint | null;
  gst_percent: string | null;
  description: string | null;
  active: boolean;
};
export type NewPurchaseLine = {
  line_no: number;
  item_zoho_id: string | null;
  item_name: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  rate: bigint;
  discount: bigint;
  tax_name: string | null;
  tax_percent: string | null;
  tax_amount: bigint;
  hsn: string | null;
  line_total: bigint;
};
export type NewPurchaseBill = {
  key: string;
  number: string;
  ref_no: number | null;
  vendor_key: string;
  vendor_name: string;
  bill_date: string;
  due_date: string | null;
  po_number: string | null;
  sub_total: bigint;
  discount: bigint;
  adjustment: bigint;
  tax_total: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  total: bigint;
  notes: string | null;
  zoho_status: string | null;
  zoho_balance: bigint;
  lines: NewPurchaseLine[];
};
export type NewVendorPayment = {
  zoho_id: string;
  number: string;
  ref_no: number | null;
  vendor_key: string;
  vendor_name: string;
  payment_date: string;
  mode: Mode;
  paid_from: string | null;
  reference: string | null;
  amount: bigint;
  allocations: { bill_key: string; amount: bigint; date: string }[];
};

export type PurchasePlan = {
  vendors: NewVendor[];
  items: NewItem[];
  bills: NewPurchaseBill[];
  payments: NewVendorPayment[];
  skipped: { what: string; ref: string; reason: string }[];
  mismatches: { number: string; ours: bigint; zoho: bigint }[];
  counts: {
    vendors_new: number;
    vendors_already: number;
    items_new: number;
    items_already: number;
    items_skipped_sold: number;
    bills_new: number;
    bills_already: number;
    payments_new: number;
    payments_already: number;
  };
  /** paise: what this import adds, and the due on every bill in the files after it, ours vs Zoho's */
  totals: { billed: bigint; paid: bigint; tax: bigint; due_after: bigint; zoho_due: bigint };
};

export function planPurchaseImport(files: PurchaseFiles, existing: PurchaseExisting): PurchasePlan {
  const skipped: PurchasePlan["skipped"] = [];

  // --- vendors ---
  const knownVendorIds = new Set(existing.vendors.map((v) => v.zoho_contact_id).filter(Boolean) as string[]);
  const vendorNames = new Set(existing.vendors.map((v) => vendorKey(v.name)));
  const vendors: NewVendor[] = [];
  let vendorsAlready = 0;
  for (const v of files.vendors) {
    if (!v.zoho_id || !v.name) continue;
    if (knownVendorIds.has(v.zoho_id)) {
      vendorsAlready++;
      continue;
    }
    if (vendorNames.has(vendorKey(v.name))) {
      skipped.push({ what: "vendor", ref: v.name, reason: "A vendor with this name is already here" });
      continue;
    }
    vendorNames.add(vendorKey(v.name));
    const gstin = /^[0-9A-Z]{15}$/.test(v.gstin) ? v.gstin : null;
    vendors.push({
      zoho_id: v.zoho_id,
      name: v.name.slice(0, 200),
      company: v.company && v.company !== v.name ? v.company.slice(0, 200) : null,
      phone: cut(v.phone, 30),
      email: cut(v.email, 200),
      gstin,
      gst_treatment: gstTreatment(v.gst_treatment),
      state: gstin ? gstin.slice(0, 2) : null,
      address: cut(v.address, 500),
      terms: cut(v.terms, 60),
      active: !/inactive/i.test(v.status),
    });
  }

  // --- items: purchase-only ones, plus any a bill uses ---
  const usedOnBills = new Set(files.bills.flatMap((b) => b.lines.map((l) => l.item_id)).filter(Boolean));
  const knownItems = new Set(existing.items.map((i) => i.zoho_item_id).filter(Boolean) as string[]);
  const items: NewItem[] = [];
  let itemsAlready = 0;
  let itemsSkippedSold = 0;
  for (const i of files.items) {
    if (!i.zoho_id || !i.name) continue;
    if (knownItems.has(i.zoho_id)) {
      itemsAlready++;
      continue;
    }
    const purchaseOnly = /purchase/i.test(i.item_type) && i.sellable.toLowerCase() !== "true";
    if (!purchaseOnly && !usedOnBills.has(i.zoho_id)) {
      itemsSkippedSold++;
      continue;
    }
    const rate = amount(i.rate);
    items.push({
      zoho_id: i.zoho_id,
      name: i.name.slice(0, 200),
      sku: cut(i.sku, 40),
      hsn: cut(i.hsn, 12),
      unit: cut(i.unit, 20),
      rate: i.rate.trim() ? rate : null,
      gst_percent: i.gst_percent.trim() && Number.isFinite(Number(i.gst_percent)) ? Number(i.gst_percent).toFixed(2) : null,
      description: cut(i.description, 500),
      active: !/inactive/i.test(i.status),
    });
  }
  const itemIds = new Set([...knownItems, ...items.map((i) => i.zoho_id)]);

  // --- bills ---
  const usedBillRefs = new Set(existing.bills.map((b) => b.ref_no).filter((n): n is number => n !== null));
  const usedBillNumbers = new Set(existing.bills.map((b) => b.number));
  const knownBills = new Map(existing.bills.filter((b) => b.zoho_bill_id).map((b) => [b.zoho_bill_id!, b]));
  const bills: NewPurchaseBill[] = [];
  let billsAlready = 0;
  for (const b of files.bills) {
    if (knownBills.has(b.zoho_id)) {
      billsAlready++;
      continue;
    }
    if (/void|draft/i.test(b.status)) {
      skipped.push({ what: "bill", ref: b.number, reason: `Zoho status ${b.status}` });
      continue;
    }
    if (!vendorNames.has(vendorKey(b.vendor_name))) {
      skipped.push({ what: "bill", ref: b.number, reason: `Its vendor "${b.vendor_name}" is not in the Vendors file` });
      continue;
    }
    if (!isDate(b.date)) {
      skipped.push({ what: "bill", ref: b.number, reason: "No bill date" });
      continue;
    }
    const n = plainNumber(b.number);
    let ref_no: number | null = null;
    let number = b.number.slice(0, 40);
    if (n !== null && n >= 1 && !usedBillRefs.has(n)) {
      ref_no = n;
      number = purchaseBillRef(n);
    } else if (usedBillNumbers.has(number)) number = `Zoho ${number}`.slice(0, 40);
    if (ref_no !== null) usedBillRefs.add(ref_no);
    usedBillNumbers.add(number);
    const lines: NewPurchaseLine[] = b.lines.map((l, k) => ({
      line_no: k + 1,
      item_zoho_id: l.item_id && itemIds.has(l.item_id) ? l.item_id : null,
      item_name: (l.item_name || "Item").slice(0, 200),
      description: l.description && l.description !== l.item_name ? l.description.slice(0, 500) : null,
      quantity: Number(l.quantity || "0").toFixed(3),
      unit: cut(l.unit, 20),
      rate: amount(l.rate),
      discount: amount(l.discount),
      tax_name: cut(l.tax_name, 40),
      tax_percent: l.tax_percent ? Number(l.tax_percent).toFixed(2) : null,
      tax_amount: amount(l.tax_amount),
      hsn: cut(l.hsn, 12),
      line_total: amount(l.line_total),
    }));
    bills.push({
      key: b.zoho_id,
      number,
      ref_no,
      vendor_key: vendorKey(b.vendor_name),
      vendor_name: b.vendor_name.slice(0, 200),
      bill_date: b.date,
      due_date: isDate(b.due_date) ? b.due_date : null,
      po_number: cut(b.po_number, 40),
      sub_total: amount(b.sub_total),
      discount: amount(b.discount),
      adjustment: amount(b.adjustment),
      tax_total: sum(lines.map((l) => l.tax_amount)),
      cgst: sum(b.lines.map((l) => amount(l.cgst))),
      sgst: sum(b.lines.map((l) => amount(l.sgst))),
      igst: sum(b.lines.map((l) => amount(l.igst))),
      total: amount(b.total),
      notes: cut(b.notes, 2000),
      zoho_status: cut(b.status, 30),
      zoho_balance: amount(b.balance),
      lines,
    });
  }
  const billKeys = new Set([...knownBills.keys(), ...bills.map((b) => b.key)]);

  // --- payments ---
  const knownPayments = new Set(existing.payments.map((p) => p.zoho_payment_id).filter(Boolean) as string[]);
  const usedPayRefs = new Set(existing.payments.map((p) => p.ref_no).filter((n): n is number => n !== null));
  const usedPayNumbers = new Set(existing.payments.map((p) => p.number));
  const payments: NewVendorPayment[] = [];
  let paymentsAlready = 0;
  for (const p of files.payments) {
    if (knownPayments.has(p.zoho_id)) {
      paymentsAlready++;
      continue;
    }
    if (/draft|void/i.test(p.status)) {
      skipped.push({ what: "payment", ref: p.number, reason: `Zoho status ${p.status}` });
      continue;
    }
    if (!vendorNames.has(vendorKey(p.vendor_name))) {
      skipped.push({ what: "payment", ref: p.number, reason: `Its vendor "${p.vendor_name}" is not in the Vendors file` });
      continue;
    }
    const amt = amount(p.amount);
    if (amt <= 0n || !isDate(p.date)) {
      skipped.push({ what: "payment", ref: p.number, reason: "No amount or date" });
      continue;
    }
    const allocations: NewVendorPayment["allocations"] = [];
    for (const a of p.applied) {
      const x = amount(a.amount);
      if (!billKeys.has(a.bill_id)) {
        skipped.push({ what: "payment", ref: `${p.number} → bill ${a.bill_id}`, reason: "Paid a bill not in the Bill file (kept as unused)" });
        continue;
      }
      if (x !== 0n) allocations.push({ bill_key: a.bill_id, amount: x, date: isDate(a.date) ? a.date : p.date });
    }
    const n = plainNumber(p.number);
    let ref_no: number | null = null;
    let number = p.number.slice(0, 40);
    if (n !== null && n >= 1 && !usedPayRefs.has(n)) {
      ref_no = n;
      number = vendorPaymentRef(n);
    } else if (usedPayNumbers.has(number)) number = `Zoho ${number}`.slice(0, 40);
    if (ref_no !== null) usedPayRefs.add(ref_no);
    usedPayNumbers.add(number);
    payments.push({
      zoho_id: p.zoho_id,
      number,
      ref_no,
      vendor_key: vendorKey(p.vendor_name),
      vendor_name: p.vendor_name.slice(0, 200),
      payment_date: p.date,
      mode: paymentMode(p.mode, p.paid_through),
      paid_from: cut(p.paid_through, 100),
      reference: cut(p.reference, 100),
      amount: amt,
      allocations,
    });
  }

  // --- each bill's due after this import vs Zoho's Balance ---
  const paidNow = new Map<string, bigint>();
  for (const p of payments) for (const a of p.allocations) paidNow.set(a.bill_key, (paidNow.get(a.bill_key) ?? 0n) + a.amount);
  const fileBalance = new Map(files.bills.map((b) => [b.zoho_id, amount(b.balance)]));
  const mismatches: PurchasePlan["mismatches"] = [];
  let dueAfter = 0n;
  let zohoDue = 0n;
  const check = (number: string, ours: bigint, zoho: bigint) => {
    if (ours !== zoho) mismatches.push({ number, ours, zoho });
    dueAfter += ours > 0n ? ours : 0n;
    zohoDue += zoho;
  };
  for (const b of bills) check(b.number, b.total - (paidNow.get(b.key) ?? 0n), b.zoho_balance);
  for (const b of existing.bills) {
    const extra = paidNow.get(b.zoho_bill_id ?? "");
    const zoho = fileBalance.get(b.zoho_bill_id ?? "");
    if (extra !== undefined && zoho !== undefined) check(b.number, b.total - b.paid - extra, zoho);
  }

  return {
    vendors,
    items,
    bills,
    payments,
    skipped,
    mismatches,
    counts: {
      vendors_new: vendors.length,
      vendors_already: vendorsAlready,
      items_new: items.length,
      items_already: itemsAlready,
      items_skipped_sold: itemsSkippedSold,
      bills_new: bills.length,
      bills_already: billsAlready,
      payments_new: payments.length,
      payments_already: paymentsAlready,
    },
    totals: {
      billed: sum(bills.map((b) => b.total)),
      paid: sum(payments.map((p) => p.amount)),
      tax: sum(bills.map((b) => b.tax_total)),
      due_after: dueAfter,
      zoho_due: zohoDue,
    },
  };
}

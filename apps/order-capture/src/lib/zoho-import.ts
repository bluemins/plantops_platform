// Zoho Books → Order Capture's sales ledger (docs/ZOHO_IMPORT_PHASE_PLAN.md section 8). Pure functions: the browser
// reads Zoho's Contacts / Invoice / Customer_Payment exports into the shapes below (only the columns needed), the server
// works out the plan against what the plant already has, then saves it in one transaction.
//
// Rules (owner, 2026-11-06):
// - contacts: linked to a customer only when exactly one Zoho contact has a mobile already in the customer list (the
//   plant's own name wins). No customer is ever created here: every other contact stays "not matched" for the owner's
//   Match screen (owner, 2026-11-06: "I can do the match ... do not miss anything").
// - invoices -> bills (Zoho's lines exactly); a contact's opening balance -> its own bill "OB-<contact id>".
// - payments -> payments, deposited to a non-cash account -> Bank; drafts skipped; what each paid -> allocations.
// - an invoice Zoho shows as settled for more than its payments -> a "closed in Zoho" adjustment for the difference.
// - delivered orders -> linked to their bill: same mobile, invoice 1 day before to 3 days after delivery, same products
//   and quantities, exactly one such bill; otherwise listed under "Check these".
// - importing again adds only what is new (by Zoho's ids); it never changes what an earlier import saved.
import { normalisePhone } from "@plantops/module-kit/phone";
import { paise } from "./ledger";

// ---------- what the browser sends (read from the CSVs) ----------

export type ZContact = {
  zoho_id: string;
  name: string;
  company: string;
  mobile_typed: string;
  gstin: string;
  status: string;
  /** YYYY-MM-DD (Created Time): the opening balance's date */
  created: string;
  opening_balance: string;
};
export type ZInvoiceLine = {
  sku: string;
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
};
export type ZInvoice = {
  zoho_id: string;
  number: string;
  date: string;
  due_date: string;
  status: string;
  contact_id: string;
  customer_name: string;
  sub_total: string;
  discount: string;
  adjustment: string;
  total: string;
  balance: string;
  notes: string;
  salesperson: string;
  lines: ZInvoiceLine[];
};
export type ZPayment = {
  zoho_id: string;
  number: string;
  date: string;
  contact_id: string;
  customer_name: string;
  mode: string;
  reference: string;
  deposit_to: string;
  amount: string;
  status: string;
  /** invoice number, or "Customer opening balance" */
  applied: { invoice: string; amount: string; date: string }[];
};

export type ZohoFiles = { contacts: ZContact[]; invoices: ZInvoice[]; payments: ZPayment[] };

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

export function readContacts(rows: string[][]): ZContact[] {
  const c = columns(rows, ["Contact ID", "Display Name"], "Contacts");
  return body(rows).map((r) => ({
    zoho_id: c(r, "Contact ID"),
    name: c(r, "Display Name").replace(/\s+/g, " "),
    company: c(r, "Company Name"),
    mobile_typed: c(r, "MobilePhone") || c(r, "Phone"),
    gstin: c(r, "GST Identification Number (GSTIN)").toUpperCase(),
    status: c(r, "Status"),
    created: day(c(r, "Created Time")),
    opening_balance: c(r, "Opening Balance"),
  }));
}

export function readInvoices(rows: string[][]): ZInvoice[] {
  const c = columns(rows, ["Invoice ID", "Invoice Number", "Invoice Date", "Customer ID", "Total", "Balance", "Item Total"], "Invoice");
  const byId = new Map<string, ZInvoice>();
  for (const r of body(rows)) {
    const id = c(r, "Invoice ID");
    let inv = byId.get(id);
    if (!inv) {
      inv = {
        zoho_id: id,
        number: c(r, "Invoice Number"),
        date: c(r, "Invoice Date"),
        due_date: c(r, "Due Date"),
        status: c(r, "Invoice Status"),
        contact_id: c(r, "Customer ID"),
        customer_name: c(r, "Customer Name").replace(/\s+/g, " "),
        sub_total: c(r, "SubTotal"),
        discount: c(r, "Entity Discount Amount"),
        adjustment: c(r, "Adjustment"),
        total: c(r, "Total"),
        balance: c(r, "Balance"),
        notes: c(r, "Notes"),
        salesperson: c(r, "Sales person"),
        lines: [],
      };
      byId.set(id, inv);
    }
    inv.lines.push({
      sku: c(r, "SKU").toUpperCase(),
      item_name: c(r, "Item Name"),
      description: c(r, "Item Desc"),
      quantity: c(r, "Quantity"),
      unit: c(r, "Usage unit"),
      rate: c(r, "Item Price"),
      discount: c(r, "Discount Amount"),
      tax_name: c(r, "Item Tax"),
      tax_percent: c(r, "Item Tax %"),
      tax_amount: c(r, "Item Tax Amount"),
      hsn: c(r, "HSN/SAC"),
      line_total: c(r, "Item Total"),
    });
  }
  return [...byId.values()];
}

export function readPayments(rows: string[][]): ZPayment[] {
  const c = columns(rows, ["CustomerPayment ID", "Payment Number", "Date", "CustomerID", "Amount"], "Customer Payment");
  const byId = new Map<string, ZPayment>();
  for (const r of body(rows)) {
    const id = c(r, "CustomerPayment ID");
    let p = byId.get(id);
    if (!p) {
      p = {
        zoho_id: id,
        number: c(r, "Payment Number"),
        date: c(r, "Date"),
        contact_id: c(r, "CustomerID"),
        customer_name: c(r, "Customer Name").replace(/\s+/g, " "),
        mode: c(r, "Mode"),
        reference: c(r, "Reference Number"),
        deposit_to: c(r, "Deposit To"),
        amount: c(r, "Amount"),
        status: c(r, "Payment Status"),
        applied: [],
      };
      byId.set(id, p);
    }
    const invoice = c(r, "Invoice Number");
    if (invoice) p.applied.push({ invoice, amount: c(r, "Amount Applied to Invoice"), date: c(r, "Invoice Payment Applied Date") || p.date });
  }
  return [...byId.values()];
}

// ---------- small rules ----------

/** Zoho writes mobiles as '+91-6371530928 (leading apostrophe for Excel). */
export const zohoMobile = (typed: string) => normalisePhone(typed.replace(/^'+/, "").trim());

/** "Sahu Hotel(Bijepur)" -> "Bijepur"; no brackets -> "Not set". */
export function placeFromName(name: string) {
  const m = name.match(/\(([^()]{2,60})\)\s*$/);
  return m ? m[1]!.trim() : "Not set";
}

/** A customer name Order Capture accepts (2–100 characters). */
export function customerName(name: string) {
  const n = name.trim().slice(0, 100);
  return n.length >= 2 ? n : `${n} (Zoho)`.trim();
}

export const MODES = ["cash", "upi", "bank", "cheque", "other"] as const;
export type Mode = (typeof MODES)[number];

/** Zoho's mode, but "Cash" deposited to a non-cash account (e.g. the bank) is Bank (owner, 2026-11-06). */
export function paymentMode(mode: string, depositTo: string): Mode {
  const m = mode.toLowerCase();
  const d = depositTo.toLowerCase();
  if (m.includes("upi")) return "upi";
  if (m.includes("cheque") || m.includes("check")) return "cheque";
  if (/bank|neft|imps|rtgs|transfer/.test(m)) return "bank";
  if (m.includes("cash") || !m) return d && !d.includes("cash") && !d.includes("opening balance") ? "bank" : "cash";
  return "other";
}

const money = (s: string) => (s.trim() ? paise(Number(s.replace(/,/g, "")).toFixed(2)) : 0n);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const OPENING = "Customer opening balance";
export const obKey = (contactZohoId: string) => `ob:${contactZohoId}`;

// ---------- the plan ----------

export type Existing = {
  customers: { id: string; name: string; phone: string }[];
  contacts: { id: string; zoho_contact_id: string; customer_id: string | null; mobile: string | null }[];
  /** bills already imported from Zoho (incl. opening balances), with what is paid / adjusted on them */
  bills: { id: string; zoho_invoice_id: string; number: string; order_id: string | null; total: bigint; paid: bigint; adjusted: bigint }[];
  payment_ids: string[];
  skus: { id: string; sku_code: string | null }[];
  /** delivered orders with no bill yet; delivered_on = India date; lines of the current version */
  orders: { id: string; ref_no: number; phone: string; delivered_on: string; lines: { sku_id: string; quantity: number }[] }[];
};

export type NewContact = {
  zoho_id: string;
  name: string;
  company: string | null;
  mobile_typed: string | null;
  mobile: string | null;
  gstin: string | null;
  status: string | null;
  /** the existing customer with the same mobile (only when exactly one Zoho contact has it); else matched by the owner */
  link: { customer_id: string } | null;
};
export type NewBillLine = {
  line_no: number;
  sku_id: string | null;
  sku_code: string | null;
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
export type NewBill = {
  key: string;
  number: string;
  contact_zoho_id: string;
  customer_name: string;
  bill_date: string;
  due_date: string | null;
  sub_total: bigint;
  discount: bigint;
  adjustment: bigint;
  tax_total: bigint;
  total: bigint;
  notes: string | null;
  salesperson: string | null;
  zoho_status: string | null;
  zoho_balance: bigint;
  opening_balance: boolean;
  lines: NewBillLine[];
};
export type NewPayment = {
  zoho_id: string;
  number: string;
  contact_zoho_id: string;
  customer_name: string;
  payment_date: string;
  mode: Mode;
  reference: string | null;
  deposit_to: string | null;
  amount: bigint;
  allocations: { bill_key: string; amount: bigint; date: string }[];
};

export type ImportPlan = {
  contacts: NewContact[];
  bills: NewBill[];
  payments: NewPayment[];
  adjustments: { bill_key: string; amount: bigint; date: string }[];
  order_links: { order_id: string; ref_no: number; bill_key: string; number: string }[];
  check_orders: { order_id: string; ref_no: number; phone: string; delivered_on: string; candidates: string[] }[];
  shared_mobiles: { mobile: string; names: string[] }[];
  skipped: { what: string; ref: string; reason: string }[];
  mismatches: { number: string; ours: bigint; zoho: bigint }[];
  unknown_skus: string[];
  counts: {
    contacts_new: number;
    contacts_linked: number;
    contacts_unmatched: number;
    contacts_no_phone: number;
    contacts_already: number;
    bills_new: number;
    opening_balances: number;
    bills_already: number;
    payments_new: number;
    payments_already: number;
    adjustments: number;
    orders_linked: number;
    orders_to_check: number;
  };
  /** money, in paise: what this import adds, and the due on every bill in the files after it, ours vs Zoho's */
  totals: { billed: bigint; received: bigint; adjusted: bigint; due_after: bigint; zoho_due: bigint };
};

export function planImport(files: ZohoFiles, existing: Existing, exportDate: string): ImportPlan {
  const skipped: ImportPlan["skipped"] = [];
  const skuByCode = new Map(existing.skus.filter((s) => s.sku_code).map((s) => [s.sku_code!, s.id]));
  const unknownSkus = new Set<string>();

  // --- contacts: linked only on an exact, unique mobile; never a new customer (the owner matches the rest) ---
  const knownContacts = new Map(existing.contacts.map((c) => [c.zoho_contact_id, c]));
  const customerByPhone = new Map(existing.customers.map((c) => [c.phone, c]));
  const linkedCustomers = new Set(existing.contacts.map((c) => c.customer_id).filter(Boolean) as string[]);
  const contactsInFile = files.contacts.filter((c) => c.zoho_id && c.name);
  const byMobile = new Map<string, ZContact[]>();
  for (const c of contactsInFile) {
    const m = zohoMobile(c.mobile_typed);
    if (m) byMobile.set(m, [...(byMobile.get(m) ?? []), c]);
  }
  const importedMobiles = new Set(existing.contacts.map((c) => c.mobile).filter(Boolean) as string[]);
  const shared: ImportPlan["shared_mobiles"] = [...byMobile]
    .filter(([, list]) => list.length > 1)
    .map(([mobile, list]) => ({ mobile, names: list.map((c) => c.name) }));
  const contacts: NewContact[] = [];
  const counts = { contacts_new: 0, contacts_linked: 0, contacts_unmatched: 0, contacts_no_phone: 0, contacts_already: 0 };
  for (const c of contactsInFile) {
    if (knownContacts.has(c.zoho_id)) {
      counts.contacts_already++;
      continue;
    }
    counts.contacts_new++;
    const mobile = zohoMobile(c.mobile_typed);
    const customer = mobile ? customerByPhone.get(mobile) : undefined;
    const unique = !!mobile && byMobile.get(mobile)!.length === 1 && !importedMobiles.has(mobile);
    let link: NewContact["link"] = null;
    if (customer && unique && !linkedCustomers.has(customer.id)) {
      link = { customer_id: customer.id };
      linkedCustomers.add(customer.id);
      counts.contacts_linked++;
    } else counts.contacts_unmatched++;
    if (!mobile) counts.contacts_no_phone++;
    contacts.push({
      zoho_id: c.zoho_id,
      name: c.name.slice(0, 200),
      company: c.company || null,
      mobile_typed: mobile ? c.mobile_typed.replace(/^'+/, "").slice(0, 30) : null,
      mobile,
      gstin: /^[0-9A-Z]{15}$/.test(c.gstin) ? c.gstin : null,
      status: c.status || null,
      link,
    });
  }
  const contactIds = new Set([...knownContacts.keys(), ...contacts.map((c) => c.zoho_id)]);
  const contactMobile = new Map<string, string>();
  for (const c of contactsInFile) {
    const m = zohoMobile(c.mobile_typed);
    if (m) contactMobile.set(c.zoho_id, m);
  }

  // --- bills: invoices + opening balances ---
  const knownBills = new Map(existing.bills.map((b) => [b.zoho_invoice_id, b]));
  const bills: NewBill[] = [];
  let billsAlready = 0;
  for (const i of files.invoices) {
    if (knownBills.has(i.zoho_id)) {
      billsAlready++;
      continue;
    }
    if (/void|draft/i.test(i.status)) {
      skipped.push({ what: "invoice", ref: i.number, reason: `Zoho status ${i.status}` });
      continue;
    }
    if (!contactIds.has(i.contact_id)) {
      skipped.push({ what: "invoice", ref: i.number, reason: "Its customer is not in the Contacts file" });
      continue;
    }
    if (!isDate(i.date)) {
      skipped.push({ what: "invoice", ref: i.number, reason: "No invoice date" });
      continue;
    }
    const lines: NewBillLine[] = i.lines.map((l, n) => {
      const skuId = l.sku ? (skuByCode.get(l.sku) ?? null) : null;
      if (l.sku && !skuId) unknownSkus.add(l.sku);
      return {
        line_no: n + 1,
        sku_id: skuId,
        sku_code: l.sku || null,
        item_name: (l.item_name || l.sku || "Item").slice(0, 200),
        description: l.description ? l.description.slice(0, 500) : null,
        quantity: Number(l.quantity || "0").toFixed(3),
        unit: l.unit ? l.unit.slice(0, 20) : null,
        rate: money(l.rate),
        discount: money(l.discount),
        tax_name: l.tax_name ? l.tax_name.slice(0, 40) : null,
        tax_percent: l.tax_percent ? Number(l.tax_percent).toFixed(2) : null,
        tax_amount: money(l.tax_amount),
        hsn: l.hsn ? l.hsn.slice(0, 12) : null,
        line_total: money(l.line_total),
      };
    });
    bills.push({
      key: i.zoho_id,
      number: i.number.slice(0, 40),
      contact_zoho_id: i.contact_id,
      customer_name: (i.customer_name || "Customer").slice(0, 200),
      bill_date: i.date,
      due_date: isDate(i.due_date) ? i.due_date : null,
      sub_total: money(i.sub_total),
      discount: money(i.discount),
      adjustment: money(i.adjustment),
      tax_total: lines.reduce((a, l) => a + l.tax_amount, 0n),
      total: money(i.total),
      notes: i.notes ? i.notes.slice(0, 2000) : null,
      salesperson: i.salesperson ? i.salesperson.slice(0, 100) : null,
      zoho_status: i.status ? i.status.slice(0, 30) : null,
      zoho_balance: money(i.balance),
      opening_balance: false,
      lines,
    });
  }
  // opening balances (a contact's balance from before Zoho), paid through "Customer opening balance"
  let openingBalances = 0;
  for (const c of contactsInFile) {
    const ob = money(c.opening_balance);
    if (ob <= 0n) continue;
    const key = obKey(c.zoho_id);
    if (knownBills.has(key)) {
      billsAlready++;
      continue;
    }
    openingBalances++;
    const date = isDate(c.created) ? c.created : exportDate;
    bills.push({
      key,
      number: `OB-${c.zoho_id}`.slice(0, 40),
      contact_zoho_id: c.zoho_id,
      customer_name: c.name.slice(0, 200),
      bill_date: date,
      due_date: date,
      sub_total: ob,
      discount: 0n,
      adjustment: 0n,
      tax_total: 0n,
      total: ob,
      notes: "Opening balance in Zoho",
      salesperson: null,
      zoho_status: null,
      zoho_balance: -1n, // worked out below from the payments
      opening_balance: true,
      lines: [],
    });
  }

  // --- payments ---
  const knownPayments = new Set(existing.payment_ids);
  const billKeyByNumber = new Map<string, string>([
    ...existing.bills.map((b) => [b.number, b.zoho_invoice_id] as [string, string]),
    ...bills.map((b) => [b.number, b.key] as [string, string]),
  ]);
  const payments: NewPayment[] = [];
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
    if (!contactIds.has(p.contact_id)) {
      skipped.push({ what: "payment", ref: p.number, reason: "Its customer is not in the Contacts file" });
      continue;
    }
    const amount = money(p.amount);
    if (amount <= 0n || !isDate(p.date)) {
      skipped.push({ what: "payment", ref: p.number, reason: "No amount or date" });
      continue;
    }
    const allocations: NewPayment["allocations"] = [];
    for (const a of p.applied) {
      const key = a.invoice === OPENING ? obKey(p.contact_id) : billKeyByNumber.get(a.invoice);
      const amt = money(a.amount);
      if (!key || !(knownBills.has(key) || bills.some((b) => b.key === key))) {
        skipped.push({ what: "payment", ref: `${p.number} → ${a.invoice}`, reason: "Applied to an invoice not in the Invoice file (kept as unused)" });
        continue;
      }
      if (amt !== 0n) allocations.push({ bill_key: key, amount: amt, date: isDate(a.date) ? a.date : p.date });
    }
    payments.push({
      zoho_id: p.zoho_id,
      number: p.number.slice(0, 40),
      contact_zoho_id: p.contact_id,
      customer_name: (p.customer_name || "Customer").slice(0, 200),
      payment_date: p.date,
      mode: paymentMode(p.mode, p.deposit_to),
      reference: p.reference ? p.reference.slice(0, 100) : null,
      deposit_to: p.deposit_to ? p.deposit_to.slice(0, 100) : null,
      amount,
      allocations,
    });
  }

  // --- what each bill owes after this import vs Zoho; the difference Zoho settled without a payment ---
  const paidOn = new Map<string, bigint>();
  for (const p of payments) for (const a of p.allocations) paidOn.set(a.bill_key, (paidOn.get(a.bill_key) ?? 0n) + a.amount);
  const adjustments: ImportPlan["adjustments"] = [];
  const mismatches: ImportPlan["mismatches"] = [];
  let dueAfter = 0n;
  let zohoDue = 0n;
  const invoiceBalance = new Map(files.invoices.map((i) => [i.zoho_id, money(i.balance)]));
  for (const b of bills) {
    const paid = paidOn.get(b.key) ?? 0n;
    const ours = b.total - paid;
    if (b.opening_balance) {
      b.zoho_balance = ours > 0n ? ours : 0n;
      dueAfter += b.zoho_balance;
      zohoDue += b.zoho_balance;
      continue;
    }
    const zoho = b.zoho_balance;
    zohoDue += zoho;
    if (ours > zoho) {
      adjustments.push({ bill_key: b.key, amount: ours - zoho, date: exportDate });
      dueAfter += zoho;
    } else {
      if (ours < zoho) mismatches.push({ number: b.number, ours, zoho });
      dueAfter += ours > 0n ? ours : 0n;
    }
  }
  // bills from an earlier import that this import pays on: their due after it (no adjustment added later)
  for (const b of existing.bills) {
    const extra = paidOn.get(b.zoho_invoice_id);
    if (extra === undefined) continue;
    const ours = b.total - b.paid - b.adjusted - extra;
    const zoho = invoiceBalance.get(b.zoho_invoice_id);
    if (zoho !== undefined) {
      zohoDue += zoho;
      if (ours > zoho) adjustments.push({ bill_key: b.zoho_invoice_id, amount: ours - zoho, date: exportDate });
      else if (ours < zoho) mismatches.push({ number: b.number, ours, zoho });
      dueAfter += ours > zoho ? zoho : ours > 0n ? ours : 0n;
    }
  }

  // --- delivered orders -> their bill ---
  const allBills = [
    ...existing.bills.filter((b) => !b.order_id && !b.zoho_invoice_id.startsWith("ob:")).map((b) => ({ key: b.zoho_invoice_id, number: b.number, ...existingBillFacts(b, files, skuByCode) })),
    ...bills.filter((b) => !b.opening_balance).map((b) => ({ key: b.key, number: b.number, contact: b.contact_zoho_id, date: b.bill_date, lines: b.lines })),
  ].filter((b) => b.contact);
  const taken = new Set<string>();
  const order_links: ImportPlan["order_links"] = [];
  const check_orders: ImportPlan["check_orders"] = [];
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  for (const o of [...existing.orders].sort((a, b) => a.delivered_on.localeCompare(b.delivered_on) || a.ref_no - b.ref_no)) {
    const near = allBills.filter(
      (b) => !taken.has(b.key) && contactMobile.get(b.contact!) === o.phone && b.date! >= shift(o.delivered_on, -1) && b.date! <= shift(o.delivered_on, 3),
    );
    const want = qtyMap(o.lines.map((l) => ({ sku_id: l.sku_id, quantity: String(l.quantity) })));
    const same = near.filter((b) => b.lines!.every((l) => l.sku_id) && sameQty(qtyMap(b.lines!), want));
    if (same.length === 1) {
      taken.add(same[0]!.key);
      order_links.push({ order_id: o.id, ref_no: o.ref_no, bill_key: same[0]!.key, number: same[0]!.number });
    } else check_orders.push({ order_id: o.id, ref_no: o.ref_no, phone: o.phone, delivered_on: o.delivered_on, candidates: (same.length ? same : near).map((b) => b.number).slice(0, 5) });
  }

  return {
    contacts,
    bills,
    payments,
    adjustments,
    order_links,
    check_orders,
    shared_mobiles: shared,
    skipped,
    mismatches,
    unknown_skus: [...unknownSkus].sort(),
    counts: {
      ...counts,
      bills_new: bills.length,
      opening_balances: openingBalances,
      bills_already: billsAlready,
      payments_new: payments.length,
      payments_already: paymentsAlready,
      adjustments: adjustments.length,
      orders_linked: order_links.length,
      orders_to_check: check_orders.length,
    },
    totals: {
      billed: bills.reduce((a, b) => a + b.total, 0n),
      received: payments.reduce((a, p) => a + p.amount, 0n),
      adjusted: adjustments.reduce((a, x) => a + x.amount, 0n),
      due_after: dueAfter,
      zoho_due: zohoDue,
    },
  };
}

/** An earlier-imported bill's contact, date and lines, read back from the Invoice file (for order matching). */
function existingBillFacts(b: { zoho_invoice_id: string }, files: ZohoFiles, skuByCode: Map<string, string>) {
  const i = files.invoices.find((x) => x.zoho_id === b.zoho_invoice_id);
  if (!i) return { contact: null, date: null, lines: null };
  return { contact: i.contact_id, date: i.date, lines: i.lines.map((l) => ({ sku_id: l.sku ? (skuByCode.get(l.sku) ?? null) : null, quantity: Number(l.quantity || "0").toFixed(3) })) };
}

function qtyMap(lines: { sku_id: string | null; quantity: string }[]) {
  const m = new Map<string, number>();
  for (const l of lines) if (l.sku_id) m.set(l.sku_id, (m.get(l.sku_id) ?? 0) + Number(l.quantity));
  return m;
}
const sameQty = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) ?? -1) - v) < 0.0005);

// The sales ledger's money rules in one place (docs/ZOHO_IMPORT_PHASE_PLAN.md sections 5–7). Pure functions in whole
// paise (BigInt), used by the server, the CSV and the screens. Nothing here is stored: a bill's due, a payment's unused
// amount, a customer's balance, an order's "Closed" and the statement are worked out from the rows every time.
//
//   bill due        = total − what payments paid on it − adjustments            (a cancelled bill: 0)
//   payment unused  = amount − what it paid on bills                            (a cancelled payment: 0)
//   balance         = bills − payments − adjustments  (= dues − advances)       (cancelled rows left out)
//   order "Closed"  = delivered, with a bill that is not cancelled and fully paid

/** "1150.00" / "-3.60" / "0.5" -> paise. For numeric(…, 2) values from the database or checked rupee text. */
export function paise(rupees: string): bigint {
  const t = rupees.trim();
  const neg = t.startsWith("-");
  const [whole, frac = ""] = (neg ? t.slice(1) : t).split(".");
  const p = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -p : p;
}

/** -360n -> "-3.60" (what the database stores). */
export function rupees(p: bigint) {
  const a = p < 0n ? -p : p;
  return `${p < 0n ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
}

/** A PlantOps bill / payment number as people see it: B-0001, P-0042 (one series each per plant). */
export const billRef = (n: number) => `B-${String(n).padStart(4, "0")}`;
export const paymentRef = (n: number) => `P-${String(n).padStart(4, "0")}`;

export type LedgerBill = {
  id: string;
  number: string;
  /** YYYY-MM-DD */
  bill_date: string;
  due_date: string | null;
  total: bigint;
  cancelled: boolean;
  order_id: string | null;
};
export type LedgerPayment = { id: string; number: string; payment_date: string; amount: bigint; cancelled: boolean };
/** what a payment paid on a bill; a negative row undoes an earlier one */
export type LedgerAllocation = { payment_id: string; bill_id: string; amount: bigint };
export type LedgerAdjustment = { bill_id: string; amount: bigint; adjusted_on: string };

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

export function billDue(bill: LedgerBill, allocations: LedgerAllocation[], adjustments: LedgerAdjustment[]): bigint {
  if (bill.cancelled) return 0n;
  const paid = sum(allocations.filter((a) => a.bill_id === bill.id).map((a) => a.amount));
  const adjusted = sum(adjustments.filter((a) => a.bill_id === bill.id).map((a) => a.amount));
  return bill.total - paid - adjusted;
}

export type BillStatus = "cancelled" | "paid" | "overdue" | "part_paid" | "due";

/** today: YYYY-MM-DD (India). Overdue = something due after the due date. */
export function billStatus(bill: LedgerBill, due: bigint, today: string): BillStatus {
  if (bill.cancelled) return "cancelled";
  if (due <= 0n) return "paid";
  if (bill.due_date && bill.due_date < today) return "overdue";
  return due < bill.total ? "part_paid" : "due";
}

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  cancelled: "Cancelled",
  paid: "Paid",
  overdue: "Overdue",
  part_paid: "Partly paid",
  due: "Due",
};

export function paymentUnused(payment: LedgerPayment, allocations: LedgerAllocation[]): bigint {
  if (payment.cancelled) return 0n;
  return payment.amount - sum(allocations.filter((a) => a.payment_id === payment.id).map((a) => a.amount));
}

/** A customer's (or the plant's) totals. balance > 0 = they owe; < 0 = paid in advance. */
export function ledgerTotals(bills: LedgerBill[], payments: LedgerPayment[], allocations: LedgerAllocation[], adjustments: LedgerAdjustment[]) {
  const open = bills.filter((b) => !b.cancelled);
  const openIds = new Set(open.map((b) => b.id));
  const paidIn = payments.filter((p) => !p.cancelled);
  const billed = sum(open.map((b) => b.total));
  const received = sum(paidIn.map((p) => p.amount));
  const adjusted = sum(adjustments.filter((a) => openIds.has(a.bill_id)).map((a) => a.amount));
  const due = sum(open.map((b) => billDue(b, allocations, adjustments)).filter((d) => d > 0n));
  const advance = sum(paidIn.map((p) => paymentUnused(p, allocations)).filter((u) => u > 0n));
  return { billed, received, adjusted, due, advance, balance: billed - received - adjusted };
}

export type OpenBill = { id: string; number: string; bill_date: string; due: bigint };

const oldestFirst = <T extends { number: string }>(date: (x: T) => string) => (a: T, b: T) =>
  date(a).localeCompare(date(b)) || a.number.localeCompare(b.number, "en", { numeric: true });

/**
 * Sets a payment against bills: the bills ticked (if any), else every open bill, oldest first. What is left over stays
 * on the payment as an advance (unused). Never pays a bill more than its due.
 */
export function allocatePayment(amount: bigint, open: OpenBill[], ticked: string[] = []) {
  const pool = (ticked.length ? open.filter((b) => ticked.includes(b.id)) : open).filter((b) => b.due > 0n).sort(oldestFirst((b) => b.bill_date));
  const allocations: { bill_id: string; amount: bigint }[] = [];
  let left = amount;
  for (const b of pool) {
    if (left <= 0n) break;
    const take = b.due < left ? b.due : left;
    allocations.push({ bill_id: b.id, amount: take });
    left -= take;
  }
  return { allocations, unused: left };
}

export type Advance = { id: string; number: string; payment_date: string; unused: bigint };

/** A new bill uses the customer's advances (oldest payment first) up to its due. */
export function useAdvances(due: bigint, advances: Advance[]) {
  const out: { payment_id: string; amount: bigint }[] = [];
  let left = due;
  for (const p of advances.filter((a) => a.unused > 0n).sort(oldestFirst((a) => a.payment_date))) {
    if (left <= 0n) break;
    const take = p.unused < left ? p.unused : left;
    out.push({ payment_id: p.id, amount: take });
    left -= take;
  }
  return out;
}

export type OrderLedgerStatus = "pending" | "delivered" | "closed" | "cancelled";

/** What an order shows: Closed once delivered and its bill is fully paid. The stored status never changes for this. */
export function orderLedgerStatus(status: "pending" | "delivered" | "cancelled", bill: { cancelled: boolean; due: bigint } | null): OrderLedgerStatus {
  if (status === "delivered" && bill && !bill.cancelled && bill.due <= 0n) return "closed";
  return status;
}

export type StatementRow = {
  date: string;
  kind: "bill" | "payment" | "adjustment";
  number: string;
  /** what the customer owes more (bills) */
  debit: bigint;
  /** what they paid or was settled (payments, adjustments) */
  credit: bigint;
  balance: bigint;
};

const KIND_ORDER = { bill: 0, payment: 1, adjustment: 2 } as const;

/**
 * The customer's statement from `from` to `to` (YYYY-MM-DD, both optional): bills, payments and adjustments in date
 * order with a running balance, starting from what was owed before `from`. Cancelled bills / payments are left out.
 */
export function statement(
  bills: LedgerBill[],
  payments: LedgerPayment[],
  adjustments: LedgerAdjustment[],
  range: { from?: string; to?: string } = {},
) {
  const numberOf = new Map(bills.map((b) => [b.id, b.number]));
  const open = new Set(bills.filter((b) => !b.cancelled).map((b) => b.id));
  const entries: Omit<StatementRow, "balance">[] = [
    ...bills.filter((b) => !b.cancelled).map((b) => ({ date: b.bill_date, kind: "bill" as const, number: b.number, debit: b.total, credit: 0n })),
    ...payments.filter((p) => !p.cancelled).map((p) => ({ date: p.payment_date, kind: "payment" as const, number: p.number, debit: 0n, credit: p.amount })),
    ...adjustments.filter((a) => open.has(a.bill_id)).map((a) => ({ date: a.adjusted_on, kind: "adjustment" as const, number: numberOf.get(a.bill_id) ?? "", debit: 0n, credit: a.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.number.localeCompare(b.number, "en", { numeric: true }));

  let opening = 0n;
  const rows: StatementRow[] = [];
  let balance = 0n;
  for (const e of entries) {
    if (range.from && e.date < range.from) {
      opening += e.debit - e.credit;
      continue;
    }
    if (range.to && e.date > range.to) continue;
    if (!rows.length) balance = opening;
    balance += e.debit - e.credit;
    rows.push({ ...e, balance });
  }
  return { opening, rows, closing: rows.length ? balance : opening };
}

// ---------- bill amounts with GST (docs/BILL_FIELDS_PHASE_PLAN.md, owner 2026-11-07) ----------
//
// Per line: amount = quantity × rate − the line's discount; the bill's discount is shared over the lines by amount
// (before GST), the last line taking the paise left over. Then, on a GST bill:
//   rates exclude GST: taxable = amount, CGST = SGST = taxable × rate / 2 (each rounded), or IGST = taxable × rate
//   rates include GST: taxable = amount ÷ (1 + rate) (rounded), GST = amount − taxable; CGST = taxable × rate / 2
//                      (rounded), SGST = the rest, so taxable + GST is exactly the amount
// Same state as the plant (place of supply = the plant's GSTIN state) → CGST + SGST; another state → IGST.
// Total = sub-total − discount (+ GST when it is added on top) + adjustment. A bill without GST has no tax at all.

export type BillTerms = "receipt" | "net7" | "net15" | "net30" | "eom";
export const BILL_TERMS: BillTerms[] = ["receipt", "net7", "net15", "net30", "eom"];
export const TERMS_LABEL: Record<BillTerms, string> = {
  receipt: "Due on receipt",
  net7: "Net 7",
  net15: "Net 15",
  net30: "Net 30",
  eom: "Due end of the month",
};

/** The due date (YYYY-MM-DD) the terms give for a bill dated `billDate`. */
export function dueFromTerms(billDate: string, terms: BillTerms): string {
  const [y, m, d] = billDate.split("-").map(Number) as [number, number, number];
  const days = { receipt: 0, net7: 7, net15: 15, net30: 30 } as Record<string, number>;
  const date = terms === "eom" ? new Date(Date.UTC(y, m, 0)) : new Date(Date.UTC(y, m - 1, d + days[terms]!));
  return date.toISOString().slice(0, 10);
}

/** n ÷ d rounded half up (n ≥ 0, d > 0). */
const roundDiv = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);

/** GST rate in percent with up to 2 decimals (e.g. 5, 18, 0.25) → hundredths of a percent, so the maths stays whole. */
const rateHundredths = (rate: number) => BigInt(Math.round(rate * 100));

export type BillLineIn = {
  /** quantity × rate, in paise */
  amount: bigint;
  /** the line's own discount, in paise */
  discount: bigint;
  /** GST rate in percent; null = not set on the product (a GST bill refuses it) */
  gst_rate: number | null;
};

export type BillGst = { inclusive: boolean; intra: boolean };

export type BillLineOut = { amount: bigint; taxable: bigint | null; tax: bigint; cgst: bigint; sgst: bigint; igst: bigint };

export type BillAmounts = {
  lines: BillLineOut[];
  sub_total: bigint;
  discount: bigint;
  adjustment: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  tax_total: bigint;
  /** the total before GST (= sub-total − discount when GST is added on top; less when the rates include it) */
  taxable_total: bigint | null;
  total: bigint;
};

export class BillAmountError extends Error {}

/** A bill's amounts from its lines. `gst` null = a bill without GST (statement of account). */
export function billAmounts(lines: BillLineIn[], discount: bigint, adjustment: bigint, gst: BillGst | null): BillAmounts {
  const amounts = lines.map((l, i) => {
    if (l.discount < 0n) throw new BillAmountError("A discount can't be negative.");
    if (l.discount > l.amount) throw new BillAmountError(`Line ${i + 1}: the discount is more than the line.`);
    return l.amount - l.discount;
  });
  const sub = amounts.reduce((a, b) => a + b, 0n);
  if (discount < 0n) throw new BillAmountError("A discount can't be negative.");
  if (discount > sub) throw new BillAmountError("The discount can't be more than the bill.");

  // the bill's discount shared over the lines by amount; the last line with an amount takes what rounding leaves
  const shares = amounts.map((a) => (sub === 0n ? 0n : (discount * a) / sub));
  const lastIdx = amounts.reduce((last, a, i) => (a > 0n ? i : last), -1);
  if (lastIdx >= 0) shares[lastIdx]! += discount - shares.reduce((a, b) => a + b, 0n);

  const out: BillLineOut[] = amounts.map((amount, i) => {
    if (!gst) return { amount, taxable: null, tax: 0n, cgst: 0n, sgst: 0n, igst: 0n };
    const rate = lines[i]!.gst_rate;
    if (rate === null) throw new BillAmountError(`Line ${i + 1}: the product has no GST rate. Set it on PlantOps → Products.`);
    const r = rateHundredths(rate); // 5% = 500
    const net = amount - shares[i]!;
    if (gst.inclusive) {
      const taxable = roundDiv(net * 10000n, 10000n + r);
      const tax = net - taxable;
      if (!gst.intra) return { amount, taxable, tax, cgst: 0n, sgst: 0n, igst: tax };
      const cgst = roundDiv(taxable * r, 20000n);
      return { amount, taxable, tax, cgst, sgst: tax - cgst, igst: 0n };
    }
    if (!gst.intra) {
      const igst = roundDiv(net * r, 10000n);
      return { amount, taxable: net, tax: igst, cgst: 0n, sgst: 0n, igst };
    }
    const half = roundDiv(net * r, 20000n);
    return { amount, taxable: net, tax: 2n * half, cgst: half, sgst: half, igst: 0n };
  });

  const add = (f: (l: BillLineOut) => bigint) => out.reduce((a, l) => a + f(l), 0n);
  const cgst = add((l) => l.cgst);
  const sgst = add((l) => l.sgst);
  const igst = add((l) => l.igst);
  const tax_total = cgst + sgst + igst;
  const total = sub - discount + (gst && !gst.inclusive ? tax_total : 0n) + adjustment;
  if (total < 0n) throw new BillAmountError("The bill total can't be below ₹0.");
  return {
    lines: out,
    sub_total: sub,
    discount,
    adjustment,
    cgst,
    sgst,
    igst,
    tax_total,
    taxable_total: gst ? add((l) => l.taxable ?? 0n) : null,
    total,
  };
}

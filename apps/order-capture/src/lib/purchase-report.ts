// Purchases P3 (docs/PURCHASES_PHASE_PLAN.md): Payables (what is owed to vendors, by age) and Reports → Purchases
// (by item, by vendor, GST paid per month). Pure functions in whole paise; the server reads the rows, nothing is stored.
// Cancelled bills and payments are left out everywhere (their reversing rows cancel each other out).

export type PurchaseLine = {
  bill_id: string;
  bill_date: string;
  vendor: string;
  item: string;
  unit: string | null;
  /** thousandths of a unit (quantity numeric(14, 3)) */
  qty_milli: bigint;
  /** before GST */
  amount: bigint;
  tax: bigint;
};

export type PurchaseBillRow = {
  id: string;
  number: string;
  bill_date: string;
  due_date: string | null;
  vendor_id: string;
  vendor: string;
  sub_total: bigint;
  cgst: bigint;
  sgst: bigint;
  igst: bigint;
  tax: bigint;
  total: bigint;
  /** what payments paid on it (net of reversals) */
  paid: bigint;
};

const add = <T>(m: Map<string, T>, k: string, make: () => T) => {
  let v = m.get(k);
  if (!v) m.set(k, (v = make()));
  return v;
};
const byAmount = <T extends { amount: bigint; label: string }>(a: T, b: T) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.label.localeCompare(b.label));

/** Purchases by Item: quantity per unit (an item bought in kg and in pcs keeps both), bills, amount, GST, average rate. */
export function byItem(lines: PurchaseLine[]) {
  const rows = new Map<string, { label: string; qty: Map<string, bigint>; bills: Set<string>; amount: bigint; tax: bigint; vendors: Set<string>; last: string }>();
  for (const l of lines) {
    const r = add(rows, l.item.toLowerCase(), () => ({ label: l.item, qty: new Map(), bills: new Set(), amount: 0n, tax: 0n, vendors: new Set(), last: l.bill_date }));
    const unit = l.unit ?? "";
    r.qty.set(unit, (r.qty.get(unit) ?? 0n) + l.qty_milli);
    r.bills.add(l.bill_id);
    r.vendors.add(l.vendor);
    r.amount += l.amount;
    r.tax += l.tax;
    if (l.bill_date > r.last) r.last = l.bill_date;
  }
  return [...rows.values()]
    .map((r) => {
      const qty = [...r.qty].map(([unit, milli]) => ({ unit, milli }));
      // average rate only when the item was bought in one unit
      const one = qty.length === 1 && qty[0]!.milli > 0n ? qty[0]! : null;
      return {
        label: r.label,
        qty,
        bills: r.bills.size,
        vendors: [...r.vendors].sort(),
        amount: r.amount,
        tax: r.tax,
        with_gst: r.amount + r.tax,
        avg_rate: one ? (r.amount * 1000n * 2n + one.milli) / (one.milli * 2n) : null,
        last: r.last,
      };
    })
    .sort(byAmount);
}

/** Purchases by Vendor: bills, before GST, GST, total (with rounding), paid, still to pay. */
export function byVendor(bills: PurchaseBillRow[]) {
  const rows = new Map<string, { id: string; label: string; bills: number; amount: bigint; tax: bigint; total: bigint; paid: bigint }>();
  for (const b of bills) {
    const r = add(rows, b.vendor_id, () => ({ id: b.vendor_id, label: b.vendor, bills: 0, amount: 0n, tax: 0n, total: 0n, paid: 0n }));
    r.bills++;
    r.amount += b.sub_total;
    r.tax += b.tax;
    r.total += b.total;
    r.paid += b.paid;
  }
  return [...rows.values()].map((r) => ({ ...r, due: r.total - r.paid })).sort(byAmount);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** GST paid on purchases (input tax) per month of the bill date, to check against GSTR-2B. */
export function gstByMonth(bills: PurchaseBillRow[]) {
  const rows = new Map<string, { key: string; label: string; bills: number; amount: bigint; cgst: bigint; sgst: bigint; igst: bigint; tax: bigint }>();
  for (const b of bills) {
    const ym = b.bill_date.slice(0, 7);
    const r = add(rows, ym, () => ({ key: ym, label: monthLabel(ym), bills: 0, amount: 0n, cgst: 0n, sgst: 0n, igst: 0n, tax: 0n }));
    r.bills++;
    r.amount += b.sub_total;
    r.cgst += b.cgst;
    r.sgst += b.sgst;
    r.igst += b.igst;
    r.tax += b.tax;
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const AGE_BANDS = [
  { key: "not_due", label: "Not due yet" },
  { key: "d1_15", label: "1–15 days" },
  { key: "d16_30", label: "16–30 days" },
  { key: "d31_45", label: "31–45 days" },
  { key: "d45", label: "Over 45 days" },
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]["key"];

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** How late an open bill is on `today`, by its due date (no due date = the bill date). */
export function ageBand(b: { bill_date: string; due_date: string | null }, today: string): { band: AgeBand; days: number } {
  const late = days(b.due_date ?? b.bill_date, today);
  if (late <= 0) return { band: "not_due", days: late };
  return { band: late <= 15 ? "d1_15" : late <= 30 ? "d16_30" : late <= 45 ? "d31_45" : "d45", days: late };
}

/**
 * Payables on `today`: every vendor that is owed (open bills), split by age, less their advances (payments not yet set
 * against a bill). Bills are listed oldest first so the one to pay first is at the top.
 */
export function payables(bills: PurchaseBillRow[], advances: { vendor_id: string; unused: bigint }[], today: string) {
  const vendors = new Map<string, { id: string; label: string; bands: Record<AgeBand, bigint>; owed: bigint; advance: bigint; bills: (PurchaseBillRow & { due: bigint; band: AgeBand; late: number })[] }>();
  const zero = () => Object.fromEntries(AGE_BANDS.map((b) => [b.key, 0n])) as Record<AgeBand, bigint>;
  for (const b of bills) {
    const due = b.total - b.paid;
    if (due <= 0n) continue;
    const v = add(vendors, b.vendor_id, () => ({ id: b.vendor_id, label: b.vendor, bands: zero(), owed: 0n, advance: 0n, bills: [] }));
    const { band, days: late } = ageBand(b, today);
    v.bands[band] += due;
    v.owed += due;
    v.bills.push({ ...b, due, band, late });
  }
  for (const a of advances) {
    const v = vendors.get(a.vendor_id);
    if (v && a.unused > 0n) v.advance += a.unused;
  }
  const list = [...vendors.values()]
    .map((v) => ({ ...v, net: v.owed - v.advance, bills: v.bills.sort((x, y) => (x.due_date ?? x.bill_date).localeCompare(y.due_date ?? y.bill_date)) }))
    .sort((a, b) => (b.owed > a.owed ? 1 : b.owed < a.owed ? -1 : a.label.localeCompare(b.label)));
  const totals = zero();
  for (const v of list) for (const k of AGE_BANDS) totals[k.key] += v.bands[k.key];
  return { vendors: list, totals, owed: list.reduce((s, v) => s + v.owed, 0n), advance: list.reduce((s, v) => s + v.advance, 0n) };
}

/** 12500n milli → "12.5" */
export const qtyText = (milli: bigint) => {
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-IN")}${frac ? `.${frac}` : ""}`;
};

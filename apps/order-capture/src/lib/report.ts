// Sales reports (docs/REPORTS_PHASE_PLAN.md, owner 2026-11-07): Sales by Item and Sales by Customer, with filters, not
// separate reports, for period (month / quarter / financial year / custom), break down by month or quarter,
// salesperson, place, vehicle, group by, and before / with GST. Pure functions over bill lines; the server reads the
// lines (src/server/reports.ts). Money in paise, quantities in thousandths (BigInt), so totals are exact.
//
// Sales = bills (PlantOps + imported Zoho), cancelled and opening-balance bills left out. "Before GST" = the line's
// amount before GST (Zoho's Sales by Item uses the same); "with GST" adds the line's GST.

export const PERIODS = ["this_month", "prev_month", "this_quarter", "prev_quarter", "this_fy", "prev_fy", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = {
  this_month: "This month",
  prev_month: "Previous month",
  this_quarter: "This quarter",
  prev_quarter: "Previous quarter",
  this_fy: "This financial year",
  prev_fy: "Previous financial year",
  custom: "Custom dates",
};

export const BREAKDOWNS = ["none", "month", "quarter"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

export const GROUPS = ["none", "salesperson", "customer", "place", "vehicle", "brand"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = { none: "None", salesperson: "Salesperson", customer: "Customer", place: "Place", vehicle: "Vehicle", brand: "Brand" };

export type ReportKind = "item" | "customer";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Indian financial year quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. The first month of `m`'s quarter. */
const quarterStart = (m: number) => [1, 4, 7, 10][Math.floor((m - 1) / 3)]!;

/** The dates (YYYY-MM-DD, both included) a period means on `today` (an India date). */
export function periodDates(period: Period, today: string, custom: { from?: string; to?: string } = {}): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const shift = (yy: number, mm: number, by: number) => {
    const n = yy * 12 + (mm - 1) + by;
    return [Math.floor(n / 12), (n % 12) + 1] as const;
  };
  const fyStart = m >= 4 ? y : y - 1;
  switch (period) {
    case "this_month":
      return { from: ymd(y, m, 1), to: today };
    case "prev_month": {
      const [py, pm] = shift(y, m, -1);
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
    }
    case "this_quarter":
      return { from: ymd(y, quarterStart(m), 1), to: today };
    case "prev_quarter": {
      const [py, pm] = shift(y, quarterStart(m), -3);
      const [ey, em] = shift(py, pm, 2);
      return { from: ymd(py, pm, 1), to: ymd(ey, em, lastDay(ey, em)) };
    }
    case "this_fy":
      return { from: ymd(fyStart, 4, 1), to: today };
    case "prev_fy":
      return { from: ymd(fyStart - 1, 4, 1), to: ymd(fyStart, 3, 31) };
    case "custom": {
      const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
      const from = ok(custom.from) ? custom.from! : ymd(y, m, 1);
      const to = ok(custom.to) ? custom.to! : today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The column a date falls in: "2026-10" / "Oct 2026", or "2026-Q2" / "Jul–Sep 2026" (Indian FY quarters). */
export function bucketOf(date: string, breakdown: Breakdown): { key: string; label: string } {
  if (breakdown === "none") return { key: "all", label: "Total" };
  const [y, m] = date.split("-").map(Number) as [number, number];
  if (breakdown === "month") return { key: date.slice(0, 7), label: `${MONTHS[m - 1]} ${y}` };
  const qs = quarterStart(m);
  const q = qs === 1 ? 4 : (qs - 1) / 3; // Apr → Q1 … Jan → Q4
  return { key: `${y}-${String(qs).padStart(2, "0")}`, label: `${MONTHS[qs - 1]}–${MONTHS[qs + 1]} ${y} (Q${q})` };
}

/** Every column between two dates, in order (so a month without sales still shows). */
export function bucketsBetween(from: string, to: string, breakdown: Breakdown) {
  if (breakdown === "none") return [{ key: "all", label: "Total" }];
  const out: { key: string; label: string }[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const step = breakdown === "month" ? 1 : 3;
  if (breakdown === "quarter") m = quarterStart(m);
  while (ymd(y, m, 1) <= to) {
    out.push(bucketOf(ymd(y, m, 1), breakdown));
    m += step;
    if (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

/** One bill line as the server reads it. */
export type SalesLine = {
  bill_id: string;
  bill_date: string;
  salesperson: string | null;
  customer_key: string;
  customer_name: string;
  place: string | null;
  vehicle: string | null;
  brand: string | null;
  item_key: string;
  item_name: string;
  sku: string | null;
  /** quantity in thousandths (1.5 = 1500n) */
  qty: bigint;
  /** paise before GST */
  before: bigint;
  /** paise with GST */
  with_gst: bigint;
  /** free boxes (scheme): counted as free quantity, never as sold */
  free?: boolean;
};

export type ReportOptions = {
  kind: ReportKind;
  from: string;
  to: string;
  breakdown: Breakdown;
  group: Group;
  amount: "before" | "with";
  salesperson?: string;
  place?: string;
  vehicle?: string;
};

/** `qty` = sold (paid) quantity; `free_qty` = free boxes given (scheme) */
export type Cell = { bills: number; qty: bigint; free_qty: bigint; amounts: bigint[]; amount: bigint; before: bigint; with_gst: bigint };
export type ReportRow = Cell & { key: string; label: string; sku: string | null };
export type ReportGroup = Cell & { key: string; label: string; rows: ReportRow[] };

export const NOT_MENTIONED = "Not mentioned";
const groupLabel = (g: Group, l: SalesLine): string => {
  switch (g) {
    case "none":
      return "";
    case "salesperson":
      return l.salesperson?.trim() || NOT_MENTIONED;
    case "customer":
      return l.customer_name;
    case "place":
      return l.place?.trim() || "No place (Zoho contact not matched)";
    case "vehicle":
      return l.vehicle?.trim() || "No vehicle";
    case "brand":
      return l.brand?.trim() || "No brand";
  }
};
/** the key that makes two lines the same group (names compared without case: "Anmol " = "anmol") */
const groupKey = (g: Group, l: SalesLine) => (g === "customer" ? l.customer_key : groupLabel(g, l).toLowerCase());

/** The choices for the filter drop-downs: what the period's sales have. */
export function filterChoices(lines: SalesLine[]) {
  const uniq = (xs: (string | null)[]) => {
    const seen = new Map<string, string>(); // the first spelling wins ("Anmol " and "anmol" are one)
    for (const x of xs) if (x?.trim() && !seen.has(x.trim().toLowerCase())) seen.set(x.trim().toLowerCase(), x.trim());
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  };
  return { salespeople: uniq(lines.map((l) => l.salesperson)), places: uniq(lines.map((l) => l.place)), vehicles: uniq(lines.map((l) => l.vehicle)) };
}

const same = (a: string | null, b: string) => (b === NOT_MENTIONED ? !a?.trim() : (a ?? "").trim().toLowerCase() === b.trim().toLowerCase());

/** The report: groups (one when not grouped) of rows (items or customers), each with a total per column. */
export function buildReport(lines: SalesLine[], o: ReportOptions) {
  const buckets = bucketsBetween(o.from, o.to, o.breakdown);
  const col = new Map(buckets.map((b, i) => [b.key, i]));
  const kept = lines.filter(
    (l) =>
      l.bill_date >= o.from &&
      l.bill_date <= o.to &&
      (!o.salesperson || same(l.salesperson, o.salesperson)) &&
      (!o.place || same(l.place, o.place)) &&
      (!o.vehicle || same(l.vehicle, o.vehicle)),
  );
  const group = o.kind === "customer" && o.group === "customer" ? "none" : o.group;
  type Acc = Cell & { billIds: Set<string> };
  const empty = (): Acc => ({ bills: 0, qty: 0n, free_qty: 0n, amounts: buckets.map(() => 0n), amount: 0n, before: 0n, with_gst: 0n, billIds: new Set() });
  const add = (a: Acc, l: SalesLine, i: number) => {
    const v = o.amount === "with" ? l.with_gst : l.before;
    a.billIds.add(l.bill_id);
    if (l.free) a.free_qty += l.qty;
    else a.qty += l.qty;
    a.amounts[i]! += v;
    a.amount += v;
    a.before += l.before;
    a.with_gst += l.with_gst;
  };
  const done = (a: Acc): Cell => ({ bills: a.billIds.size, qty: a.qty, free_qty: a.free_qty, amounts: a.amounts, amount: a.amount, before: a.before, with_gst: a.with_gst });

  const groups = new Map<string, { label: string; acc: Acc; rows: Map<string, { label: string; sku: string | null; acc: Acc }> }>();
  const total = empty();
  for (const l of kept) {
    const i = col.get(bucketOf(l.bill_date, o.breakdown).key);
    if (i === undefined) continue;
    const gk = groupKey(group, l);
    const g = groups.get(gk) ?? { label: groupLabel(group, l), acc: empty(), rows: new Map() };
    groups.set(gk, g);
    const rk = o.kind === "item" ? l.item_key : l.customer_key;
    const r = g.rows.get(rk) ?? { label: o.kind === "item" ? l.item_name : l.customer_name, sku: o.kind === "item" ? l.sku : null, acc: empty() };
    g.rows.set(rk, r);
    add(r.acc, l, i);
    add(g.acc, l, i);
    add(total, l, i);
  }
  const byAmount = (a: { amount: bigint; label: string }, b: { amount: bigint; label: string }) =>
    a.amount === b.amount ? a.label.localeCompare(b.label, "en", { sensitivity: "base" }) : a.amount > b.amount ? -1 : 1;
  const notFirst = (label: string) => (label === NOT_MENTIONED || label.startsWith("No ") ? 0 : 1);
  const out: ReportGroup[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      ...done(g.acc),
      rows: [...g.rows.entries()].map(([k, r]) => ({ key: k, label: r.label, sku: r.sku, ...done(r.acc) })).sort(byAmount),
    }))
    // like Zoho: "Not mentioned" first, then by name
    .sort((a, b) => notFirst(a.label) - notFirst(b.label) || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return { buckets, group, groups: out, total: done(total), choices: filterChoices(lines) };
}
export type SalesReport = ReturnType<typeof buildReport>;

/** 1500n → "1.5", 2197000n → "2,197" */
export function qtyText(q: bigint) {
  const whole = (q / 1000n).toLocaleString("en-IN");
  const frac = q % 1000n;
  return frac === 0n ? whole : `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** "92.000" (numeric(14, 3) from the database) → 92000n */
export function qtyOf(s: string): bigint {
  const [w, f = ""] = s.trim().split(".");
  return BigInt(w || "0") * 1000n + BigInt((f + "000").slice(0, 3));
}

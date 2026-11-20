// Business Overview + charts (docs/REPORTS_PHASE_PLAN.md section 9): the pure rules. The server reads the facts (bills,
// van sales, purchase lines, cash-book expenses, staff-cash spending, van costs, payments, orders); this file puts them
// into periods (month / week / day) and series for the charts. Money in paise (bigint). Nothing is stored.
import { periodDates, PERIODS, type Period } from "./report";

export const CHART_PERIODS = ["last_12", ...PERIODS] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];
export const CHART_PERIOD_LABEL: Record<ChartPeriod, string> = {
  last_12: "Last 12 months",
  this_month: "This month",
  prev_month: "Previous month",
  this_quarter: "This quarter",
  prev_quarter: "Previous quarter",
  this_fy: "This financial year",
  prev_fy: "Previous financial year",
  custom: "Custom dates",
};
export const BYS = ["month", "week", "day"] as const;
export type By = (typeof BYS)[number];
export const BY_LABEL: Record<By, string> = { month: "Month", week: "Week", day: "Day" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => iso(Date.UTC(y, m - 1, d));
export const daysIn = (from: string, to: string) => Math.round((t(to) - t(from)) / DAY) + 1;

/** The dates a chart period means on `today`; "last 12 months" = the 1st of the month 11 months back → today. */
export function chartDates(period: ChartPeriod, today: string, custom: { from?: string; to?: string } = {}) {
  if (period === "last_12") {
    const [y, m] = today.split("-").map(Number) as [number, number];
    return { from: ymd(y, m - 11, 1), to: today };
  }
  return periodDates(period as Period, today, custom);
}

/** Day only up to 62 days and week up to 400 days (else the bars get too thin): the next bigger one. */
export function fitBy(by: By, from: string, to: string): By {
  const n = daysIn(from, to);
  if (by === "day" && n > 62) return n > 400 ? "month" : "week";
  if (by === "week" && n > 400) return "month";
  return by;
}

/** `label` = "Dec 25" (tables, tap text); `axis` = "Dec" (under a chart, where 12 months must fit a phone). */
export type Bucket = { key: string; label: string; axis: string; from: string; to: string };

/** Monday of the week a date falls in. */
const monday = (d: string) => {
  const ms = t(d);
  const wd = (new Date(ms).getUTCDay() + 6) % 7; // Mon 0 … Sun 6
  return iso(ms - wd * DAY);
};
const short = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export function bucketKey(date: string, by: By) {
  return by === "month" ? date.slice(0, 7) : by === "week" ? monday(date) : date;
}

/** Every bucket from `from` to `to` (the first and last cut to the period), in order, empty ones too. */
export function bucketsFor(from: string, to: string, by: By): Bucket[] {
  const out: Bucket[] = [];
  if (by === "month") {
    let [y, m] = from.split("-").map(Number) as [number, number];
    while (ymd(y, m, 1) <= to) {
      const start = ymd(y, m, 1);
      const end = iso(Date.UTC(y, m, 0));
      out.push({ key: start.slice(0, 7), label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, axis: MONTHS[m - 1]!, from: start < from ? from : start, to: end > to ? to : end });
      m += 1;
      if (m > 12) [y, m] = [y + 1, 1];
    }
    return out;
  }
  const step = by === "week" ? 7 : 1;
  for (let ms = t(by === "week" ? monday(from) : from); iso(ms) <= to; ms += step * DAY) {
    const start = iso(ms);
    const end = iso(ms + (step - 1) * DAY);
    out.push({ key: start, label: short(start), axis: by === "day" ? String(Number(start.slice(8))) : short(start), from: start < from ? from : start, to: end > to ? to : end });
  }
  return out;
}

/** The same calendar day a year later (29 Feb → 1 Mar), to lay last year's figures over this year's buckets. */
export const nextYear = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return ymd(y + 1, m, dd);
};
export const lastYear = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return ymd(y - 1, m, dd);
};

// ---------- the facts the server reads ----------

/** One bill (or one van trip's cash sales), before and with GST. */
export type SaleFact = { date: string; before: bigint; with_gst: bigint; brand: string | null; van: boolean; customer_key: string | null; customer_name: string; href: string | null };
export const EXPENSE_GROUPS = ["purchases", "salary", "van", "other"] as const;
export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number];
export const EXPENSE_GROUP_LABEL: Record<ExpenseGroup, string> = { purchases: "Purchases", salary: "Salary", van: "Van (diesel, meal, toll)", other: "Other cash expenses" };
export type ExpenseFact = { date: string; group: ExpenseGroup; type: string; before: bigint; with_gst: bigint };
export type MoneyFact = { date: string; dir: "in" | "out"; amount: bigint };

export type Amount = "before" | "with";
const val = (f: { before: bigint; with_gst: bigint }, a: Amount) => (a === "with" ? f.with_gst : f.before);

/** Adds each fact into its bucket (facts outside the buckets are left out). */
function sumInto<F extends { date: string }>(buckets: Bucket[], by: By, facts: F[], value: (f: F) => bigint, dateOf: (f: F) => string = (f) => f.date) {
  const at = new Map(buckets.map((b, i) => [b.key, i]));
  const first = buckets[0]?.from ?? "";
  const last = buckets[buckets.length - 1]?.to ?? "";
  const out = buckets.map(() => 0n);
  for (const f of facts) {
    const d = dateOf(f);
    if (d < first || d > last) continue;
    const i = at.get(bucketKey(d, by));
    if (i !== undefined) out[i]! += value(f);
  }
  return out;
}

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
export const VAN_SALES = "Van sales";
export const NO_BRAND = "No brand";
export const OTHER_BRANDS = "Other brands";

export type Series = { name: string; values: bigint[] };
export type TopRow = { label: string; amount: bigint; href?: string | null; group?: ExpenseGroup };

/** `recordsFrom` = the first month with real sales records (YYYY-MM-01; the server: first month with 10+ bills). */
export type ChartOptions = { from: string; to: string; by: By; brand: string; amount: Amount; recordsFrom?: string | null };

/** Every chart of the Business charts page. `owed` = what customers owed at each bucket's end (the server works it out). */
export function buildCharts(
  d: { sales: SaleFact[]; lastYearSales: SaleFact[]; expenses: ExpenseFact[]; money: MoneyFact[]; orderDates: string[] },
  o: ChartOptions,
  owed: bigint[],
) {
  const buckets = bucketsFor(o.from, o.to, o.by);
  const brandOk = (s: SaleFact) => !o.brand || (!s.van && (s.brand ?? "") === o.brand);
  const sales = d.sales.filter(brandOk);
  const salesTotal = sumInto(buckets, o.by, sales, (s) => val(s, o.amount));
  const ly = d.lastYearSales.filter(brandOk);
  const lastYearTotal = sumInto(buckets, o.by, ly, (s) => val(s, o.amount), (s) => nextYear(s.date));
  // last year only when the plant has records for all of it: a few stray old bills would make "+400 %"
  const hasLastYear = ly.length > 0 && !!o.recordsFrom && lastYear(o.from) >= o.recordsFrom;

  // by brand: the four biggest brands of the period (colour follows the brand, never the month), the rest "Other brands",
  // then bills without a brand and the van's cash sales
  const inPeriod = <F extends { date: string }>(f: F) => f.date >= o.from && f.date <= o.to;
  const brandTotal = new Map<string, bigint>();
  for (const s of d.sales) if (inPeriod(s) && !s.van && s.brand) brandTotal.set(s.brand, (brandTotal.get(s.brand) ?? 0n) + val(s, o.amount));
  const top = [...brandTotal.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0]))).slice(0, 4).map(([b]) => b);
  const nameOf = (s: SaleFact) => (s.van ? VAN_SALES : !s.brand ? NO_BRAND : top.includes(s.brand) ? s.brand : OTHER_BRANDS);
  const brandNames = [...top, OTHER_BRANDS, NO_BRAND, VAN_SALES];
  const byBrand: Series[] = brandNames
    .map((name) => ({ name, values: sumInto(buckets, o.by, d.sales.filter((s) => nameOf(s) === name), (s) => val(s, o.amount)) }))
    .filter((s) => s.values.some((v) => v > 0n));

  const expenseGroups: Series[] = EXPENSE_GROUPS.map((g) => ({
    name: EXPENSE_GROUP_LABEL[g],
    values: sumInto(buckets, o.by, d.expenses.filter((e) => e.group === g), (e) => val(e, o.amount)),
  })).filter((s) => s.values.some((v) => v > 0n));
  const expenseTotal = buckets.map((_, i) => sum(expenseGroups.map((s) => s.values[i]!)));

  const moneyIn = sumInto(buckets, o.by, d.money.filter((m) => m.dir === "in"), (m) => m.amount);
  const moneyOut = sumInto(buckets, o.by, d.money.filter((m) => m.dir === "out"), (m) => m.amount);

  return {
    buckets,
    recordsFrom: o.recordsFrom ?? null,
    sales: { total: salesTotal, lastYear: hasLastYear ? lastYearTotal : null, byBrand, brands: [...brandTotal.keys()].sort() },
    expenses: { groups: expenseGroups, total: expenseTotal, types: topTypes(d.expenses.filter(inPeriod), o.amount) },
    money: { in: moneyIn, out: moneyOut, running: running(moneyIn, moneyOut) },
    owed,
    weekdays: weekdayAverages(d.orderDates, o.from, o.to),
    topCustomers: topCustomers(sales.filter(inPeriod), o.amount),
    totals: { sales: sum(salesTotal), lastYear: hasLastYear ? sum(lastYearTotal) : null, expenses: sum(expenseTotal), moneyIn: sum(moneyIn), moneyOut: sum(moneyOut) },
  };
}
export type BusinessCharts = ReturnType<typeof buildCharts>;

/** Money in − money out, added up from the first bucket (starts at 0: not a bank balance). */
export function running(inn: bigint[], out: bigint[]) {
  let r = 0n;
  return inn.map((x, i) => (r += x - out[i]!));
}

/** Expense types, biggest first; purchases by item ("Purchases: Preform"), van costs, cash-book expense types. */
export function topTypes(expenses: ExpenseFact[], amount: Amount, limit = 10): TopRow[] {
  const m = new Map<string, TopRow>();
  for (const e of expenses) {
    const r = m.get(e.type) ?? { label: e.type, amount: 0n, group: e.group };
    m.set(e.type, r);
    r.amount += val(e, amount);
  }
  const rows = [...m.values()].filter((r) => r.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.label.localeCompare(b.label)));
  if (rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1);
  return [...rows.slice(0, limit - 1), { label: `${rest.length} other types`, amount: sum(rest.map((r) => r.amount)) }];
}

/** The 10 customers who bought the most (bills only; van cash sales have no customer). */
export function topCustomers(sales: SaleFact[], amount: Amount, limit = 10) {
  const m = new Map<string, TopRow>();
  let all = 0n;
  for (const s of sales) {
    all += val(s, amount);
    if (!s.customer_key) continue;
    const r = m.get(s.customer_key) ?? { label: s.customer_name, amount: 0n, href: s.href };
    m.set(s.customer_key, r);
    r.amount += val(s, amount);
  }
  const rows = [...m.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.label.localeCompare(b.label))).slice(0, limit);
  const share = all > 0n ? Number((sum(rows.map((r) => r.amount)) * 1000n) / all) / 10 : 0;
  return { rows, share };
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Orders entered per weekday, divided by how many of that weekday the period has (an average a day, one decimal). */
export function weekdayAverages(orderDates: string[], from: string, to: string) {
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (let ms = t(from); ms <= t(to); ms += DAY) days[(new Date(ms).getUTCDay() + 6) % 7]! += 1;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of orderDates) if (d >= from && d <= to) counts[(new Date(t(d)).getUTCDay() + 6) % 7]! += 1;
  return WEEKDAYS.map((label, i) => ({ label, orders: counts[i]!, avg: days[i] ? Math.round((counts[i]! / days[i]!) * 10) / 10 : 0 }));
}

// ---------- the Business Overview page ----------

export type Basis = "bill" | "payment";

/** Business Overview: per month income and expense (by bill or by payment), cash flow and top expenses. */
export function buildOverview(d: { sales: SaleFact[]; expenses: ExpenseFact[]; money: MoneyFact[] }, o: { from: string; to: string; basis: Basis; by?: "month" | "day" }) {
  // one month picked = day by day (owner, 2026-11-20); otherwise a bar per month
  const by = o.by ?? "month";
  const buckets = bucketsFor(o.from, o.to, by);
  const moneyIn = sumInto(buckets, by, d.money.filter((m) => m.dir === "in"), (m) => m.amount);
  const moneyOut = sumInto(buckets, by, d.money.filter((m) => m.dir === "out"), (m) => m.amount);
  const income = o.basis === "payment" ? moneyIn : sumInto(buckets, by, d.sales, (s) => s.before);
  const expense = o.basis === "payment" ? moneyOut : sumInto(buckets, by, d.expenses, (e) => e.before);
  const run = running(moneyIn, moneyOut);
  return {
    buckets,
    income,
    expense,
    totals: { income: sum(income), expense: sum(expense) },
    cash: { in: moneyIn, out: moneyOut, running: run, start: 0n, totalIn: sum(moneyIn), totalOut: sum(moneyOut), end: run[run.length - 1] ?? 0n },
    types: topTypes(d.expenses.filter((e) => e.date >= o.from && e.date <= o.to), "before", 6),
  };
}
export type BusinessOverview = ReturnType<typeof buildOverview>;

// ---------- the scale every chart uses ----------

/** A round top for the axis and its 4 steps (in rupees, a number): 4,32,000 → 5,00,000 in steps of 1,25,000. */
export function niceScale(max: number) {
  if (!(max > 0)) return { max: 4, step: 1 };
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const step = ([1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].find((s) => n <= s) ?? 10) * p;
  return { max: step * 4, step };
}

/** Short axis / bar text: ₹4.3 L, ₹1.2 Cr, ₹85k, ₹950. */
export function shortRupees(r: number) {
  const a = Math.abs(r);
  const s = r < 0 ? "−" : "";
  const trim = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(x >= 10 ? 0 : 1).replace(/\.0$/, ""));
  if (a >= 1e7) return `${s}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${s}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${s}₹${trim(a / 1e3)}k`;
  return `${s}₹${Math.round(a)}`;
}

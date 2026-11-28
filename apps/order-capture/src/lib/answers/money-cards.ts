// Plant answers Phase 2 (docs/MORNING_REPORT_PHASE_PLAN.md): the money cards M1, M3, M4, M5, M6. Pure: each takes the
// rows its report already reads and uses that report's own rules (nothing is calculated a second way), so a card and its
// report always agree. Money in paise (bigint).
import { BIG_EXPENSE, KIND_LABEL, PURPOSE_LABEL, type CashKind, type StaffPurpose } from "../cash";
import { NO_BRAND, VAN_SALES, type SaleFact } from "../business";
import { customerInsights, type InsightBill, type InsightSettle } from "../customer-insights";
import { customerBalances, daysBetween, dmy, openBillsAsOf, type RecData } from "../receivables";
import { M1_TOP } from "./cards";
import type { Facts, Row } from "./facts";

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** whole percent change; null when there is nothing to compare with */
export const pctChange = (now: bigint, before: bigint) => (before > 0n ? Math.round((Number(now - before) / Number(before)) * 100) : null);
const sumOf = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const desc = (a: bigint, b: bigint) => (b > a ? 1 : b < a ? -1 : 0);

// ---------- M1: who owes the most, and who is paying slower ----------

/** A customer's bills for the paying rules (cancelled ones included, as on the customer page). */
export type PayBill = InsightBill & { customer_key: string };

export function m1Facts(d: RecData, phones: Map<string, string>, pay: { bills: PayBill[]; settles: InsightSettle[] }, today: string): Facts {
  const table = customerBalances(d, { from: today, to: today, filter: {}, group: "none", show: "owe" });
  const rows = table.groups.flatMap((g) => g.rows);
  const placeOf = new Map<string, string | null>();
  for (const x of [...d.bills, ...d.payments]) if (!placeOf.has(x.customer_key) || x.place) placeOf.set(x.customer_key, x.place?.trim() || null);
  // the oldest bill with something still due, counted from its bill date (as "oldest unpaid" on the customer page)
  const oldest = new Map<string, number>();
  for (const b of openBillsAsOf(d, today, "bill", 15, {})) oldest.set(b.customer_key, Math.max(oldest.get(b.customer_key) ?? 0, b.age));

  // the customer page's paying rules, customer by customer
  const billsOf = new Map<string, PayBill[]>();
  for (const b of pay.bills) billsOf.set(b.customer_key, [...(billsOf.get(b.customer_key) ?? []), b]);
  const settlesOf = new Map<string, InsightSettle[]>();
  for (const s of pay.settles) settlesOf.set(s.bill_id, [...(settlesOf.get(s.bill_id) ?? []), s]);
  const paying = new Map<string, { usual: number | null; slower: { recent: number; usual: number } | null }>();
  for (const [key, bills] of billsOf) {
    const ins = customerInsights({ bills, settles: bills.flatMap((b) => settlesOf.get(b.id) ?? []), billLines: new Map(), unbilledOrders: [], today });
    paying.set(key, {
      usual: ins.paying?.avg_days ?? null,
      slower: ins.trend?.kind === "slower" ? { recent: ins.trend.recent_days, usual: ins.trend.usual_days } : null,
    });
  }
  const dueOf = new Map(rows.map((r) => [r.key, r.cells[3] as bigint]));
  const top: Row[] = rows.slice(0, M1_TOP).map((r) => ({
    key: r.key,
    href: r.href,
    customer: r.label,
    place: placeOf.get(r.key) ?? null,
    due: r.cells[3] as bigint,
    oldest_days: oldest.get(r.key) ?? null,
    usual_days: paying.get(r.key)?.usual ?? null,
    slower_days: paying.get(r.key)?.slower?.recent ?? null,
    phone: phones.get(r.key) ?? null,
  }));
  const nameOf = new Map<string, { name: string; href: string }>();
  for (const x of [...d.bills, ...d.payments]) nameOf.set(x.customer_key, { name: x.customer_name, href: x.href });
  const slower: Row[] = [...paying.entries()]
    .filter(([key, p]) => p.slower && nameOf.has(key))
    .map(([key, p]) => ({ key, href: nameOf.get(key)!.href, customer: nameOf.get(key)!.name, place: placeOf.get(key) ?? null, recent_days: p.slower!.recent, usual_days: p.slower!.usual, due: dueOf.get(key) ?? 0n }))
    .sort((a, b) => Number(b.recent_days) - Number(b.usual_days) - (Number(a.recent_days) - Number(a.usual_days)) || String(a.customer).localeCompare(String(b.customer)));
  return {
    totals: { owed: sumOf(rows.map((r) => r.cells[3] as bigint)), customers: rows.length, slower: slower.length },
    rows: top,
    lists: { slower },
  };
}

// ---------- M3: money in this week ----------

export type M3Payment = { date: string; mode: string; customer: string; amount: bigint };

/** Monday of the week `d` is in (India dates). */
export const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

export function m3Facts(o: { payments: M3Payment[]; vans: { date: string; cash: bigint }[]; toPost: { count: number; amount: bigint }; today: string }): Facts {
  const from = mondayOf(o.today);
  const lastFrom = addDays(from, -7);
  const lastTo = addDays(o.today, -7);
  const inWeek = (x: { date: string }) => x.date >= from && x.date <= o.today;
  const inLast = (x: { date: string }) => x.date >= lastFrom && x.date <= lastTo;
  const pays = o.payments.filter(inWeek);
  const cashPays = pays.filter((p) => p.mode === "cash");
  const onlinePays = pays.filter((p) => p.mode !== "cash");
  const vans = o.vans.filter((v) => inWeek(v) && v.cash > 0n);
  const cash = sumOf(cashPays.map((p) => p.amount));
  const online = sumOf(onlinePays.map((p) => p.amount));
  const van = sumOf(vans.map((v) => v.cash));
  const total = cash + online + van;
  const dayIn = (d: string) => sumOf(o.payments.filter((p) => p.date === d).map((p) => p.amount)) + sumOf(o.vans.filter((v) => v.date === d).map((v) => v.cash));
  const lastWeek = sumOf(o.payments.filter(inLast).map((p) => p.amount)) + sumOf(o.vans.filter(inLast).map((v) => v.cash));
  const days: Row[] = [];
  for (let d = from; d <= o.today; d = addDays(d, 1)) days.push({ day: d === o.today ? `${WD[weekday(d)]} (so far)` : WD[weekday(d)]!, this_week: dayIn(d), last_week: dayIn(addDays(d, -7)) });
  const range = `${dmy(from)} to ${dmy(o.today)}`;
  return {
    totals: {
      total,
      cash,
      van,
      online,
      last_week: lastWeek,
      change_pct: pctChange(total, lastWeek),
      payments: pays.length,
      cash_payments: cashPays.length,
      online_payments: onlinePays.length,
      van_reports: vans.length,
      to_post: o.toPost.amount,
      to_post_count: o.toPost.count,
    },
    rows: [],
    lists: {
      days,
      biggest: [...pays].sort((a, b) => desc(a.amount, b.amount)).slice(0, 5).map((p) => ({ customer: p.customer, date: p.date, mode: p.mode, amount: p.amount })),
    },
    notes: {
      total: `Customer payments + van cash sales, ${range}. Cancelled payments are left out. The same as Business Overview's money in for these days.`,
      cash: `Customer payments marked Cash (${cashPays.length}). Van cash sales are on their own line.`,
      online: `Customer payments marked UPI, bank, cheque or other (${onlinePays.length}).`,
      van: `Cash the vans took on their trips (${vans.length} van report${vans.length === 1 ? "" : "s"}: sales − not paid).`,
      last_week: `${dmy(lastFrom)} to ${dmy(lastTo)}, same rule.`,
      to_post: `${o.toPost.count} collection line${o.toPost.count === 1 ? "" : "s"} waiting in Cash → To post. Not in the total: they count as payments once posted, so nothing is counted twice.`,
    },
  };
}

// ---------- M4: why is cash short ----------

export type M4Close = { cash_date: string; counted: bigint; expected: bigint; difference: bigint; reason: string | null; by: string; at: string; opening: boolean };
export type M4Entry = {
  ref: string;
  cash_date: string;
  work_date: string;
  kind: CashKind;
  direction: "in" | "out";
  amount: bigint;
  category: string | null;
  vehicle: string | null;
  person: string | null;
  purpose: StaffPurpose | null;
  by: string;
  at: string;
  cancelled_at: string | null;
  /** a van report's short (−) / extra (+) */
  van_difference: bigint | null;
};

const what = (e: M4Entry) => {
  const base = e.kind === "expense" ? (e.category ?? "Expense") : KIND_LABEL[e.kind];
  const who = e.kind === "van" ? e.vehicle : e.kind === "staff_out" || e.kind === "staff_in" ? e.person : null;
  const purpose = e.purpose ? ` (${PURPOSE_LABEL[e.purpose].toLowerCase()})` : "";
  return `${base}${who ? `, ${who}` : ""}${purpose}`;
};

/** closes = the latest version of each day's close, any order. */
export function m4Facts(closes: M4Close[], entries: M4Entry[], today: string): Facts {
  const sorted = [...closes].sort((a, b) => a.cash_date.localeCompare(b.cash_date));
  const last = sorted.at(-1);
  if (!last) return { totals: { state: "Cash book not started" }, rows: [] };
  const daysOpen = Math.max(0, daysBetween(last.cash_date, today) - 1);
  const state = last.difference < 0n ? "Short" : last.difference > 0n ? "Extra" : "Matched";
  const totals: Row = {
    state,
    close_date: last.cash_date,
    difference: last.difference,
    expected: last.expected,
    counted: last.counted,
    reason: last.reason,
    days_open: daysOpen,
  };
  const prev = sorted.at(-2);
  const notes: Record<string, string> = {
    counted: `Counted by ${last.by} at the close of ${dmy(last.cash_date)}.`,
    ...(prev ? { expected: `The count of ${dmy(prev.cash_date)} + cash in − cash out of the entries from then up to ${dmy(last.cash_date)}.` } : {}),
  };
  if (last.difference === 0n || !prev) return { totals, rows: [], notes };
  const closedAt = last.at;
  const rows: Row[] = entries
    .filter((e) => e.cash_date > prev.cash_date && e.cash_date <= last.cash_date && (!e.cancelled_at || e.cancelled_at > closedAt))
    .map((e) => {
      const marks: string[] = [];
      if (e.cancelled_at) marks.push("Cancelled after the close");
      if (e.van_difference !== null && e.van_difference < 0n) marks.push(`Van short`);
      if (e.direction === "out" && e.amount >= BIG_EXPENSE) marks.push("₹2,000 or more");
      if (e.kind === "staff_out") marks.push("Staff cash");
      if (e.work_date < e.cash_date) marks.push(`For an earlier day (${dmy(e.work_date)})`);
      return { ref: e.ref, what: what(e), direction: e.direction === "in" ? "In" : "Out", amount: e.amount, by: e.by, marks: marks.join(" · ") || null, cancelled: e.cancelled_at ? "yes" : null };
    })
    .sort((a, b) => desc(a.amount as bigint, b.amount as bigint));
  return { totals, rows, notes };
}

// ---------- M5: sales up or down this month ----------

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};
const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
};
const minusYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4) === "-02-29" ? "-02-28" : d.slice(4)}`;

/** The days compared (P2-f): this month so far against the same days of last month; on the 1st–3rd, last month against the one before. */
export function m5Periods(today: string) {
  const ym = today.slice(0, 7);
  if (Number(today.slice(8)) <= 3) {
    const a = prevMonth(ym);
    const b = prevMonth(a);
    return { now: { from: `${a}-01`, to: monthEnd(a) }, before: { from: `${b}-01`, to: monthEnd(b) }, fullMonth: true };
  }
  const b = prevMonth(ym);
  const end = `${b}-${today.slice(8)}`;
  return { now: { from: `${ym}-01`, to: today }, before: { from: `${b}-01`, to: end > monthEnd(b) ? monthEnd(b) : end }, fullMonth: false };
}

export function m5Facts(sales: SaleFact[], today: string, recordsFrom: string | null): Facts {
  const p = m5Periods(today);
  const ly = { from: minusYear(p.now.from), to: minusYear(p.now.to) };
  const inP = (r: { from: string; to: string }) => (s: SaleFact) => s.date >= r.from && s.date <= r.to;
  const nowS = sales.filter(inP(p.now));
  const beforeS = sales.filter(inP(p.before));
  const now = sumOf(nowS.map((s) => s.before));
  const before = sumOf(beforeS.map((s) => s.before));
  const hasLy = !!recordsFrom && ly.from >= recordsFrom;
  const lastYear = hasLy ? sumOf(sales.filter(inP(ly)).map((s) => s.before)) : null;

  const brandOf = (s: SaleFact) => (s.van ? VAN_SALES : (s.brand ?? NO_BRAND));
  const brands = new Map<string, { now: bigint; before: bigint }>();
  for (const [list, k] of [[nowS, "now"], [beforeS, "before"]] as const)
    for (const s of list) {
      const b = brands.get(brandOf(s)) ?? { now: 0n, before: 0n };
      b[k] += s.before;
      brands.set(brandOf(s), b);
    }
  const custs = new Map<string, { name: string; href: string | null; now: bigint; before: bigint }>();
  for (const [list, k] of [[nowS, "now"], [beforeS, "before"]] as const)
    for (const s of list) {
      if (s.van || !s.customer_key) continue;
      const c = custs.get(s.customer_key) ?? { name: s.customer_name, href: s.href, now: 0n, before: 0n };
      c[k] += s.before;
      custs.set(s.customer_key, c);
    }
  const moves = [...custs.entries()].map(([key, c]) => ({ key, href: c.href, customer: c.name, now: c.now, change: c.now - c.before }));
  const label = p.fullMonth ? "Last month" : "This month so far";
  return {
    totals: {
      now,
      before,
      change_pct: pctChange(now, before),
      from: p.now.from,
      to: p.now.to,
      last_year: lastYear,
      last_year_pct: lastYear !== null ? pctChange(now, lastYear) : null,
    },
    rows: [],
    lists: {
      brands: [...brands.entries()]
        .sort(([a, x], [b, y]) => (a === VAN_SALES ? 1 : b === VAN_SALES ? -1 : desc(x.now, y.now)))
        .map(([brand, b]) => ({ brand, now: b.now, before: b.before, change_pct: pctChange(b.now, b.before) })),
      grew: moves.filter((m) => m.change > 0n).sort((a, b) => desc(a.change, b.change)).slice(0, 5),
      dropped: moves.filter((m) => m.change < 0n).sort((a, b) => desc(b.change, a.change)).slice(0, 5),
    },
    notes: {
      now: `${label}: ${dmy(p.now.from)} to ${dmy(p.now.to)}. Bills + van cash sales, before GST; cancelled bills and opening balances left out. The same as Business charts for these dates.`,
      before: `${dmy(p.before.from)} to ${dmy(p.before.to)}, same rule.${p.fullMonth ? " (Early in the month the whole of last month is compared, so a few days don't give big percentages.)" : ""}`,
      last_year: hasLy ? `${dmy(ly.from)} to ${dmy(ly.to)}, same rule.` : "Not shown: PlantOps has no full records for those days last year, so a comparison would be wrong.",
    },
  };
}

// ---------- M6: cash in the box now, sold today ----------

export type M6Cash =
  | { started: false }
  | {
      started: true;
      /** today's close, if counted */
      today: { counted: bigint; by: string; at: string; expected: bigint } | null;
      /** the close before (or of) today: what "expected" starts from */
      last: { date: string; counted: bigint; by: string; at: string } | null;
      expected: bigint | null;
      in: bigint;
      out: bigint;
    };

const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

export function m6Facts(cash: M6Cash, sales: { today: bigint; weekAgo: bigint; bills: number; vans: number; notBilled: number }, today: string): Facts {
  const weekAgo = addDays(today, -7);
  const totals: Row = {
    sold: sales.today,
    bills: sales.bills,
    vans: sales.vans,
    week_ago: sales.weekAgo,
    change: sales.today - sales.weekAgo,
    not_billed: sales.notBilled,
  };
  const notes: Record<string, string> = {
    sold: `${sales.bills} bill${sales.bills === 1 ? "" : "s"} + ${sales.vans} van report${sales.vans === 1 ? "" : "s"} today, with GST. Cancelled bills and opening balances are left out. Orders not billed yet are not in it.`,
    week_ago: `${WD[weekday(weekAgo)]} ${dmy(weekAgo)}, the whole day, same rule.`,
  };
  if (!cash.started) return { totals: { ...totals, cash_state: "Cash book not started" }, rows: [], notes };
  if (cash.today) {
    Object.assign(totals, { cash: cash.today.counted, cash_state: "Counted" });
    const d = cash.today.counted - cash.today.expected;
    notes.cash = `Counted at ${time(cash.today.at)} today by ${cash.today.by}. Expected was ${d === 0n ? "the same" : `different: ${d < 0n ? "short" : "extra"} (see M4)`}.`;
  } else {
    Object.assign(totals, { cash: cash.expected, cash_state: "Expected", last_count: cash.last?.counted ?? null, cash_in: cash.in, cash_out: cash.out });
    notes.cash = "What should be in the box now: the last count + cash in − cash out since. Not counted yet today, so it is not what is there. It becomes \"Counted\" when today is closed.";
    if (cash.last) notes.last_count = `Counted at the close of ${dmy(cash.last.date)}, ${time(cash.last.at)}, by ${cash.last.by}.`;
  }
  return { totals, rows: [], notes };
}

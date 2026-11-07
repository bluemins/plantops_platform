// "Buying & paying" on a customer's page (owner, 2026-11-07; v0.47.0): how fast they pay, how often they order, when the
// next order is expected, what they usually buy, what they stopped buying, and their bills per month of the financial
// year. Pure functions, worked out every time the page opens; nothing is stored.
//
// Facts used (all already in Sales): bills (Zoho history + PlantOps), what settled each bill and on which date
// (payment allocations + adjustments), bill lines, and orders not billed yet. Cancelled bills, Zoho opening balances
// (OB-…) and ₹0 bills are left out everywhere.
//
//   paid on            = the date the bill's allocations + adjustments first reach its total (and stay there)
//   days to pay        = paid on − bill date (never below 0: paid from an advance = 0)
//   a purchase         = a day with a bill, or with an order not billed yet (two on the same day = one purchase)
//   usual gap          = the middle value of the gaps between the last 13 purchases (needs 3 purchases)
//   next order         = last purchase + usual gap; "late" once more than max(2 days, 30 % of the gap) past it
//   usual basket       = products in at least half of the last 5 purchases, with their middle quantity
//   stopped buying     = in at least 3 (and 40 %) of the 10 purchases before the last 3, and in none of the last 3
//   financial year     = 1 April to 31 March (FY 2026-27 = start year 2026)

const DAY = 86_400_000;
const toMs = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);
export const addDays = (ymd: string, n: number) => new Date(toMs(ymd) + n * DAY).toISOString().slice(0, 10);

export type InsightBill = {
  id: string;
  bill_date: string;
  due_date: string | null;
  /** paise */
  total: bigint;
  cancelled: boolean;
  /** a Zoho opening balance (OB-…) */
  opening: boolean;
};
/** a payment allocation or an adjustment on a bill: what was settled, and when (a negative row undoes an earlier one) */
export type InsightSettle = { bill_id: string; amount: bigint; on: string };
/** a product on a bill or an unbilled order; key = the PlantOps product id, else the item name in lower case */
export type InsightLine = { key: string; name: string; unit: string | null; quantity: number };
export type InsightPurchase = { date: string; lines: InsightLine[] };

export type InsightsInput = {
  bills: InsightBill[];
  settles: InsightSettle[];
  /** lines per bill id */
  billLines: Map<string, InsightLine[]>;
  /** orders that are not cancelled and have no (live) bill yet, by their India date */
  unbilledOrders: InsightPurchase[];
  today: string;
  /** start year of the financial year to chart; default the current one */
  fy?: number;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** the value most of them are at or under (nearest-rank 80th percentile) */
const p80 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.8 * s.length) - 1)]!;
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The financial year (start year) a date falls in: April onwards = this year. */
export const fyOf = (ymd: string) => (Number(ymd.slice(5, 7)) >= 4 ? Number(ymd.slice(0, 4)) : Number(ymd.slice(0, 4)) - 1);
export const fyLabel = (start: number) => `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
export const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"] as const;
/** 0 = April … 11 = March */
const fyMonth = (ymd: string) => (Number(ymd.slice(5, 7)) + 8) % 12;

/** When a bill was fully settled, or null while something is still due. */
export function paidOn(bill: InsightBill, settles: InsightSettle[]): string | null {
  const mine = settles.filter((s) => s.bill_id === bill.id).sort((a, b) => a.on.localeCompare(b.on));
  let run = 0n;
  let at: string | null = null;
  for (const s of mine) {
    run += s.amount;
    if (run >= bill.total) at ??= s.on;
    else at = null; // undone: not paid until it reaches the total again
  }
  return at;
}

export function customerInsights(input: InsightsInput) {
  const { today } = input;
  const real = input.bills.filter((b) => !b.cancelled && !b.opening && b.total > 0n);
  const yearAgo = addDays(today, -365);

  // ---------- paying ----------
  const settled = real.map((b) => {
    const on = paidOn(b, input.settles);
    return { b, on, days: on ? Math.max(0, daysBetween(b.bill_date, on)) : null };
  });
  const paidAll = settled.filter((x) => x.days !== null) as { b: InsightBill; on: string; days: number }[];
  const paid12 = paidAll.filter((x) => x.b.bill_date > yearAgo);
  const payBase = paid12.length >= 3 ? paid12 : paidAll;
  const late = payBase.filter((x) => x.b.due_date && x.on > x.b.due_date).length;
  // the oldest bill with something still due (opening balances too: that money is owed)
  const unpaid = input.bills
    .filter((b) => !b.cancelled && b.total > 0n && !paidOn(b, input.settles))
    .sort((a, b) => a.bill_date.localeCompare(b.bill_date));
  const paying = payBase.length
    ? {
        bills: payBase.length,
        all_time: payBase !== paid12,
        avg_days: Math.round(avg(payBase.map((x) => x.days))),
        within_days: p80(payBase.map((x) => x.days)),
        late,
        with_due_date: payBase.filter((x) => x.b.due_date).length,
      }
    : null;
  const oldestUnpaid = unpaid[0] ? { bill_date: unpaid[0].bill_date, days: daysBetween(unpaid[0].bill_date, today) } : null;

  // slower / faster lately: the last 3 bills that are paid, or unpaid for longer than usual, against the others
  let trend: { kind: "slower" | "faster"; recent_days: number; usual_days: number } | null = null;
  const base12 = settled.filter((x) => x.b.bill_date > yearAgo).sort((a, b) => b.b.bill_date.localeCompare(a.b.bill_date));
  if (paid12.length >= 3) {
    const usualAll = avg(paid12.map((x) => x.days));
    const known = base12
      .map((x) => (x.days !== null ? x.days : daysBetween(x.b.bill_date, today) > usualAll ? daysBetween(x.b.bill_date, today) : null))
      .filter((d): d is number => d !== null);
    const recent = known.slice(0, 3);
    const rest = known.slice(3);
    if (recent.length === 3 && rest.length >= 3) {
      const r = avg(recent);
      const u = avg(rest);
      if (r >= u + 7 && r >= 1.5 * u) trend = { kind: "slower", recent_days: Math.round(r), usual_days: Math.round(u) };
      else if (r <= u - 7 && r <= 0.67 * u) trend = { kind: "faster", recent_days: Math.round(r), usual_days: Math.round(u) };
    }
  }

  // ---------- ordering ----------
  const byDay = new Map<string, InsightLine[]>();
  for (const b of real) byDay.set(b.bill_date, [...(byDay.get(b.bill_date) ?? []), ...(input.billLines.get(b.id) ?? [])]);
  for (const o of input.unbilledOrders) byDay.set(o.date, [...(byDay.get(o.date) ?? []), ...o.lines]);
  const purchases = [...byDay.entries()].map(([date, lines]) => ({ date, lines })).sort((a, b) => a.date.localeCompare(b.date));
  const last = purchases.at(-1) ?? null;
  const recentDays = purchases.slice(-13).map((p) => p.date);
  const gaps = recentDays.slice(1).map((d, i) => daysBetween(recentDays[i]!, d));
  const gap = gaps.length >= 2 ? Math.max(1, Math.round(median(gaps)!)) : null;

  let next: { expected: string; state: "ahead" | "due" | "late" | "stopped"; days_late: number } | null = null;
  if (gap && last) {
    const expected = addDays(last.date, gap);
    const past = daysBetween(expected, today);
    const slack = Math.max(2, Math.round(gap * 0.3));
    const sinceLast = daysBetween(last.date, today);
    const state = past < 0 ? "ahead" : past <= slack ? "due" : sinceLast > Math.max(60, 3 * gap) ? "stopped" : "late";
    next = { expected, state, days_late: Math.max(0, past) };
  }

  // a product's display name / unit: from its latest line
  const nameOf = new Map<string, { name: string; unit: string | null }>();
  for (const p of purchases) for (const l of p.lines) nameOf.set(l.key, { name: l.name, unit: l.unit });

  // usual basket: products in at least half of the last 5 purchases
  const last5 = purchases.slice(-5);
  const basket: { key: string; name: string; unit: string | null; quantity: number; times: number; of: number }[] = [];
  if (last5.length >= 2) {
    const qty = new Map<string, number[]>();
    for (const p of last5) {
      const per = new Map<string, number>();
      for (const l of p.lines) per.set(l.key, (per.get(l.key) ?? 0) + l.quantity);
      for (const [k, q] of per) qty.set(k, [...(qty.get(k) ?? []), q]);
    }
    for (const [k, qs] of qty)
      if (qs.length * 2 >= last5.length) basket.push({ key: k, ...nameOf.get(k)!, quantity: Math.round(median(qs)! * 100) / 100, times: qs.length, of: last5.length });
    basket.sort((a, b) => b.times - a.times || b.quantity - a.quantity || a.name.localeCompare(b.name));
  }

  // stopped buying: regular in the 10 purchases before the last 3, absent from the last 3
  const stopped: { key: string; name: string; last_date: string; times: number; of: number }[] = [];
  if (purchases.length >= 6) {
    const recent3 = purchases.slice(-3);
    const before = purchases.slice(-13, -3);
    const inRecent = new Set(recent3.flatMap((p) => p.lines.map((l) => l.key)));
    const count = new Map<string, number>();
    for (const p of before) for (const k of new Set(p.lines.map((l) => l.key))) count.set(k, (count.get(k) ?? 0) + 1);
    for (const [k, n] of count)
      if (!inRecent.has(k) && n >= 3 && n >= 0.4 * before.length) {
        const lastDate = [...before].reverse().find((p) => p.lines.some((l) => l.key === k))!.date;
        stopped.push({ key: k, name: nameOf.get(k)!.name, last_date: lastDate, times: n, of: before.length });
      }
    stopped.sort((a, b) => b.times - a.times || a.name.localeCompare(b.name));
  }

  // ---------- value ----------
  const thisFy = fyOf(today);
  const firstFy = real.length ? fyOf(real.reduce((m, b) => (b.bill_date < m ? b.bill_date : m), real[0]!.bill_date)) : thisFy;
  const fy = input.fy && input.fy >= firstFy && input.fy <= thisFy ? input.fy : thisFy;
  const months = (start: number) => {
    const out = Array<bigint>(12).fill(0n);
    for (const b of real) if (fyOf(b.bill_date) === start) out[fyMonth(b.bill_date)]! += b.total;
    return out;
  };
  // this financial year so far against the same days last year (29 Feb → 28 Feb)
  const fyStart = `${thisFy}-04-01`;
  const sameDayLastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4) === "-02-29" ? "-02-28" : today.slice(4)}`;
  const sumIn = (from: string, to: string) => real.filter((b) => b.bill_date >= from && b.bill_date <= to).reduce((s, b) => s + b.total, 0n);
  const ytd = sumIn(fyStart, today);
  const lastYtd = sumIn(`${thisFy - 1}-04-01`, sameDayLastYear);
  const bills12 = real.filter((b) => b.bill_date > yearAgo);
  const firstDates = [...real.map((b) => b.bill_date), ...input.unbilledOrders.map((o) => o.date)].sort();

  return {
    paying,
    oldest_unpaid: oldestUnpaid,
    trend,
    ordering: {
      purchases: purchases.length,
      last_date: last?.date ?? null,
      days_since_last: last ? daysBetween(last.date, today) : null,
      usual_gap: gap,
    },
    next,
    basket: basket.slice(0, 6),
    stopped: stopped.slice(0, 3),
    year: {
      fy,
      fys: Array.from({ length: thisFy - firstFy + 1 }, (_, i) => thisFy - i),
      months: months(fy),
      prev_months: months(fy - 1),
      ytd,
      last_ytd: lastYtd,
      /** whole percent; null when last year had nothing to compare with */
      change_pct: lastYtd > 0n ? Math.round((Number(ytd - lastYtd) / Number(lastYtd)) * 100) : null,
      /** whole rupees, in paise */
      avg_bill: bills12.length ? ((bills12.reduce((s, b) => s + b.total, 0n) / BigInt(bills12.length) + 50n) / 100n) * 100n : null,
      bills_12m: bills12.length,
      customer_since: firstDates[0] ?? null,
    },
  };
}
export type CustomerInsights = ReturnType<typeof customerInsights>;

// Box totals for Drop (docs/CUSTOMER_APP_PHASE_PLAN.md "Home", decisions 18.5, 20.3, D4): how many boxes of one brand a
// shop bought this month, last month and this financial year (April–March) so far against the same days last year.
// The server gives every box once: from its bill (Zoho or PlantOps, not cancelled) or, for a delivered order with no
// bill, from the order; free boxes are left out before they get here. Only shown to a shop that bought the brand in
// the last 12 months. Dates are India dates "YYYY-MM-DD". Pure; nothing stored.
import { brandKey } from "./brand";
import { shiftMonths } from "./customer-page";
import { fyOf } from "./customer-insights";

export type BoxLine = {
  /** bill date, or the India date the order was delivered */
  date: string;
  brand: string;
  /** "1L", "500ml" */
  size: string;
  /** one bottle's ml, to list sizes biggest first */
  ml: number;
  /** boxes bought (never free ones) */
  qty: number;
};

export type BoxPeriod = { total: number; sizes: { size: string; boxes: number }[] };
export type BoxTotals = { this_month: BoxPeriod; last_month: BoxPeriod; this_year: { total: number; last_year_same_days: number } };

// in thousandths, so 0.5 + 0.25 adds up exactly (bill quantities have 3 decimals)
const milli = (q: number) => Math.round(q * 1000);
const back = (m: number) => m / 1000;

/** The brand's totals for the shop, or null when it bought none of the brand in the last 12 months. */
export function boxTotals(lines: BoxLine[], brand: string, today: string): BoxTotals | null {
  const mine = lines.filter((l) => brandKey(l.brand) === brandKey(brand) && l.qty > 0 && l.date <= today);
  const yearAgo = shiftMonths(today, -12);
  if (!mine.some((l) => l.date > yearAgo)) return null;

  const monthStart = `${today.slice(0, 7)}-01`;
  const lastStart = shiftMonths(monthStart, -1);
  const lastEnd = prevDay(monthStart);
  const fy = fyOf(today);
  const sameDayLastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4) === "-02-29" ? "-02-28" : today.slice(4)}`;

  const between = (from: string, to: string) => mine.filter((l) => l.date >= from && l.date <= to);
  const period = (from: string, to: string): BoxPeriod => {
    const by = new Map<string, { ml: number; m: number }>();
    for (const l of between(from, to)) {
      const s = by.get(l.size) ?? { ml: l.ml, m: 0 };
      s.m += milli(l.qty);
      by.set(l.size, s);
    }
    const sizes = [...by.entries()].sort((a, b) => b[1].ml - a[1].ml).map(([size, s]) => ({ size, boxes: back(s.m) }));
    return { total: back([...by.values()].reduce((t, s) => t + s.m, 0)), sizes };
  };
  const total = (from: string, to: string) => back(between(from, to).reduce((t, l) => t + milli(l.qty), 0));

  return {
    this_month: period(monthStart, today),
    last_month: period(lastStart, lastEnd),
    this_year: { total: total(`${fy}-04-01`, today), last_year_same_days: total(`${fy - 1}-04-01`, sameDayLastYear) },
  };
}

function prevDay(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

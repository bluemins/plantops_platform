// M2 "Which bills are over 30 days? Call these first": the Receivables rules, nothing recalculated. A bill counts when
// it still owes something today and is more than 30 days past its due date (a bill without one: its bill date), the
// same bills as Receivables → Aging Details' 31–45 and Over 45 bands (by due date, 15-day steps). Pure.
import { openBillsAsOf, type RecData } from "../receivables";
import { M2_DAYS } from "./cards";
import type { Facts } from "./facts";

/** phones: customer_key ('c:<id>' or 'z:<zoho contact id>') → 10-digit mobile */
export function m2Facts(d: RecData, phones: Map<string, string>, today: string): Facts {
  const late = openBillsAsOf(d, today, "due", 15, {}).filter((b) => b.age > M2_DAYS);
  const per = new Map<string, { name: string; place: string | null; href: string; bills: typeof late; due: bigint; oldest: number }>();
  for (const b of late) {
    const c = per.get(b.customer_key) ?? { name: b.customer_name, place: b.place, href: b.href, bills: [], due: 0n, oldest: 0 };
    per.set(b.customer_key, c);
    c.bills.push(b);
    c.due += b.due;
    c.oldest = Math.max(c.oldest, b.age);
  }
  const rows = [...per.entries()]
    .sort(([, a], [, b]) => (b.due > a.due ? 1 : b.due < a.due ? -1 : b.oldest - a.oldest || a.name.localeCompare(b.name)))
    .map(([key, c]) => ({
      key,
      href: c.href,
      customer: c.name,
      place: c.place?.trim() || null,
      bill_numbers: c.bills
        .sort((x, y) => y.age - x.age || x.number.localeCompare(y.number, "en", { numeric: true }))
        .map((b) => b.number)
        .join(", "),
      oldest_days: c.oldest,
      due: c.due,
      phone: phones.get(key) ?? null,
    }));
  return {
    totals: { bills: late.length, customers: rows.length, due: rows.reduce((s, r) => s + r.due, 0n) },
    rows,
  };
}

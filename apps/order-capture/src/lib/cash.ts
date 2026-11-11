// The cash book's rules (docs/CASHBOOK_PHASE_PLAN.md, step C1), with no database: used by the server, the pages and the
// tests. Cash in hand is never stored: a day's expected cash = the last close's count + money in − money out of every
// entry after that close, up to the day. A close stores what was counted; the next day starts from that count.
import { paise, rupees } from "./ledger";

/** "collection" = cash collected from customers (C2): saved only by the collection screen, never typed as an entry */
export type CashKind = "expense" | "staff_out" | "staff_in" | "owner_in" | "owner_out" | "bank_deposit" | "other_in" | "other_out" | "collection" | "van";
export type StaffPurpose = "advance" | "plant" | "salary";

/** C-0001: one series per plant. */
export const cashRef = (n: number) => `C-${String(n).padStart(4, "0")}`;

/** The starter list a plant gets when the owner starts the cash book (owner can rename, add, switch off). */
export const STARTER_CATEGORIES = ["Diesel", "Toll", "Meal", "Tea / tiffin", "Cleaning", "Building", "Chemicals", "Vehicle repair", "Stationery", "Other"];

export const KIND_LABEL: Record<CashKind, string> = {
  expense: "Expense",
  staff_out: "Staff cash: gave",
  staff_in: "Staff cash: took back",
  owner_in: "Owner added cash",
  owner_out: "Owner took cash",
  bank_deposit: "Deposited to bank",
  other_in: "Other money in",
  other_out: "Other money out",
  collection: "Collection from customers",
  van: "Van report",
};
export const PURPOSE_LABEL: Record<StaffPurpose, string> = { advance: "Advance against salary", plant: "For plant spending", salary: "Salary paid in cash" };

/** In or out, from the kind (the database checks the same). */
export const directionOf = (k: CashKind): "in" | "out" => (k === "staff_in" || k === "owner_in" || k === "other_in" || k === "collection" || k === "van" ? "in" : "out");

/** Alerts to the owner (plan section 4): a close this far off, an expense this big. */
export const SHORT_ALERT = 10000n; // ₹100, in paise
export const BIG_EXPENSE = 200000n; // ₹2,000

export interface MathEntry {
  cash_date: string;
  direction: "in" | "out";
  amount: string;
  cancelled: boolean;
}
export interface MathClose {
  cash_date: string;
  counted: string;
}

/** Money in / out of these entries (cancelled ones count for nothing), in paise. */
export function sums(entries: MathEntry[]) {
  let inn = 0n;
  let out = 0n;
  for (const e of entries) {
    if (e.cancelled) continue;
    if (e.direction === "in") inn += paise(e.amount);
    else out += paise(e.amount);
  }
  return { in: inn, out };
}

/**
 * Expected cash at the end of `day`: the newest close BEFORE `day` (its latest version) + entries after it up to `day`.
 * null when there is no close before `day` (the cash book had not started).
 */
export function expectedOn(day: string, closes: MathClose[], entries: MathEntry[]) {
  const prev = closes.filter((c) => c.cash_date < day).sort((a, b) => (a.cash_date < b.cash_date ? 1 : -1))[0];
  if (!prev) return null;
  const s = sums(entries.filter((e) => e.cash_date > prev.cash_date && e.cash_date <= day));
  return { from: prev.cash_date, opening: paise(prev.counted), in: s.in, out: s.out, expected: paise(prev.counted) + s.in - s.out };
}

export interface BookDay {
  date: string;
  opening: bigint;
  in: bigint;
  out: bigint;
  expected: bigint;
  /** counted at the close of this day; null = not closed */
  counted: bigint | null;
  difference: bigint | null;
  entries: number;
}

/**
 * The cash book day by day from the first close: each day starts from the day before's count when it was closed, else
 * from its expected cash. Only days with entries or a close are listed. `closes` = the latest version per day.
 */
export function bookDays(closes: MathClose[], entries: MathEntry[]): BookDay[] {
  const closeOn = new Map(closes.map((c) => [c.cash_date, paise(c.counted)]));
  const days = [...new Set([...closes.map((c) => c.cash_date), ...entries.map((e) => e.cash_date)])].sort();
  const first = closes.map((c) => c.cash_date).sort()[0];
  if (!first) return [];
  const out: BookDay[] = [];
  let running = closeOn.get(first)!;
  for (const d of days) {
    if (d < first) continue;
    const dayEntries = entries.filter((e) => e.cash_date === d);
    if (d === first) {
      out.push({ date: d, opening: running, in: 0n, out: 0n, expected: running, counted: running, difference: 0n, entries: dayEntries.length });
      continue;
    }
    const s = sums(dayEntries);
    const expected = running + s.in - s.out;
    const counted = closeOn.get(d) ?? null;
    out.push({ date: d, opening: running, in: s.in, out: s.out, expected, counted, difference: counted === null ? null : counted - expected, entries: dayEntries.length });
    running = counted ?? expected;
  }
  return out;
}

/** "₹26,825", "−₹325": the sign outside the rupee symbol. */
export function signedMoney(p: bigint) {
  const a = p < 0n ? -p : p;
  const whole = (a / 100n).toLocaleString("en-IN");
  const s = a % 100n === 0n ? `₹${whole}` : `₹${whole}.${String(a % 100n).padStart(2, "0")}`;
  return p < 0n ? `−${s}` : s;
}

/** "Matches", "Short ₹325", "Extra ₹50". */
export function differenceText(d: bigint) {
  if (d === 0n) return "Matches";
  return d < 0n ? `Short ${signedMoney(-d)}` : `Extra ${signedMoney(d)}`;
}

export { paise, rupees };

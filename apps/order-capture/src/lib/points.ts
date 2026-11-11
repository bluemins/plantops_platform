// Drop points (docs/CUSTOMER_APP_PHASE_PLAN.md "Points tab", D8–D10; owner 2026-11-09). Pure rules; nothing earned is
// stored: points are worked out from bills, payments and free-box requests whenever they are asked for.
//   * Earn: PlantOps bills (never Zoho), not cancelled, dated on or after the start date. Each payment set against such
//     a bill earns its share of the bill's main-brand value before GST and after discounts:
//       points = allocation × main value ÷ bill total ÷ ₹ per point       (kept in hundredths, shown rounded down)
//     only when the payment's date is within `late_days` of the delivery (the bill's order delivered; a bill without an
//     order: its bill date). A cancelled payment or bill earns nothing (their reversing rows are ignored too).
//   * Earned on the allocation date: it picks the ₹ per point in force and the points year. An advance used later
//     earns on the day it is used.
//   * Points year: 1 February – 31 January; the first year runs from the start date to the first 31 January at least
//     six months later (a November 2026 start → 31 January 2028, D9). Unspent points end with the year.
//   * Free boxes: a request holds its points at once; spent when its order is delivered; back when the order is
//     cancelled or staff cancel the request. Asked only in the redeem months, with enough points, one at a time.
import { brandKey } from "./brand";
import { addDays } from "./customer-insights";
import { paise } from "./ledger";

export type PointsReward = { sku_id: string; label: string; points: number };

export type PointsSetting = {
  effective_from: string;
  start_date: string | null;
  /** ₹ per point, in paise */
  rupees_per_point: bigint;
  late_days: number;
  poll_points: number;
  redeem_months: number[];
  rewards: PointsReward[];
};

/**
 * The settings in force on a day: the newest row whose effective_from has come (rows oldest first). Days before the
 * first row use the first row (the owner may set a start date in the past when the first settings are saved).
 */
export function settingOn(rows: PointsSetting[], day: string): PointsSetting | null {
  let out: PointsSetting | null = rows[0] ?? null;
  for (const r of rows) if (r.effective_from <= day) out = r;
  return out;
}

/** The points start date: the latest setting's (null = points off). */
export const startDateOf = (rows: PointsSetting[]) => rows.at(-1)?.start_date ?? null;

// ---------- points years ----------

const jan31 = (year: number) => `${year}-01-31`;

/** The first points year's last day: the first 31 January at least six months after the start. */
export function firstYearEnd(start: string) {
  const y = Number(start.slice(0, 4));
  for (const end of [jan31(y), jan31(y + 1), jan31(y + 2)]) if (end >= addMonthsYmd(start, 6)) return end;
  return jan31(y + 2);
}

/** The last day (31 January) of the points year that `day` is in. */
export function yearEndOf(day: string, start: string) {
  const first = firstYearEnd(start);
  if (day <= first) return first;
  const y = Number(day.slice(0, 4));
  return day.slice(5) <= "01-31" ? jan31(y) : jan31(y + 1);
}

function addMonthsYmd(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

// ---------- what a bill is worth in points ----------

export type ValueLine = { brand: string; line_total: string; taxable: string | null; free: boolean };

/**
 * The bill's main-brand value before GST and after discounts, in paise: a GST bill's `taxable` already has the bill's
 * discount shared over its lines; a bill without GST shares the bill's discount here, by line value.
 */
export function mainValue(lines: ValueLine[], subTotal: bigint, discount: bigint, main: string): bigint {
  const mine = lines.filter((l) => !l.free && brandKey(l.brand) === brandKey(main));
  if (lines.some((l) => l.taxable !== null)) return mine.reduce((s, l) => s + paise(l.taxable ?? "0"), 0n);
  const value = mine.reduce((s, l) => s + paise(l.line_total), 0n);
  if (subTotal <= 0n) return 0n;
  return (value * (subTotal - discount)) / subTotal;
}

export type PointsBill = {
  id: string;
  source: "plantops" | "zoho" | "opening";
  bill_date: string;
  /** India date the bill's order was delivered; null = no delivered order (the bill date counts) */
  delivered_on: string | null;
  total: bigint;
  /** mainValue() */
  main_value: bigint;
  cancelled: boolean;
};
export type PointsPayment = { id: string; payment_date: string; cancelled: boolean };
export type PointsAllocation = { payment_id: string; bill_id: string; amount: bigint; allocated_on: string };

/** Points earned per allocation, in hundredths of a point. */
export function purchasePoints(bills: PointsBill[], payments: PointsPayment[], allocations: PointsAllocation[], settings: PointsSetting[]) {
  const start = startDateOf(settings);
  if (!start) return [];
  const billOf = new Map(bills.map((b) => [b.id, b]));
  const payOf = new Map(payments.map((p) => [p.id, p]));
  const out: { on: string; hundredths: bigint }[] = [];
  for (const a of allocations) {
    const b = billOf.get(a.bill_id);
    const p = payOf.get(a.payment_id);
    if (!b || !p || b.cancelled || p.cancelled || b.source !== "plantops") continue;
    if (b.bill_date < start || a.allocated_on < start || b.total <= 0n || b.main_value <= 0n) continue;
    const s = settingOn(settings, a.allocated_on);
    if (!s) continue;
    const onTime = p.payment_date <= addDays(b.delivered_on ?? b.bill_date, s.late_days);
    const hundredths = onTime ? (a.amount * b.main_value * 100n) / (b.total * s.rupees_per_point) : 0n;
    out.push({ on: a.allocated_on, hundredths });
  }
  return out;
}

// ---------- free-box requests ----------

export type RequestState = "asked" | "on_order" | "delivered" | "returned";

/** A request's state from its own row and its order's status. */
export function requestState(r: { cancelled: boolean; order_status: "pending" | "delivered" | "cancelled" | null }): RequestState {
  if (r.cancelled || r.order_status === "cancelled") return "returned";
  if (r.order_status === "delivered") return "delivered";
  return r.order_status === "pending" ? "on_order" : "asked";
}

export const STATE_LABEL: Record<RequestState, string> = { asked: "Asked", on_order: "On the way", delivered: "Delivered", returned: "Cancelled, points back" };

export type PointsRequest = { id: string; label: string; points: number; year_end: string; asked_on: string; state: RequestState };

// ---------- a shop's points ----------

export type PointsSummary = {
  /** false = points are off (no start date) or haven't started yet */
  on: boolean;
  start_date: string | null;
  year_end: string | null;
  balance: number;
  open_request: PointsRequest | null;
  record: { month: string; purchases: number; polls: number; boxes: { label: string; state: RequestState; date: string }[] }[];
};

const whole = (h: bigint) => Number(h / 100n);

/** Balance, open request and the monthly record for one shop on `today` (India date). */
export function pointsSummary(input: {
  earned: { on: string; hundredths: bigint }[];
  polls: { on: string; points: number }[];
  requests: PointsRequest[];
  settings: PointsSetting[];
  today: string;
}): PointsSummary {
  const start = startDateOf(input.settings);
  const open = input.requests.filter((r) => r.state === "asked" || r.state === "on_order").sort((a, b) => b.asked_on.localeCompare(a.asked_on))[0] ?? null;
  if (!start || input.today < start) return { on: false, start_date: start, year_end: null, balance: 0, open_request: open, record: [] };
  const yearEnd = yearEndOf(input.today, start);
  const inYear = (day: string) => day >= start && yearEndOf(day, start) === yearEnd && day <= input.today;
  const earned = input.earned.filter((e) => inYear(e.on));
  const polls = input.polls.filter((p) => inYear(p.on));
  const held = input.requests.filter((r) => r.year_end === yearEnd && r.state !== "returned").reduce((s, r) => s + r.points, 0);
  const balance = whole(earned.reduce((s, e) => s + e.hundredths, 0n)) + polls.reduce((s, p) => s + p.points, 0) - held;

  const months = new Map<string, { h: bigint; polls: number; boxes: { label: string; state: RequestState; date: string }[] }>();
  const m = (day: string) => {
    const k = day.slice(0, 7);
    if (!months.has(k)) months.set(k, { h: 0n, polls: 0, boxes: [] });
    return months.get(k)!;
  };
  for (const e of earned) m(e.on).h += e.hundredths;
  for (const p of polls) m(p.on).polls += p.points;
  for (const r of input.requests.filter((x) => x.year_end === yearEnd)) m(r.asked_on).boxes.push({ label: r.label, state: r.state, date: r.asked_on });
  const record = [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, v]) => ({ month, purchases: whole(v.h), polls: v.polls, boxes: v.boxes.sort((a, b) => b.date.localeCompare(a.date)) }))
    .filter((r) => r.purchases || r.polls || r.boxes.length);
  return { on: true, start_date: start, year_end: yearEnd, balance, open_request: open, record };
}

/** Months are 1–12; redeem months e.g. July–January = [7..12, 1]. */
export const redeemOpen = (setting: PointsSetting | null, today: string) => !!setting && setting.redeem_months.includes(Number(today.slice(5, 7)));

/** The first day of the next redeem month after `today` (for "Free boxes from 1 July"); null = none set. */
export function redeemOpensOn(setting: PointsSetting | null, today: string): string | null {
  if (!setting || !setting.redeem_months.length) return null;
  let y = Number(today.slice(0, 4));
  let mo = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
    if (setting.redeem_months.includes(mo)) return `${y}-${String(mo).padStart(2, "0")}-01`;
  }
  return null;
}

export type WhyNot = "points_off" | "not_now" | "too_few" | "one_open";

/** Whether the shop can use a reward now, and why not. */
export function canUse(summary: PointsSummary, setting: PointsSetting | null, reward: PointsReward, today: string): WhyNot | null {
  if (!summary.on) return "points_off";
  if (!redeemOpen(setting, today)) return "not_now";
  if (summary.open_request) return "one_open";
  if (summary.balance < reward.points) return "too_few";
  return null;
}

export const WHY_NOT_TEXT: Record<WhyNot, string> = {
  points_off: "Points have not started yet.",
  not_now: "Free boxes can be asked for in the free-box months only.",
  too_few: "Not enough points yet.",
  one_open: "You already asked for a free box. You can ask again once it is delivered.",
};

/** The cheapest reward and how many points are missing for it (0 = enough). */
export function nextReward(summary: PointsSummary, rewards: PointsReward[]) {
  const cheapest = [...rewards].sort((a, b) => a.points - b.points)[0];
  if (!summary.on || !cheapest) return null;
  return { label: cheapest.label, missing: Math.max(0, cheapest.points - summary.balance) };
}

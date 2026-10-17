// The salary rules (docs/SALARY_PHASE_PLAN.md "The rules", numbered 1-14 there; rule 15 and later in
// docs/SALARY_EXTRAS_PHASE_PLAN.md). ONE pure file, used by the server,
// the salary CSV and the owner's checking panel in the browser, so their numbers can never disagree. No database and
// no Node-only imports. Nothing worked out here is stored, except the frozen figures of a month ticked Paid.
//
// Money is whole paise as plain numbers (rule 13): the largest amount is ₹1 crore = 10^9 paise, far inside a JS
// number's exact range (9 x 10^15), and plain numbers go into JSON (the frozen figures) and the browser as they are.
// Half days are counted in whole "half-day units" so the arithmetic has no fractions.
import { monthDays } from "./days";

/** Saved with every payment's frozen figures; raise it whenever a rule here changes. */
export const RULES_VERSION = 2;
/** Rule 7: a day's pay is always the monthly salary ÷ 30, whatever the month's length. */
export const DAYS_FOR_PAY = 30;

// ---------- money (rule 13) ----------

/** Rupees as typed: up to ₹1 crore, at most 2 decimals ("12000", "12000.5", "0.01"). */
export const RUPEES_RE = /^\d{1,8}(\.\d{1,2})?$/;

/** "12000.50" -> 1200050 paise; null when the text isn't rupees with at most 2 decimals. */
export function toPaise(rupees: string): number | null {
  const t = rupees.trim();
  if (!RUPEES_RE.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

const sign = (paise: number) => (paise < 0 ? "−" : "");

/** "₹9,040", "−₹2,100", "₹1,25,000": to the nearest rupee, Indian grouping (what the screens show). */
export const rupeesText = (paise: number) => `${sign(paise)}₹${Math.round(Math.abs(paise) / 100).toLocaleString("en-IN")}`;

/** "₹9,666.67", "₹400": exact, with the paise only when there are some (the salary slip). */
export function paiseText(paise: number) {
  const a = Math.abs(paise);
  const whole = Math.floor(a / 100).toLocaleString("en-IN");
  return `${sign(paise)}₹${whole}${a % 100 ? `.${String(a % 100).padStart(2, "0")}` : ""}`;
}

/** Minutes as hours with up to 2 decimals: 40 -> "0.67", 840 -> "14", 90 -> "1.5" (rule 9). */
export const hoursText = (minutes: number) => String(Math.round((minutes * 100) / 60) / 100);

/** Half-day units as days: 5 -> "2.5", 4 -> "2". */
export const halvesText = (halves: number) => String(halves / 2);

// ---------- which setting applies ----------

/** Monthly salary (rules 4-8) or a day rate (rule 15). */
export type PayBasis = "monthly" | "per_day";

export interface SalarySetting {
  id: string;
  /** "YYYY-MM" */
  fromMonth: string;
  payBasis: PayBasis;
  /** monthly people only (null for per day) */
  monthlyPaise: number | null;
  /** per-day people only (null for monthly) */
  dayRatePaise: number | null;
  shiftMinutes: number;
  paidLeaveHalfdays: number;
  getsOvertime: boolean;
  otRatePaise: number | null;
  joinedOn: string | null;
  leftOn: string | null;
  createdAt: Date | string;
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * The setting for a month: the row with the latest from month on or before it; between rows with the same from month
 * the newest saved wins. null = not on salary that month ("Which setting applies").
 */
export function settingFor<S extends SalarySetting>(rows: readonly S[], month: string): S | null {
  let best: S | null = null;
  for (const r of rows) {
    if (r.fromMonth > month) continue;
    if (!best || r.fromMonth > best.fromMonth || (r.fromMonth === best.fromMonth && time(r.createdAt) > time(best.createdAt))) best = r;
  }
  return best;
}

/** The person's first salary month ("YYYY-MM"), or null without any setting. */
export const firstSalaryMonth = (rows: readonly SalarySetting[]) =>
  rows.reduce<string | null>((first, r) => (!first || r.fromMonth < first ? r.fromMonth : first), null);

// ---------- counted days (rule 1) ----------

export interface Counted {
  /** days of the month that are over AND inside the employment, oldest first */
  dates: string[];
  /** the month's length (28-31) */
  monthLength: number;
  /** employed every day of the month (rule 8: full month vs part month) */
  fullMonth: boolean;
  /** every day of the month is over (otherwise the month says "so far") */
  complete: boolean;
}

/**
 * Rule 1. `joinedOn` blank = the first day of the person's first salary month (the caller passes that in);
 * `leftOn` blank = still working. Today and later are never counted. null = not employed on any day of the month.
 */
export function countedDates(month: string, today: string, joinedOn: string | null, leftOn: string | null): Counted | null {
  const all = monthDays(month);
  const employed = all.filter((d) => (!joinedOn || d >= joinedOn) && (!leftOn || d <= leftOn));
  if (employed.length === 0) return null;
  return {
    dates: employed.filter((d) => d < today),
    monthLength: all.length,
    fullMonth: employed.length === all.length,
    complete: all.at(-1)! < today,
  };
}

// ---------- day statuses (rules 2, 3, 9) ----------

export type DayStatus = "present" | "half" | "absent";

export interface DayResult {
  date: string;
  /** worked minutes: complete blocks only (sessions.ts), so a "no exit" day is 0 until the owner fixes it */
  minutes: number;
  status: DayStatus;
  /** minutes over the shift; 0 for people without "Gets overtime" */
  otMinutes: number;
}

/**
 * Rules 2, 3 and 9 for each counted day: present if worked ≥ shift, half day if ≥ shift ÷ 2, otherwise absent (also
 * with no marks at all). Overtime = worked − shift when positive, exact minutes, only with "Gets overtime". `days`
 * is sessions.ts's workDays() (a night shift is already on the day it started).
 */
export function dayStatuses(days: ReadonlyMap<string, { minutes: number }>, shiftMinutes: number, counted: readonly string[], getsOvertime: boolean): DayResult[] {
  return counted.map((date) => {
    const minutes = days.get(date)?.minutes ?? 0;
    const status: DayStatus = minutes >= shiftMinutes ? "present" : minutes * 2 >= shiftMinutes ? "half" : "absent";
    return { date, minutes, status, otMinutes: getsOvertime ? Math.max(0, minutes - shiftMinutes) : 0 };
  });
}

export interface DayCounts {
  present: number;
  half: number;
  absent: number;
  otMinutes: number;
}

export function countDays(days: readonly DayResult[]): DayCounts {
  const c: DayCounts = { present: 0, half: 0, absent: 0, otMinutes: 0 };
  for (const d of days) {
    c[d.status] += 1;
    c.otMinutes += d.otMinutes;
  }
  return c;
}

// ---------- one month's pay (rules 4-10, 12, 13) ----------

/** Everything one month's pay is worked out from. Counts, not marks, so the checking panel can feed typed numbers. */
export interface PayInput extends DayCounts {
  payBasis: PayBasis;
  /** monthly people; 0 for per-day people */
  monthlyPaise: number;
  /** per-day people (rule 15); null for monthly people */
  dayRatePaise: number | null;
  /** employed every day of the month (rule 8) */
  fullMonth: boolean;
  paidLeaveHalfdays: number;
  getsOvertime: boolean;
  otRatePaise: number | null;
  /** rule 10: the month's advance entries added up (corrections are negative) */
  advancesPaise: number;
  /** rule 11: taken off this month because last month ended below 0 (a positive number) */
  carriedInPaise: number;
  /** rule 14: "Adjustment from <last month>", + or − */
  adjustmentPaise: number;
}

export interface PayResult {
  /** rule 4: absent + ½ × half days, in half-day units */
  absentHalves: number;
  /** rule 5: min(absent days, paid leave per month); unused leave lapses */
  leaveUsedHalves: number;
  /** rule 6 */
  unpaidHalves: number;
  /** rule 7: salary ÷ 30, rounded to the paisa; per day (rule 15): the day rate */
  dayPayPaise: number;
  /** full month: unpaid days × day's pay (taken off the salary); part month: 0 */
  deductionPaise: number;
  /** part month: present + ½ × half days + paid leave used, in half-day units (paid at day's pay); full month: 0;
   *  per day (rule 15): present + ½ × half days */
  paidHalves: number;
  /** rule 8 */
  earnedPaise: number;
  /** rule 9: 0 without "Gets overtime" */
  otMinutes: number;
  otPayPaise: number;
  advancesPaise: number;
  carriedInPaise: number;
  adjustmentPaise: number;
  /** rule 12: below 0 carries to the next month */
  remainingPaise: number;
}

export function monthPay(i: PayInput): PayResult {
  const perDay = i.payBasis === "per_day";
  const absentHalves = 2 * i.absent + i.half; // rule 4
  const leaveUsedHalves = perDay ? 0 : Math.min(absentHalves, i.paidLeaveHalfdays); // rule 5 (rule 15: no paid leave)
  const unpaidHalves = absentHalves - leaveUsedHalves; // rule 6
  const dayPayPaise = perDay ? (i.dayRatePaise ?? 0) : Math.round(i.monthlyPaise / DAYS_FOR_PAY); // rule 7 / 15
  // rule 8: the day's pay as shown is used, so "unpaid days × day's pay" on the screen adds up exactly
  let deductionPaise = 0;
  let paidHalves = 0;
  let earnedPaise: number;
  if (perDay) {
    // rule 15: day rate × (present + ½ × half days), rounded once; absent days earn nothing; no full / part month
    // difference (the counted days already keep the month inside the employment)
    paidHalves = 2 * i.present + i.half;
    earnedPaise = Math.round((paidHalves * dayPayPaise) / 2);
  } else if (i.fullMonth) {
    deductionPaise = Math.round((unpaidHalves * dayPayPaise) / 2);
    earnedPaise = Math.max(0, i.monthlyPaise - deductionPaise);
  } else {
    paidHalves = 2 * i.present + i.half + leaveUsedHalves;
    earnedPaise = Math.max(0, Math.min(i.monthlyPaise, Math.round((paidHalves * dayPayPaise) / 2)));
  }
  // rule 9: overtime only with "Gets overtime" and a rate; exact minutes
  const otMinutes = i.getsOvertime && i.otRatePaise ? i.otMinutes : 0;
  const otPayPaise = otMinutes ? Math.round((otMinutes * i.otRatePaise!) / 60) : 0;
  // rule 12
  const remainingPaise = earnedPaise + otPayPaise - i.advancesPaise - i.carriedInPaise + i.adjustmentPaise;
  return {
    absentHalves,
    leaveUsedHalves,
    unpaidHalves,
    dayPayPaise,
    deductionPaise,
    paidHalves,
    earnedPaise,
    otMinutes,
    otPayPaise,
    advancesPaise: i.advancesPaise,
    carriedInPaise: i.carriedInPaise,
    adjustmentPaise: i.adjustmentPaise,
    remainingPaise,
  };
}

// ---------- the owner's checking panel (docs/SALARY_PHASE_PLAN.md "Owner: checking panel") ----------

/** The panel's boxes: days, hours and rupees as typed. */
export type PanelField = "monthly" | "dayRate" | "present" | "half" | "absent" | "leave" | "otHours" | "otRate" | "advances" | "carried";

/**
 * The panel's typed boxes -> monthPay()'s input, so the panel runs exactly the server's arithmetic. An empty or
 * unusable box means "the automatic figure". "leave" is the paid leave ALLOWED (rule 5 still takes the smaller of
 * that and the absent days). Nothing here is saved anywhere.
 */
export function panelInput(auto: PayInput, typed: Partial<Record<PanelField, string>>): PayInput {
  const n = (k: PanelField, fallback: number) => {
    const t = typed[k]?.trim();
    if (!t) return fallback;
    const v = Number(t);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const paise = (k: PanelField, fallbackPaise: number) => Math.round(n(k, fallbackPaise / 100) * 100);
  return {
    ...auto,
    monthlyPaise: paise("monthly", auto.monthlyPaise),
    // per-day people (rule 15): the day rate box instead of the salary
    dayRatePaise: auto.payBasis === "per_day" ? paise("dayRate", auto.dayRatePaise ?? 0) : auto.dayRatePaise,
    present: n("present", auto.present),
    half: n("half", auto.half),
    absent: n("absent", auto.absent),
    paidLeaveHalfdays: Math.round(n("leave", auto.paidLeaveHalfdays / 2) * 2),
    otMinutes: Math.round(n("otHours", auto.otMinutes / 60) * 60),
    otRatePaise: auto.getsOvertime ? paise("otRate", auto.otRatePaise ?? 0) : auto.otRatePaise,
    advancesPaise: paise("advances", auto.advancesPaise),
    carriedInPaise: paise("carried", auto.carriedInPaise),
  };
}

// ---------- month to month: carry and paid months (rules 11, 12, 14) ----------

/** A month ticked Paid (and not undone): what was saved then. */
export interface PaidMonth {
  paymentId: string;
  paidOn: string;
  paidPaise: number;
  /** the frozen remaining (may be below 0) */
  remainingPaise: number;
}

export interface ChainInput {
  /** "YYYY-MM" */
  month: string;
  /** this month's pay inputs without the two that come from the month before */
  input: Omit<PayInput, "carriedInPaise" | "adjustmentPaise">;
  paid: PaidMonth | null;
}

export interface ChainMonth {
  month: string;
  /** the live calculation, with the carry and adjustment it should have now */
  live: PayResult;
  /** the month the adjustment comes from (null when there is none) */
  adjustmentFrom: string | null;
  paid: PaidMonth | null;
  /** paid months only: live remaining − frozen remaining ("Changed after payment"); 0 otherwise */
  changedPaise: number;
  /** what this month takes off the next one (rule 11): its remaining below 0, as a positive number */
  carriesOutPaise: number;
}

/**
 * Walks a person's salary months oldest first (from their first salary month; months outside their employment are
 * simply not in the list). Rule 11: a remaining below 0 is taken off the next month; for a paid month the FROZEN
 * remaining counts. Rule 14: a paid month is worked out again with the carry and adjustment it should have now; any
 * difference from its frozen remaining goes to the next month as "Adjustment from <month>". This counts every later
 * change exactly once: also when the next month was paid too (it then took the adjustment in) and after an undo (the
 * month is live again, and whatever a later paid month took in goes back out).
 */
export function carryChain(months: readonly ChainInput[]): ChainMonth[] {
  const out: ChainMonth[] = [];
  let carry = 0;
  let adjustment = 0;
  let adjustmentFrom: string | null = null;
  for (const m of months) {
    const live = monthPay({ ...m.input, carriedInPaise: carry, adjustmentPaise: adjustment });
    const counted = m.paid ? m.paid.remainingPaise : live.remainingPaise;
    const changedPaise = m.paid ? live.remainingPaise - m.paid.remainingPaise : 0;
    const carriesOutPaise = counted < 0 ? -counted : 0;
    out.push({ month: m.month, live, adjustmentFrom: adjustment ? adjustmentFrom : null, paid: m.paid, changedPaise, carriesOutPaise });
    carry = carriesOutPaise;
    adjustment = changedPaise;
    adjustmentFrom = m.month;
  }
  return out;
}

// ---------- the frozen figures of a paid month (rule 14; saved in Phase 5) ----------

export interface FrozenAdvance {
  onDate: string;
  amountPaise: number;
  note: string | null;
}

/** Everything a paid month's slip shows, exactly as it stood when the month was ticked Paid. */
export interface FrozenMonth {
  rules: number;
  month: string;
  setting: { payBasis: PayBasis; monthlyPaise: number | null; dayRatePaise: number | null; shiftMinutes: number; paidLeaveHalfdays: number; getsOvertime: boolean; otRatePaise: number | null; joinedOn: string | null; leftOn: string | null };
  counted: Counted;
  counts: DayCounts;
  advances: FrozenAdvance[];
  adjustmentFrom: string | null;
  /** exactly what monthPay() was given, and what it gave */
  input: PayInput;
  result: PayResult;
}

/**
 * A paid month's saved figures as this version reads them. Months frozen with `rules: 1` (before per-day pay) have no
 * pay basis: they read as monthly. The saved numbers are shown as they are, never worked out again.
 */
export function readFrozen(f: FrozenMonth): FrozenMonth {
  if (f.rules >= 2) return f;
  return {
    ...f,
    setting: { ...f.setting, payBasis: f.setting.payBasis ?? "monthly", dayRatePaise: f.setting.dayRatePaise ?? null },
    input: { ...f.input, payBasis: f.input.payBasis ?? "monthly", dayRatePaise: f.input.dayRatePaise ?? null },
  };
}

// The salary rules (docs/SALARY_PHASE_PLAN.md "The rules", numbered 1-14 there; rule 15 and later in
// docs/SALARY_EXTRAS_PHASE_PLAN.md). ONE pure file, used by the server,
// the salary CSV and the owner's checking panel in the browser, so their numbers can never disagree. No database and
// no Node-only imports. Nothing worked out here is stored, except the frozen figures of a month ticked Paid.
//
// Money is whole paise as plain numbers (rule 13): the largest amount is ₹1 crore = 10^9 paise, far inside a JS
// number's exact range (9 x 10^15), and plain numbers go into JSON (the frozen figures) and the browser as they are.
// Rule 21 (owner, 2026-10-23): work = time at the plant − the lunch break; a day under the work hours is a SHORT day
// (no more half days), and the month's short-day work ÷ the work hours = days paid. Pay is worked out in minutes and
// rounded once; the "halves" figures of PayResult are kept for the screens (fractional since rule 21).
import { monthDays } from "./days";

/** Saved with every payment's frozen figures; raise it whenever a rule here changes. */
export const RULES_VERSION = 7;
/**
 * The salary types (owner, 2026-10-23): each pay basis is one named calculation, picked first in the Salary box, shown
 * on the Salary tab, slip and CSV, and saved with a paid month's figures.
 * - per_day  PV_SALARY_DAY_STAFF: day rate; work = time at plant − lunch; short days ÷ the work hours; overtime per
 *   hour; OFF and absent days not paid; no paid leave.
 * - monthly  PV_SALARY_MONTHLY_STAFF: salary ÷ 30 a day; the same work, short-day and overtime rules; OFF and absent
 *   days covered by the person's paid leave first, the rest cut.
 * - fixed    PV_SALARY_FIXED_MONTHLY: the full monthly salary whatever the attendance; no overtime, no paid leave;
 *   only a part month (joined / last day) is paid for its days.
 */
export const SALARY_TYPES = {
  per_day: "PV_SALARY_DAY_STAFF",
  monthly: "PV_SALARY_MONTHLY_STAFF",
  fixed: "PV_SALARY_FIXED_MONTHLY",
} as const;
export const salaryType = (basis: PayBasis) => SALARY_TYPES[basis];
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

/** Half-day units as days, at most 2 decimals: 5 -> "2.5", 4 -> "2", 39.4875 -> "19.74" (rule 21). */
export const halvesText = (halves: number) => String(Math.round(halves * 50) / 100);

// ---------- which setting applies ----------

/** Monthly salary (rules 4-8) or a day rate (rule 15). */
export type PayBasis = "monthly" | "per_day" | "fixed";

export interface SalarySetting {
  id: string;
  /** "YYYY-MM" */
  fromMonth: string;
  payBasis: PayBasis;
  /** monthly people only (null for per day) */
  monthlyPaise: number | null;
  /** per-day people only (null for monthly) */
  dayRatePaise: number | null;
  /** TA per km of approved field duty (rule 16); null = no TA */
  kmRatePaise: number | null;
  /** DA per date with approved field duty (rule 17); null = no DA */
  daDayPaise: number | null;
  /** work hours a day, without the lunch break: a full day (rule 21) */
  shiftMinutes: number;
  /** rule 21: the lunch break taken off the time at the plant; 0 = none */
  lunchMinutes: number;
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

/**
 * "off" = the owner marked a day off WITHOUT pay (rule 20, unpaid since rule 22); never from the IN / OUT marks. "short" = worked, but less than the
 * work hours (rule 21). "half" only in months frozen before rule 21.
 */
export type DayStatus = "present" | "short" | "half" | "absent" | "off";
/** The owner's whole-day mark for one person and day (rule 20); "clear" rows are already left out */
export type DayMark = "on" | "off";

export interface DayResult {
  date: string;
  /** time at the plant: complete blocks only (sessions.ts), so a "no exit" day is 0 until the owner fixes it */
  minutes: number;
  /** rule 21: time at the plant − the lunch break (workMinutes) */
  workMinutes: number;
  status: DayStatus;
  /** work minutes over the work hours; 0 for people without "Gets overtime" */
  otMinutes: number;
}

/** Rule 21: the lunch break is taken off in full from 5 h at the plant. */
export const LUNCH_FULL_FROM_MINUTES = 300;

/**
 * Rule 21: work = time at the plant − the lunch break. A break the person marked themselves (OUT and IN again,
 * `gapMinutes`) counts towards it. Under 5 h at the plant the break is taken off only past 5 h − break (so with a 1 h
 * break, work stays at 4 h from 4 h to 5 h at the plant): staying longer never gives less work.
 */
export function workMinutes(atPlant: number, lunchMinutes: number, gapMinutes = 0): number {
  const take = Math.max(0, lunchMinutes - gapMinutes);
  const cap = LUNCH_FULL_FROM_MINUTES - take;
  return atPlant <= cap ? atPlant : Math.max(cap, atPlant - take);
}

/**
 * Rules 2, 3, 9 and 21 for each counted day: present (a full day) if work ≥ the work hours, short if there is any work
 * below that, otherwise absent (also with no marks at all). Overtime = work − work hours when positive, exact minutes,
 * only with "Gets overtime". `days` is sessions.ts's workDays() (a night shift is already on the day it started).
 * Rule 20 (v0.26.0, docs/DAY_MARKS_PLAN.md): the owner's day mark decides the day instead: "on" = present, "off" =
 * a day off without pay (rule 22, owner 2026-10-23: paid leave covers it like an absent day). Overtime still comes
 * only from the real IN / OUT times.
 */
export function dayStatuses(days: ReadonlyMap<string, { minutes: number; gapMinutes?: number }>, shiftMinutes: number, counted: readonly string[], getsOvertime: boolean, marks?: ReadonlyMap<string, DayMark>, lunchMinutes = 0): DayResult[] {
  return counted.map((date) => {
    const day = days.get(date);
    const minutes = day?.minutes ?? 0;
    const work = workMinutes(minutes, lunchMinutes, day?.gapMinutes ?? 0);
    const mark = marks?.get(date);
    const byTime: DayStatus = work >= shiftMinutes ? "present" : work > 0 ? "short" : "absent";
    const status: DayStatus = mark === "on" ? "present" : mark === "off" ? "off" : byTime;
    return { date, minutes, workMinutes: work, status, otMinutes: getsOvertime ? Math.max(0, work - shiftMinutes) : 0 };
  });
}

export interface DayCounts {
  present: number;
  /** months frozen before rule 21 only; 0 since */
  half: number;
  absent: number;
  /** rule 20: days off marked by the owner (unpaid since rule 22); missing in figures frozen before v0.26.0 (= 0) */
  off?: number;
  /** rule 21: days with work under the work hours, and their work added up; missing before rule 21 (= 0) */
  short?: number;
  shortMinutes?: number;
  otMinutes: number;
}

export function countDays(days: readonly DayResult[]): DayCounts {
  const c = { present: 0, half: 0, absent: 0, off: 0, short: 0, shortMinutes: 0, otMinutes: 0 };
  for (const d of days) {
    c[d.status] += 1;
    if (d.status === "short") c.shortMinutes += d.workMinutes;
    c.otMinutes += d.otMinutes;
  }
  return c;
}

/** "61h 57m ÷ 8 h = 7.74 days" parts: short-day work as days (rule 21). */
export const shortDaysText = (shortMinutes: number, shiftMinutes: number) => String(Math.round((shortMinutes * 100) / shiftMinutes) / 100);

// ---------- one month's pay (rules 4-10, 12, 13) ----------

/** Everything one month's pay is worked out from. Counts, not marks, so the checking panel can feed typed numbers. */
export interface PayInput extends DayCounts {
  payBasis: PayBasis;
  /** monthly people; 0 for per-day people */
  monthlyPaise: number;
  /** per-day people (rule 15); null for monthly people */
  dayRatePaise: number | null;
  /** rule 21: a full day's work, the divisor of the short-day work (missing before rule 21; only used with short days) */
  shiftMinutes?: number;
  /** employed every day of the month (rule 8) */
  fullMonth: boolean;
  paidLeaveHalfdays: number;
  getsOvertime: boolean;
  otRatePaise: number | null;
  /** rule 10: the month's advance entries added up (corrections are negative) */
  advancesPaise: number;
  /** rules 16-18 (claimTotals): TA, DA and expenses of the month's APPROVED claims */
  taPaise: number;
  daPaise: number;
  expensesPaise: number;
  /** rule 11: taken off this month because last month ended below 0 (a positive number) */
  carriedInPaise: number;
  /** rule 14: "Adjustment from <last month>", + or − */
  adjustmentPaise: number;
}

/**
 * In half-day units, so 2 = one day. Since rule 21 they may be fractions (a short day's missing time): show them with
 * halvesText(), which keeps 2 decimals; the money itself is worked out exactly in minutes.
 */
export interface PayResult {
  /** rule 4: absent + ½ × half days (+ rule 21: the time short days are short of the work hours) */
  absentHalves: number;
  /** rule 5: min(missing days, paid leave per month); unused leave lapses */
  leaveUsedHalves: number;
  /** rule 6 */
  unpaidHalves: number;
  /** rule 7: salary ÷ 30, rounded to the paisa; per day (rule 15): the day rate */
  dayPayPaise: number;
  /** full month: unpaid days × day's pay (taken off the salary); part month: 0 */
  deductionPaise: number;
  /** part month: present + ½ × half days + short-day work ÷ work hours + paid leave used (paid at day's pay); full
   *  month: 0; per day (rule 15): present + ½ × half days + short-day work ÷ work hours */
  paidHalves: number;
  /** rule 8 */
  earnedPaise: number;
  /** rule 9: 0 without "Gets overtime" */
  otMinutes: number;
  otPayPaise: number;
  /** rules 16-18: passed through from the input */
  taPaise: number;
  daPaise: number;
  expensesPaise: number;
  advancesPaise: number;
  carriedInPaise: number;
  adjustmentPaise: number;
  /** rule 12 (19): below 0 carries to the next month */
  remainingPaise: number;
}

export function monthPay(i: PayInput): PayResult {
  const perDay = i.payBasis === "per_day";
  const fixed = i.payBasis === "fixed";
  // Worked in minutes of a full day (rule 21); without short days this is exactly the half-day arithmetic of before.
  const day = i.shiftMinutes || 480;
  const short = i.short ?? 0;
  const shortWork = Math.min(i.shortMinutes ?? 0, short * day);
  const paidMinutes = i.present * day + (i.half * day) / 2 + shortWork;
  // rule 4 (+ rule 21: the time short days are short; rule 22: the owner's days off are not paid, like absent days)
  const missingMinutes = (i.absent + (i.off ?? 0)) * day + (i.half * day) / 2 + (short * day - shortWork);
  const leaveMinutes = perDay || fixed ? 0 : Math.min(missingMinutes, (i.paidLeaveHalfdays * day) / 2); // rule 5 (rule 15: none)
  const unpaidMinutes = fixed ? 0 : missingMinutes - leaveMinutes; // rule 6 (fixed: nothing is ever unpaid)
  const halves = (minutes: number) => (2 * minutes) / day;
  const dayPayPaise = perDay ? (i.dayRatePaise ?? 0) : Math.round(i.monthlyPaise / DAYS_FOR_PAY); // rule 7 / 15
  // rule 8: the day's pay as shown is used, so "unpaid days × day's pay" on the screen adds up exactly
  let deductionPaise = 0;
  let paidHalves = 0;
  let earnedPaise: number;
  if (fixed) {
    // PV_SALARY_FIXED_MONTHLY: the full salary in a full month; a part month pays its counted days at salary ÷ 30
    const countedDays = i.present + i.half + short + i.absent + (i.off ?? 0);
    paidHalves = i.fullMonth ? 0 : 2 * countedDays;
    earnedPaise = i.fullMonth ? i.monthlyPaise : Math.min(i.monthlyPaise, countedDays * dayPayPaise);
  } else if (perDay) {
    // rule 15: day rate × (present + ½ × half days + short-day work ÷ work hours), rounded once; absent days earn
    // nothing; no full / part month difference (the counted days already keep the month inside the employment)
    paidHalves = halves(paidMinutes);
    earnedPaise = Math.round((paidMinutes * dayPayPaise) / day);
  } else if (i.fullMonth) {
    deductionPaise = Math.round((unpaidMinutes * dayPayPaise) / day);
    earnedPaise = Math.max(0, i.monthlyPaise - deductionPaise);
  } else {
    paidHalves = halves(paidMinutes + leaveMinutes);
    earnedPaise = Math.max(0, Math.min(i.monthlyPaise, Math.round(((paidMinutes + leaveMinutes) * dayPayPaise) / day)));
  }
  const absentHalves = halves(missingMinutes);
  const leaveUsedHalves = halves(leaveMinutes);
  const unpaidHalves = halves(unpaidMinutes);
  // rule 9: overtime only with "Gets overtime" and a rate; exact minutes
  const otMinutes = i.getsOvertime && i.otRatePaise && !fixed ? i.otMinutes : 0;
  const otPayPaise = otMinutes ? Math.round((otMinutes * i.otRatePaise!) / 60) : 0;
  // rule 12, extended by rule 19: approved TA, DA and expenses are added
  const remainingPaise = earnedPaise + otPayPaise + i.taPaise + i.daPaise + i.expensesPaise - i.advancesPaise - i.carriedInPaise + i.adjustmentPaise;
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
    taPaise: i.taPaise,
    daPaise: i.daPaise,
    expensesPaise: i.expensesPaise,
    advancesPaise: i.advancesPaise,
    carriedInPaise: i.carriedInPaise,
    adjustmentPaise: i.adjustmentPaise,
    remainingPaise,
  };
}

// ---------- claims: field duty (TA / DA) and expenses (docs/SALARY_EXTRAS_PHASE_PLAN.md rules 16-19) ----------

export type ClaimKind = "field_duty" | "expense";
/** waiting = no decision yet; otherwise the newest decision */
export type ClaimStatus = "waiting" | "approved" | "rejected" | "withdrawn" | "cancelled";

export interface Claim {
  id: string;
  kind: ClaimKind;
  /** "YYYY-MM-DD" (India date); the claim counts in this date's month */
  onDate: string;
  /** field duty only: km in tenths (42.5 km = 425) */
  kmTenths: number | null;
  /** field duty only: "Ask for DA" (v0.24.0); false = TA only that day. Missing / null = asked (as before) */
  wantsDa?: boolean | null;
  /** expenses only */
  amountPaise: number | null;
  note: string;
  status: ClaimStatus;
}

/** A field duty asks for DA unless the person unticked "Ask for DA". */
export const asksDa = (c: { kind: ClaimKind; wantsDa?: boolean | null }) => c.kind === "field_duty" && c.wantsDa !== false;

/** A counted claim as a paid month's slip keeps it. */
export interface FrozenClaim {
  kind: ClaimKind;
  onDate: string;
  kmTenths: number | null;
  /** field duty: DA asked (rules 4+; missing = asked) */
  wantsDa?: boolean | null;
  amountPaise: number | null;
  note: string;
}

export interface ClaimTotals {
  /** dates with approved field duty (two on one date = one day) */
  fieldDutyDays: number;
  /** rule 17: of those, the dates whose field duty asked for DA */
  daDays: number;
  /** rule 16: approved field-duty km added up, in tenths */
  kmTenths: number;
  taPaise: number;
  daPaise: number;
  /** rule 18 */
  expensesPaise: number;
  /** claims still waiting for the owner (count 0) */
  waiting: number;
  /** the approved claims that counted, oldest date first */
  counted: FrozenClaim[];
}

/** "42.5", "182", "0": km from tenths. */
export const kmText = (tenths: number) => String(tenths / 10);

/**
 * Rules 16-18 for one person's month. Only APPROVED claims count; waiting, not approved, withdrawn and cancelled ones
 * count 0. TA = all approved km added up × the TA rate, rounded to the paisa once; DA = the number of dates with
 * approved field duty that asked for DA ("Ask for DA", v0.24.0) × the DA rate; no rate = ₹0 (the km and days still
 * show). Attendance is never touched.
 */
export function claimTotals(claims: readonly Claim[], rates: { kmRatePaise: number | null; daDayPaise: number | null }): ClaimTotals {
  const approved = claims.filter((c) => c.status === "approved").sort((a, b) => (a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0));
  const duty = approved.filter((c) => c.kind === "field_duty");
  const kmTenths = duty.reduce((sum, c) => sum + (c.kmTenths ?? 0), 0);
  const fieldDutyDays = new Set(duty.map((c) => c.onDate)).size;
  const daDays = new Set(duty.filter(asksDa).map((c) => c.onDate)).size;
  return {
    fieldDutyDays,
    daDays,
    kmTenths,
    taPaise: rates.kmRatePaise ? Math.round((kmTenths * rates.kmRatePaise) / 10) : 0,
    daPaise: rates.daDayPaise ? daDays * rates.daDayPaise : 0,
    expensesPaise: approved.filter((c) => c.kind === "expense").reduce((sum, c) => sum + (c.amountPaise ?? 0), 0),
    waiting: claims.filter((c) => c.status === "waiting").length,
    counted: approved.map((c) => ({ kind: c.kind, onDate: c.onDate, kmTenths: c.kmTenths, ...(c.kind === "field_duty" ? { wantsDa: asksDa(c) } : {}), amountPaise: c.amountPaise, note: c.note })),
  };
}

// ---------- the owner's checking panel (docs/SALARY_PHASE_PLAN.md "Owner: checking panel") ----------

/** The panel's boxes: days, hours and rupees as typed. */
export type PanelField = "ta" | "da" | "expenses" | "monthly" | "dayRate" | "present" | "half" | "short" | "shortHours" | "absent" | "off" | "leave" | "otHours" | "otRate" | "advances" | "carried";

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
    // rule 21: short days and their work in hours
    short: n("short", auto.short ?? 0),
    shortMinutes: Math.round(n("shortHours", (auto.shortMinutes ?? 0) / 60) * 60),
    absent: n("absent", auto.absent),
    off: n("off", auto.off ?? 0),
    paidLeaveHalfdays: Math.round(n("leave", auto.paidLeaveHalfdays / 2) * 2),
    otMinutes: Math.round(n("otHours", auto.otMinutes / 60) * 60),
    otRatePaise: auto.getsOvertime ? paise("otRate", auto.otRatePaise ?? 0) : auto.otRatePaise,
    advancesPaise: paise("advances", auto.advancesPaise),
    // claims (rules 16-18): the month's TA, DA and approved expenses in rupees
    taPaise: paise("ta", auto.taPaise),
    daPaise: paise("da", auto.daPaise),
    expensesPaise: paise("expenses", auto.expensesPaise),
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
  /** the salary type the month was worked out with (rules 6+; missing before = no name) */
  band?: string;
  month: string;
  setting: { payBasis: PayBasis; monthlyPaise: number | null; dayRatePaise: number | null; kmRatePaise: number | null; daDayPaise: number | null; shiftMinutes: number; lunchMinutes?: number; paidLeaveHalfdays: number; getsOvertime: boolean; otRatePaise: number | null; joinedOn: string | null; leftOn: string | null };
  counted: Counted;
  counts: DayCounts;
  advances: FrozenAdvance[];
  /** rules 16-18: the approved claims that counted, with the field-duty days and km (rules 3+; empty before) */
  claims: FrozenClaim[];
  fieldDutyDays: number;
  /** rule 17: field-duty days with DA (rules 4+; before, every field-duty day had DA) */
  daDays: number;
  kmTenths: number;
  adjustmentFrom: string | null;
  /** exactly what monthPay() was given, and what it gave */
  input: PayInput;
  result: PayResult;
}

/**
 * A paid month's saved figures as this version reads them. Months frozen with `rules: 1` (before per-day pay) have no
 * pay basis: they read as monthly; months frozen before claims (`rules` 1-2) have no TA, DA, expenses or claims: they
 * read as ₹0 and none; months frozen before "Ask for DA" (`rules` 3) had DA on every field-duty day; months frozen before
 * rule 21 (`rules` 1-5) had half days, no lunch break and no short days. The saved numbers are shown as they are, never
 * worked out again.
 */
export function readFrozen(f: FrozenMonth): FrozenMonth {
  if (f.rules >= RULES_VERSION) return f;
  const noClaims = { taPaise: 0, daPaise: 0, expensesPaise: 0 };
  return {
    ...f,
    setting: { ...f.setting, payBasis: f.setting.payBasis ?? "monthly", dayRatePaise: f.setting.dayRatePaise ?? null, kmRatePaise: f.setting.kmRatePaise ?? null, daDayPaise: f.setting.daDayPaise ?? null, lunchMinutes: f.setting.lunchMinutes ?? 0 },
    claims: f.claims ?? [],
    fieldDutyDays: f.fieldDutyDays ?? 0,
    daDays: f.daDays ?? f.fieldDutyDays ?? 0,
    kmTenths: f.kmTenths ?? 0,
    counts: { short: 0, shortMinutes: 0, ...f.counts },
    input: { ...noClaims, short: 0, shortMinutes: 0, shiftMinutes: f.setting.shiftMinutes, ...f.input, payBasis: f.input.payBasis ?? "monthly", dayRatePaise: f.input.dayRatePaise ?? null },
    result: { ...noClaims, ...f.result },
  };
}

// The owner's Salary tab and its CSV (docs/SALARY_PHASE_PLAN.md "Owner: Salary tab"): one row per person on salary in
// a month, worked out live by src/lib/salary.ts (through salaryMonths), the totals, and the active Plant staff without
// a salary. Owner and PlantOps support see the tab (`salary_view`); only the owner downloads the CSV (`salary_export`,
// audited). Nothing is stored.
import { csv } from "@plantops/module-kit/csv";
import { addMonths, monthDays } from "@/lib/days";
import { halvesText, hoursText, kmText, type DayCounts, type PayBasis, type PayInput, type PayResult } from "@/lib/salary";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { withTenant } from "./db";
import { staffList, type Person } from "./people";
import { frozenOf, payInputOf, salaryMonths } from "./salary";
import { payableFrom } from "./salary-pay";
import { visibilityMap } from "./salary-slip";
import type { StaffType } from "./schema";
import type { AtUser } from "./session";

export interface TabRow {
  userId: string;
  name: string;
  /** on salary this month but no longer active Plant staff */
  former: boolean;
  fullMonth: boolean;
  /** days counted so far (rule 1) */
  countedDays: number;
  /** monthly or per day (rule 15); from the frozen figures for a paid month */
  payBasis: PayBasis;
  /** Permanent / Temporary from the month's setting (docs/ATTENDANCE_ROLES_PHASE_PLAN.md R4); never in the rules */
  staffType: StaffType;
  /** per-day people's day rate (null for monthly people) */
  dayRatePaise: number | null;
  shiftMinutes: number;
  paidLeaveHalfdays: number;
  getsOvertime: boolean;
  otRatePaise: number | null;
  counts: DayCounts;
  /** the automatic input to monthPay (with the carry and adjustment from the months before) */
  input: PayInput;
  result: PayResult;
  /** the month the carry / adjustment comes from */
  prevMonth: string;
  adjustmentFrom: string | null;
  /** remaining below 0: the month it carries to */
  carriesTo: string | null;
  /** the month ticked Paid (not undone); the row then shows the FROZEN figures */
  payment: { id: string; paidOn: string; paidPaise: number; byName: string; note: string | null } | null;
  /** paid months: live remaining − frozen remaining ("Changed after payment"), goes to the next month */
  changedPaise: number;
  /** "Can see own salary" for this person */
  canSee: boolean;
  /** claims (rules 16-18): the month's rates, approved field-duty days and km, and claims still waiting */
  kmRatePaise: number | null;
  daDayPaise: number | null;
  fieldDutyDays: number;
  kmTenths: number;
  claimsWaiting: number;
}

export interface SalaryTab {
  month: string;
  prev: string;
  /** null when this is the current month (no arrow into the future) */
  next: string | null;
  monthLength: number;
  /** days of the month that are over (= monthLength when complete) */
  daysOver: number;
  complete: boolean;
  rows: TabRow[];
  totals: { salaryPaise: number; earnedPaise: number; otPayPaise: number; taPaise: number; daPaise: number; expensesPaise: number; advancesPaise: number; carriedInPaise: number; remainingPaise: number; toPayPaise: number };
  /**
   * The manpower cost split by staff type (mock-up 9): people, cost = earned + overtime + TA + DA + expenses, and
   * remaining to pay (positive remainders), each the sum of that type's rows.
   */
  split: Record<StaffType, { people: number; costPaise: number; toPayPaise: number }>;
  /** claims still waiting for the owner in this month (the "Review" banner) */
  claimsWaiting: number;
  /** "Ramu −₹2,100 carries to November" parts */
  negatives: { name: string; remainingPaise: number; to: string }[];
  /** active Plant staff with no salary this month (null = the platform couldn't be reached) */
  noSalary: Person[] | null;
  /** the month can be ticked Paid (from its last day) */
  payable: boolean;
  /** "2026-10-31" */
  payableFrom: string;
  today: string;
  /** paid this month (sum of paid amounts) and the positive remainders not yet paid */
  paidPaise: number;
  stillToPayPaise: number;
}

/** One person's manpower cost for the month: earned + overtime + TA + DA + expenses (advances are not a cost). */
export const costOf = (r: TabRow) => r.result.earnedPaise + r.result.otPayPaise + r.result.taPaise + r.result.daPaise + r.result.expensesPaise;

/** Owner and PlantOps support: the month's table. A bad or future month: 404. */
export async function salaryTab(user: AtUser, month: string, now: Date = new Date()): Promise<SalaryTab> {
  requireAccess(user, "salary_view");
  const view = await salaryMonths(user, month, { now });
  const staff = await staffList(user);
  const active = new Set(staff.active.map((p) => p.userId));
  const visible = await withTenant(user.tenantId, (tx) => visibilityMap(tx, user.tenantId));
  const rows: TabRow[] = [];
  for (const p of view.people) {
    const c = p.current;
    if (!c) continue;
    const frozen = c.payment ? frozenOf(c.payment.figures) : null;
    const r = frozen?.result ?? c.chain.live;
    const counts = frozen?.counts ?? c.counts;
    const input = frozen?.input ?? payInputOf(c);
    rows.push({
      userId: p.userId,
      name: p.name,
      former: !staff.platformDown && !active.has(p.userId),
      fullMonth: c.counted.fullMonth,
      countedDays: c.counted.dates.length,
      payBasis: input.payBasis,
      staffType: c.setting.staffType ?? "permanent",
      dayRatePaise: input.dayRatePaise,
      shiftMinutes: c.setting.shiftMinutes,
      paidLeaveHalfdays: c.setting.paidLeaveHalfdays,
      getsOvertime: c.setting.getsOvertime,
      otRatePaise: c.setting.otRatePaise,
      counts,
      input,
      result: r,
      prevMonth: addMonths(month, -1),
      adjustmentFrom: frozen ? frozen.adjustmentFrom : c.chain.adjustmentFrom,
      carriesTo: r.remainingPaise < 0 ? addMonths(month, 1) : null,
      payment: c.payment ? { id: c.payment.paymentId, paidOn: c.payment.paidOn, paidPaise: c.payment.paidPaise, byName: c.payment.createdByName, note: c.payment.note } : null,
      changedPaise: c.chain.changedPaise,
      canSee: visible.get(p.userId) ?? false,
      // a paid month shows what was frozen; waiting claims are always the live count (they don't count either way)
      kmRatePaise: frozen ? frozen.setting.kmRatePaise : c.setting.kmRatePaise,
      daDayPaise: frozen ? frozen.setting.daDayPaise : c.setting.daDayPaise,
      fieldDutyDays: frozen ? frozen.fieldDutyDays : c.claimTotals.fieldDutyDays,
      kmTenths: frozen ? frozen.kmTenths : c.claimTotals.kmTenths,
      claimsWaiting: c.claimTotals.waiting,
    });
  }
  const sum = (f: (r: TabRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const onSalary = new Set(rows.map((r) => r.userId));
  const days = monthDays(month);
  const daysOver = days.filter((d) => d < view.today).length;
  return {
    month,
    prev: addMonths(month, -1),
    next: month === view.today.slice(0, 7) ? null : addMonths(month, 1),
    monthLength: days.length,
    daysOver,
    complete: daysOver === days.length,
    rows,
    totals: {
      // monthly salaries only: a day rate isn't a month's salary (per-day people add 0)
      salaryPaise: sum((r) => r.input.monthlyPaise),
      earnedPaise: sum((r) => r.result.earnedPaise),
      otPayPaise: sum((r) => r.result.otPayPaise),
      taPaise: sum((r) => r.result.taPaise),
      daPaise: sum((r) => r.result.daPaise),
      expensesPaise: sum((r) => r.result.expensesPaise),
      advancesPaise: sum((r) => r.result.advancesPaise),
      carriedInPaise: sum((r) => r.result.carriedInPaise),
      remainingPaise: sum((r) => r.result.remainingPaise),
      toPayPaise: sum((r) => Math.max(0, r.result.remainingPaise)),
    },
    split: Object.fromEntries(
      (["permanent", "temporary"] as const).map((type) => {
        const of = rows.filter((r) => r.staffType === type);
        const s = (f: (r: TabRow) => number) => of.reduce((n, r) => n + f(r), 0);
        return [type, { people: of.length, costPaise: s(costOf), toPayPaise: s((r) => Math.max(0, r.result.remainingPaise)) }];
      }),
    ) as SalaryTab["split"],
    claimsWaiting: sum((r) => r.claimsWaiting),
    negatives: rows.filter((r) => r.carriesTo).map((r) => ({ name: r.name, remainingPaise: r.result.remainingPaise, to: r.carriesTo! })),
    noSalary: staff.platformDown ? null : staff.active.filter((p) => !onSalary.has(p.userId)),
    payable: view.today >= payableFrom(month),
    payableFrom: payableFrom(month),
    today: view.today,
    paidPaise: sum((r) => r.payment?.paidPaise ?? 0),
    stillToPayPaise: sum((r) => (r.payment ? 0 : Math.max(0, r.result.remainingPaise))),
  };
}

export const SALARY_CSV_HEADER = [
  "Name", "Month", "Full or part month", "Counted days",
  "Monthly salary", "Pay basis", "Staff type", "Day rate", "Shift hours", "Paid leave allowed (days)",
  "Present", "Half days", "Absent", "Paid leave used (days)", "Unpaid days", "Day's pay", "Earned",
  "Overtime", "Overtime hours", "Overtime rate", "Overtime pay",
  "Field duty days", "Km", "TA rate", "TA", "DA rate", "DA", "Expenses", "Claims waiting",
  "Advances", "Carried in", "Adjustment", "Remaining",
];

/** Paise as a spreadsheet number: 1120000 -> "11200.00", -210000 -> "-2100.00". */
const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Owner: the month's salary table as CSV text, one row per person. Audited; cells can never run as formulas. */
export async function salaryCsv(user: AtUser, month: string, now: Date = new Date()) {
  requireAccess(user, "salary_export");
  const tab = await salaryTab(user, month, now);
  const rows: unknown[][] = [SALARY_CSV_HEADER];
  for (const r of tab.rows) {
    const x = r.result;
    // per-day people (rule 15): no monthly salary and no paid leave, so those cells stay blank
    const perDay = r.payBasis === "per_day";
    rows.push([
      r.name,
      month,
      r.fullMonth ? "full" : "part",
      r.countedDays,
      perDay ? "" : rupees(r.input.monthlyPaise),
      perDay ? "per day" : "monthly",
      r.staffType,
      perDay && r.dayRatePaise ? rupees(r.dayRatePaise) : "",
      hoursText(r.shiftMinutes),
      perDay ? "" : halvesText(r.paidLeaveHalfdays),
      r.counts.present,
      r.counts.half,
      r.counts.absent,
      perDay ? "" : halvesText(x.leaveUsedHalves),
      perDay ? "" : halvesText(x.unpaidHalves),
      rupees(x.dayPayPaise),
      rupees(x.earnedPaise),
      r.getsOvertime ? "yes" : "no",
      r.getsOvertime ? hoursText(x.otMinutes) : "",
      r.getsOvertime && r.otRatePaise ? rupees(r.otRatePaise) : "",
      r.getsOvertime ? rupees(x.otPayPaise) : "",
      // claims (rules 16-18): blank rate = this person gets no TA / DA that month
      r.fieldDutyDays,
      kmText(r.kmTenths),
      r.kmRatePaise ? rupees(r.kmRatePaise) : "",
      rupees(x.taPaise),
      r.daDayPaise ? rupees(r.daDayPaise) : "",
      rupees(x.daPaise),
      rupees(x.expensesPaise),
      r.claimsWaiting,
      rupees(x.advancesPaise),
      rupees(x.carriedInPaise),
      rupees(x.adjustmentPaise),
      rupees(x.remainingPaise),
    ]);
  }
  await withTenant(user.tenantId, (tx) => audit(tx, user, "salary.export", null, { month, people: tab.rows.length }));
  return csv(rows);
}

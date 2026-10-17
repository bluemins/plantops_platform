// Salary worked out from the database (docs/SALARY_PHASE_PLAN.md "The rules"): the person's settings history,
// advances, paid months and marks are loaded, then sessions.ts (worked time) and lib/salary.ts (money) run month by
// month from their first salary month, so a carry or a later change flows through. Nothing worked out is stored.
// Access: the Salary tab and the salary sections need `salary_view` (owner; support read-only). A worker's own slips
// come from the frozen figures of paid months (Phase 5), not from here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { addMonths, istDay, istMonth, monthDays, validMonth } from "@/lib/days";
import {
  RULES_VERSION,
  carryChain,
  claimTotals,
  countDays,
  countedDates,
  dayStatuses,
  firstSalaryMonth,
  readFrozen,
  settingFor,
  type ChainMonth,
  type ClaimTotals,
  type Counted,
  type DayCounts,
  type DayResult,
  type DayStatus,
  type FrozenMonth,
  type PaidMonth,
  type PayInput,
  type SalarySetting,
} from "@/lib/salary";
import { workDays } from "@/lib/sessions";
import { can, requireAccess } from "./access";
import { loadClaims, type ClaimRow } from "./claims";
import { schema, withTenant, type AtTx } from "./db";
import type { StaffType } from "./schema";
import { notFound } from "./http";
import { loadMarks } from "./people";
import type { AtUser } from "./session";

const { salarySettings, salaryAdvances, salaryPayments, salaryPaymentUndos } = schema;

export interface SettingRow extends SalarySetting {
  userId: string;
  /** Permanent / Temporary (docs/ATTENDANCE_ROLES_PHASE_PLAN.md R4): only for the cost split, never in the rules */
  staffType: StaffType;
  userName: string;
  reason: string | null;
  createdByName: string;
}

export interface AdvanceRow {
  id: string;
  userId: string;
  onDate: string;
  amountPaise: number;
  note: string | null;
  correctsId: string | null;
  reason: string | null;
  createdByName: string;
  createdAt: Date;
}

export interface PaymentRow extends PaidMonth {
  userId: string;
  /** "YYYY-MM" */
  month: string;
  figures: Record<string, unknown>;
  note: string | null;
  createdByName: string;
  createdAt: Date;
}

export interface SalaryData {
  settings: SettingRow[];
  advances: AdvanceRow[];
  /** paid months that are not undone */
  payments: PaymentRow[];
  /** claims with their status (only approved ones count: rules 16-19) */
  claims: ClaimRow[];
}

const ym = (date: string) => date.slice(0, 7);

/** One person's (or the whole plant's) settings, advances and paid months that are not undone. */
export async function loadSalaryData(tx: AtTx, tenantId: string, personId?: string): Promise<SalaryData> {
  const person = (col: typeof salarySettings.userId | typeof salaryAdvances.userId | typeof salaryPayments.userId) => (personId ? eq(col, personId) : sql`true`);
  const settings = await tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, tenantId), person(salarySettings.userId))).orderBy(salarySettings.createdAt);
  const advances = await tx.select().from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, tenantId), person(salaryAdvances.userId))).orderBy(salaryAdvances.onDate, salaryAdvances.createdAt);
  const payments = await tx.select().from(salaryPayments).where(and(eq(salaryPayments.tenantId, tenantId), person(salaryPayments.userId))).orderBy(salaryPayments.createdAt);
  const ids = payments.map((p) => p.id);
  const undone = new Set(
    ids.length
      ? (await tx.select({ id: salaryPaymentUndos.paymentId }).from(salaryPaymentUndos).where(and(eq(salaryPaymentUndos.tenantId, tenantId), inArray(salaryPaymentUndos.paymentId, ids)))).map((u) => u.id)
      : [],
  );
  const claims = await loadClaims(tx, tenantId, { personId });
  return {
    settings: settings.map((r) => ({ ...r, fromMonth: ym(r.fromMonth) })),
    advances,
    claims,
    payments: payments
      .filter((p) => !undone.has(p.id))
      .map((p) => ({ paymentId: p.id, userId: p.userId, month: ym(p.month), paidOn: p.paidOn, paidPaise: p.paidPaise, remainingPaise: p.remainingPaise, figures: p.figures, note: p.note, createdByName: p.createdByName, createdAt: p.createdAt })),
  };
}

/** One month of one person, everything the screens and the CSV need. */
export interface SalaryMonth {
  month: string;
  setting: SettingRow;
  counted: Counted;
  days: DayResult[];
  counts: DayCounts;
  /** the month's advance entries (corrections included, negative) */
  advances: AdvanceRow[];
  /** the paid month's row (null when not paid, or undone) */
  payment: PaymentRow | null;
  /** the month's claims, every status (dated in this month) */
  claims: ClaimRow[];
  /** rules 16-18 from the approved ones, at this month's TA / DA rates */
  claimTotals: ClaimTotals;
  chain: ChainMonth;
}

export interface PersonSalary {
  userId: string;
  /** the newest name copied on their salary settings */
  name: string;
  /** every salary month from the first one up to the asked month, oldest first */
  months: SalaryMonth[];
  /** the asked month (null = not on salary that month) */
  current: SalaryMonth | null;
}

/** Works out one person's months up to `month` from already-loaded rows (also used for the whole plant). */
function personMonths(userId: string, data: SalaryData, days: ReadonlyMap<string, { minutes: number }>, month: string, today: string): PersonSalary {
  const settings = data.settings.filter((s) => s.userId === userId);
  const first = firstSalaryMonth(settings)!;
  const months: Omit<SalaryMonth, "chain">[] = [];
  for (let m = first; m <= month; m = addMonths(m, 1)) {
    const setting = settingFor(settings, m)!;
    // rule 1: Joined on blank = the first day of the first salary month
    const counted = countedDates(m, today, setting.joinedOn ?? `${first}-01`, setting.leftOn);
    if (!counted) continue; // not employed on any day of this month
    const dayResults = dayStatuses(days, setting.shiftMinutes, counted.dates, setting.getsOvertime);
    const claims = data.claims.filter((c) => c.userId === userId && ym(c.onDate) === m);
    months.push({
      month: m,
      setting,
      counted,
      days: dayResults,
      counts: countDays(dayResults),
      advances: data.advances.filter((a) => a.userId === userId && ym(a.onDate) === m),
      payment: data.payments.filter((p) => p.userId === userId && p.month === m).at(-1) ?? null,
      claims,
      claimTotals: claimTotals(claims, setting),
    });
  }
  const chain = carryChain(
    months.map((x) => ({
      month: x.month,
      paid: x.payment,
      input: {
        ...x.counts,
        payBasis: x.setting.payBasis,
        monthlyPaise: x.setting.monthlyPaise ?? 0,
        dayRatePaise: x.setting.dayRatePaise,
        fullMonth: x.counted.fullMonth,
        paidLeaveHalfdays: x.setting.paidLeaveHalfdays,
        getsOvertime: x.setting.getsOvertime,
        otRatePaise: x.setting.otRatePaise,
        advancesPaise: x.advances.reduce((sum, a) => sum + a.amountPaise, 0),
        taPaise: x.claimTotals.taPaise,
        daPaise: x.claimTotals.daPaise,
        expensesPaise: x.claimTotals.expensesPaise,
      },
    })),
  );
  const full = months.map((x, i) => ({ ...x, chain: chain[i]! }));
  return { userId, name: settings.at(-1)!.userName, months: full, current: full.find((x) => x.month === month) ?? null };
}

export interface SalaryView {
  month: string;
  today: string;
  /** everyone with a salary setting, A-Z; `current` is null for people not on salary in this month */
  people: PersonSalary[];
}

/**
 * The asked month (and every month before it, for the carry) for one person or everyone with a salary setting.
 * Owner and PlantOps support only (`salary_view`). A bad or future month: 404.
 */
export async function salaryMonths(user: AtUser, month: string, opts: { personId?: string; now?: Date } = {}): Promise<SalaryView> {
  requireAccess(user, "salary_view");
  return salaryMonthsOf(user.tenantId, month, opts);
}

/** salaryMonths without the access check: only for callers that show no salary (Office staff's "still to recover"). */
export async function salaryMonthsOf(tenantId: string, month: string, opts: { personId?: string; now?: Date } = {}): Promise<SalaryView> {
  const now = opts.now ?? new Date();
  if (!validMonth(month) || month > istMonth(now)) throw notFound("Not found");
  const today = istDay(now);
  return withTenant(tenantId, async (tx) => {
    const data = await loadSalaryData(tx, tenantId, opts.personId);
    const userIds = [...new Set(data.settings.map((s) => s.userId))];
    const firsts = userIds.map((id) => firstSalaryMonth(data.settings.filter((s) => s.userId === id))!).filter((f) => f <= month);
    if (firsts.length === 0) return { month, today, people: [] };
    const from = firsts.reduce((a, b) => (a < b ? a : b));
    const loaded = await loadMarks(tx, tenantId, `${from}-01`, monthDays(month).at(-1)!, opts.personId);
    const people = userIds
      .filter((id) => firstSalaryMonth(data.settings.filter((s) => s.userId === id))! <= month)
      .map((id) => {
        const l = loaded.get(id);
        return personMonths(id, data, workDays(l?.marks ?? [], l?.cancels ?? [], now), month, today);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    return { month, today, people };
  });
}

/** The month's monthPay() input as it stands now (with the carry and adjustment from the months before). */
export function payInputOf(c: SalaryMonth): PayInput {
  const r = c.chain.live;
  return {
    ...c.counts,
    payBasis: c.setting.payBasis,
    monthlyPaise: c.setting.monthlyPaise ?? 0,
    dayRatePaise: c.setting.dayRatePaise,
    fullMonth: c.counted.fullMonth,
    paidLeaveHalfdays: c.setting.paidLeaveHalfdays,
    getsOvertime: c.setting.getsOvertime,
    otRatePaise: c.setting.otRatePaise,
    advancesPaise: r.advancesPaise,
    taPaise: r.taPaise,
    daPaise: r.daPaise,
    expensesPaise: r.expensesPaise,
    carriedInPaise: r.carriedInPaise,
    adjustmentPaise: r.adjustmentPaise,
  };
}

/** Rule 14: the month's calculation exactly as it stands, to be saved with a payment (the slip shows only this). */
export function freezeMonth(c: SalaryMonth): FrozenMonth {
  const s = c.setting;
  return {
    rules: RULES_VERSION,
    month: c.month,
    setting: { payBasis: s.payBasis, monthlyPaise: s.monthlyPaise, dayRatePaise: s.dayRatePaise, kmRatePaise: s.kmRatePaise, daDayPaise: s.daDayPaise, shiftMinutes: s.shiftMinutes, paidLeaveHalfdays: s.paidLeaveHalfdays, getsOvertime: s.getsOvertime, otRatePaise: s.otRatePaise, joinedOn: s.joinedOn, leftOn: s.leftOn },
    counted: c.counted,
    counts: c.counts,
    advances: c.advances.map((a) => ({ onDate: a.onDate, amountPaise: a.amountPaise, note: a.amountPaise < 0 ? `Correction: ${a.reason ?? ""}` : a.note })),
    // rules 16-18: the approved claims that counted (the slip lists them; waiting / not approved ones are left out)
    claims: c.claimTotals.counted,
    fieldDutyDays: c.claimTotals.fieldDutyDays,
    kmTenths: c.claimTotals.kmTenths,
    adjustmentFrom: c.chain.adjustmentFrom,
    input: payInputOf(c),
    result: c.chain.live,
  };
}

/** A payment's saved figures, if they are a full frozen month (rows written by hand in tests may not be); months
 *  frozen before per-day pay (`rules: 1`) read as monthly. */
export const frozenOf = (figures: Record<string, unknown>): FrozenMonth | null =>
  figures && typeof figures === "object" && "input" in figures && "result" in figures ? readFrozen(figures as unknown as FrozenMonth) : null;

/** What a calendar may show about a month's days: statuses and counts only, never an amount, rate or shift. */
export interface MonthStatuses {
  days: Record<string, { status: DayStatus; otMinutes: number }>;
  counts: DayCounts;
  /** the person gets overtime this month (otherwise no overtime is shown anywhere) */
  getsOvertime: boolean;
  /** every day of the month is over */
  complete: boolean;
  /** days counted so far */
  countedDays: number;
}

/**
 * Present / half / absent and overtime for the calendar (docs/SALARY_PHASE_PLAN.md "Worker: My attendance"): the same
 * rules as the salary (shift hours, Gets overtime, Joined on / Last day from the month's setting), but only days come
 * back, never money. Your own month needs `see_own`, anyone else's `see_everyone` (otherwise 404). null = no salary
 * setting that month (the calendar then stays plain).
 */
export async function monthStatuses(user: AtUser, personId: string, month: string, days: ReadonlyMap<string, { minutes: number }>, now: Date = new Date()): Promise<MonthStatuses | null> {
  const own = personId === user.userId;
  if (!(own ? can(user, "see_own") || can(user, "see_everyone") : can(user, "see_everyone"))) throw notFound("Not found");
  const rows = await withTenant(user.tenantId, (tx) =>
    tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, user.tenantId), eq(salarySettings.userId, personId))),
  );
  const settings = rows.map((r) => ({ ...r, fromMonth: ym(r.fromMonth) }));
  const setting = settingFor(settings, month);
  if (!setting) return null;
  const counted = countedDates(month, istDay(now), setting.joinedOn ?? `${firstSalaryMonth(settings)}-01`, setting.leftOn);
  if (!counted) return null;
  const results = dayStatuses(days, setting.shiftMinutes, counted.dates, setting.getsOvertime);
  return {
    days: Object.fromEntries(results.map((d) => [d.date, { status: d.status, otMinutes: d.otMinutes }])),
    counts: countDays(results),
    getsOvertime: setting.getsOvertime,
    complete: counted.complete,
    countedDays: counted.dates.length,
  };
}

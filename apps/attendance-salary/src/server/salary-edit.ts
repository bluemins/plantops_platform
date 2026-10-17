// The owner's salary entries on Staff -> person (docs/SALARY_PHASE_PLAN.md "Owner: Staff -> person page"): the salary
// setting, "Can see own salary" and advances. Owner only (`salary_edit`); PlantOps support reads them (`salary_view`).
// Every save is a NEW row (the salary tables are append-only in the database) plus an audit row for Recent changes.
// The page sends the id of the newest row it saw; if someone saved in between the answer is 409 and the page reloads.
// The plant, the person and their name come from the session and the server, never from the browser.
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { addMonths, istDay, istMonth, validDay, validMonth } from "@/lib/days";
import { firstSalaryMonth, paiseText, settingFor, toPaise, type PayBasis } from "@/lib/salary";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { dbNow, lockPerson } from "./marks";
import { knownPerson, type Person } from "./people";
import { salaryMonths, type SalaryMonth } from "./salary";
import type { AtUser } from "./session";

const { salarySettings, salaryAdvances, salaryVisibility } = schema;

/** ₹1 crore, the largest salary or advance (the database checks it too). */
const MAX_PAISE = 1_000_000_000;
/** ₹1,00,000 an hour: a typo stops here with a plain message. */
const MAX_OT_RATE_PAISE = 10_000_000;
/** ₹1,00,000 a day, the largest day rate (the database checks it too). */
const MAX_DAY_RATE_PAISE = 10_000_000;

const Expect = z.uuid().nullable();
const OptDay = z
  .string()
  .nullish()
  .transform((s) => s?.trim() || null)
  .refine((s) => s === null || validDay(s), "Not a date");
const Text = (max: number, what: string) =>
  z
    .string()
    .nullish()
    .transform((s) => s?.trim() || null)
    .refine((s) => s === null || s.length <= max, `The ${what} is at most ${max} characters`);
const Reason = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(3, "Write a reason (at least 3 characters)").max(300, "The reason is at most 300 characters"));

/** Typed rupees -> paise, or 400 with a plain message. */
function rupees(typed: string, what: string, max = MAX_PAISE) {
  const p = toPaise(typed);
  if (p === null) throw badRequest(`${what}: write rupees like 12000 or 12000.50 (no commas)`);
  if (p <= 0) throw badRequest(`${what} must be more than ₹0`);
  if (p > max) throw badRequest(`${what} is at most ${paiseText(max)}`);
  return p;
}

const sameMoment = (by: string | null) => conflict(`Just changed by ${by ?? "someone"}. The page has been refreshed: check it and try again.`);

/** The person's newest row in one of the salary tables, for the 409 check. */
async function newest(tx: AtTx, table: typeof salarySettings | typeof salaryAdvances | typeof salaryVisibility, tenantId: string, personId: string) {
  const [row] = await tx
    .select({ id: table.id, by: table.createdByName })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.userId, personId)))
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(1);
  return row ?? null;
}

async function checkNewest(tx: AtTx, table: Parameters<typeof newest>[1], user: AtUser, personId: string, expect: string | null) {
  const now = await newest(tx, table, user.tenantId, personId);
  if ((now?.id ?? null) !== expect) throw sameMoment(now?.by ?? null);
}

/** Owner only, and the person must be one of the plant's people (404 otherwise). */
async function editablePerson(user: AtUser, personId: string): Promise<Person> {
  requireAccess(user, "salary_edit");
  return knownPerson(user, personId);
}

const nameOf = (p: Person) => p.name.slice(0, 100);
const byName = (u: AtUser) => u.name.slice(0, 100);

// ---------- salary setting ----------

export const SettingInput = z.object({
  user_id: z.uuid(),
  /** "monthly" (salary ÷ 30, paid leave) or "per_day" (a day rate, no paid leave; rule 15) */
  pay_basis: z.enum(["monthly", "per_day"]).default("monthly"),
  /** rupees as typed; monthly only */
  monthly: z.string().max(20).nullish(),
  /** rupees as typed; per day only */
  day_rate: z.string().max(20).nullish(),
  shift_hours: z.number(),
  /** monthly only; per day always saves 0 */
  leave_days: z.number().nullish(),
  gets_overtime: z.boolean(),
  ot_rate: z.string().max(20).nullish(),
  /** "YYYY-MM" */
  from_month: z.string().refine(validMonth, "Not a month"),
  joined_on: OptDay,
  left_on: OptDay,
  reason: z.string().max(300).nullish(),
  expect: Expect,
});

/** Owner: a new salary setting for a person, from a month on (a new row; the old ones stay as history). */
export async function saveSetting(user: AtUser, input: z.infer<typeof SettingInput>) {
  const person = await editablePerson(user, input.user_id);
  const perDay = input.pay_basis === "per_day";
  // only the fields of the chosen basis count; the other one is saved empty whatever the browser sent
  const monthlyPaise = perDay ? null : rupees(input.monthly ?? "", "Monthly salary");
  const dayRatePaise = perDay ? rupees(input.day_rate ?? "", "Day rate", MAX_DAY_RATE_PAISE) : null;
  const shiftMinutes = Math.round(input.shift_hours * 60);
  if (!(input.shift_hours >= 1 && input.shift_hours <= 16) || shiftMinutes % 30 !== 0 || shiftMinutes !== input.shift_hours * 60) {
    throw badRequest("Shift hours: 1 to 16, in steps of half an hour (8 or 8.5)");
  }
  const leaveDays = perDay ? 0 : (input.leave_days ?? 2); // rule 15: no paid leave for per-day pay
  const halves = leaveDays * 2;
  if (!(leaveDays >= 0 && leaveDays <= 10) || !Number.isInteger(halves)) throw badRequest("Paid leave: 0 to 10 days, in steps of half a day");
  const otRatePaise = input.gets_overtime ? rupees(input.ot_rate ?? "", "Overtime rate", MAX_OT_RATE_PAISE) : null;
  if (input.joined_on && input.left_on && input.left_on < input.joined_on) throw badRequest("The last day can't be before the joining day");
  const reason = input.reason?.trim() || null;
  if (reason && (reason.length < 3 || reason.length > 300)) throw badRequest("Write a reason (at least 3 characters)");

  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    if (input.from_month < istMonth(await dbNow(tx)) && !reason) {
      throw badRequest("From month is in the past: write a reason (it changes figures already worked out)");
    }
    await checkNewest(tx, salarySettings, user, person.userId, input.expect);
    const [row] = await tx
      .insert(salarySettings)
      .values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: nameOf(person),
        fromMonth: `${input.from_month}-01`,
        payBasis: input.pay_basis,
        monthlyPaise,
        dayRatePaise,
        shiftMinutes,
        paidLeaveHalfdays: halves,
        getsOvertime: input.gets_overtime,
        otRatePaise,
        joinedOn: input.joined_on,
        leftOn: input.left_on,
        reason,
        createdBy: user.userId,
        createdByName: byName(user),
      })
      .returning({ id: salarySettings.id });
    await audit(tx, user, "salary.set", row!.id, {
      person: person.name,
      from: input.from_month,
      basis: input.pay_basis,
      monthly: monthlyPaise,
      day_rate: dayRatePaise,
      shift: shiftMinutes,
      leave: halves,
      ot_rate: otRatePaise,
      joined: input.joined_on,
      left: input.left_on,
      reason,
    });
    return { id: row!.id };
  });
}

// ---------- Can see own salary ----------

export const VisibilityInput = z.object({ user_id: z.uuid(), can_see: z.boolean(), expect: Expect });

/** Owner: turn "Can see own salary" on or off for a person (a new row only when it really changes). */
export async function saveVisibility(user: AtUser, input: z.infer<typeof VisibilityInput>) {
  const person = await editablePerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    await checkNewest(tx, salaryVisibility, user, person.userId, input.expect);
    const [now] = await tx
      .select({ canSee: salaryVisibility.canSee })
      .from(salaryVisibility)
      .where(and(eq(salaryVisibility.tenantId, user.tenantId), eq(salaryVisibility.userId, person.userId)))
      .orderBy(desc(salaryVisibility.createdAt), desc(salaryVisibility.id))
      .limit(1);
    if ((now?.canSee ?? false) === input.can_see) return { id: input.expect, changed: false };
    const [row] = await tx
      .insert(salaryVisibility)
      .values({ tenantId: user.tenantId, userId: person.userId, userName: nameOf(person), canSee: input.can_see, createdBy: user.userId, createdByName: byName(user) })
      .returning({ id: salaryVisibility.id });
    await audit(tx, user, "salary.visibility", row!.id, { person: person.name, can_see: input.can_see });
    return { id: row!.id, changed: true };
  });
}

// ---------- advances and corrections ----------

export const AdvanceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("advance"), user_id: z.uuid(), amount: z.string().max(20), on_date: z.string().refine(validDay, "Not a date"), note: Text(200, "note"), expect: Expect }),
  z.object({ kind: z.literal("correction"), user_id: z.uuid(), corrects_id: z.uuid(), amount: z.string().max(20), reason: Reason, expect: Expect }),
]);

/** What is left of an advance after its corrections (paise). */
async function leftOf(tx: AtTx, tenantId: string, advanceId: string, amountPaise: number) {
  const corrections = await tx.select({ amount: salaryAdvances.amountPaise }).from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, tenantId), eq(salaryAdvances.correctsId, advanceId)));
  return amountPaise + corrections.reduce((sum, c) => sum + c.amount, 0);
}

/** Owner: an advance given to a person, or a correction of an earlier one (a negative entry on that entry's date). */
export async function saveAdvance(user: AtUser, input: z.infer<typeof AdvanceInput>) {
  const person = await editablePerson(user, input.user_id);
  const amount = rupees(input.amount, "Amount");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const settings = await tx.select({ fromMonth: salarySettings.fromMonth }).from(salarySettings).where(and(eq(salarySettings.tenantId, user.tenantId), eq(salarySettings.userId, person.userId)));
    if (settings.length === 0) throw badRequest(`Set a salary for ${person.name} first`);
    await checkNewest(tx, salaryAdvances, user, person.userId, input.expect);

    if (input.kind === "advance") {
      const firstDay = settings.reduce((a, s) => (s.fromMonth < a ? s.fromMonth : a), settings[0]!.fromMonth);
      if (input.on_date > istDay(await dbNow(tx))) throw badRequest("The date is in the future");
      if (input.on_date < firstDay) throw badRequest(`The date is before ${person.name}'s first salary month`);
      const [row] = await tx
        .insert(salaryAdvances)
        .values({ tenantId: user.tenantId, userId: person.userId, userName: nameOf(person), onDate: input.on_date, amountPaise: amount, note: input.note, createdBy: user.userId, createdByName: byName(user) })
        .returning({ id: salaryAdvances.id });
      await audit(tx, user, "salary.advance", row!.id, { person: person.name, on: input.on_date, amount, note: input.note });
      return { id: row!.id, onDate: input.on_date };
    }

    const [original] = await tx.select().from(salaryAdvances).where(and(eq(salaryAdvances.tenantId, user.tenantId), eq(salaryAdvances.id, input.corrects_id)));
    if (!original || original.userId !== person.userId) throw notFound("Not found");
    if (original.amountPaise < 0) throw badRequest("Only an advance can be corrected, not a correction");
    const left = await leftOf(tx, user.tenantId, original.id, original.amountPaise);
    if (amount > left) throw badRequest(left > 0 ? `Only ${paiseText(left)} is left of this entry` : "Nothing is left of this entry");
    const [row] = await tx
      .insert(salaryAdvances)
      .values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: nameOf(person),
        onDate: original.onDate, // the correction lowers the same month as the entry it corrects
        amountPaise: -amount,
        correctsId: original.id,
        reason: input.reason,
        createdBy: user.userId,
        createdByName: byName(user),
      })
      .returning({ id: salaryAdvances.id });
    await audit(tx, user, "salary.correction", row!.id, { person: person.name, on: original.onDate, amount: -amount, reason: input.reason });
    return { id: row!.id, onDate: original.onDate };
  });
}

// ---------- what the person page shows ----------

export interface HistoryRow {
  id: string;
  fromMonth: string;
  payBasis: PayBasis;
  monthlyPaise: number | null;
  dayRatePaise: number | null;
  shiftMinutes: number;
  paidLeaveHalfdays: number;
  getsOvertime: boolean;
  otRatePaise: number | null;
  joinedOn: string | null;
  leftOn: string | null;
  reason: string | null;
  byName: string;
  at: string;
}

export interface AdvanceEntry {
  id: string;
  onDate: string;
  amountPaise: number;
  note: string | null;
  reason: string | null;
  correctsId: string | null;
  byName: string;
  /** advances only: what is left after corrections */
  leftPaise: number | null;
}

export interface SalaryPanel {
  month: string;
  today: string;
  thisMonth: string;
  /** the month's figures (null = not on salary that month) */
  figures: SalaryMonth | null;
  /** the setting that applies to the month, else the newest one (for the form) */
  applies: HistoryRow | null;
  /** newest first */
  history: HistoryRow[];
  canSee: boolean;
  /** the month's advance entries, oldest first */
  advances: AdvanceEntry[];
  /** earliest date an advance may have (null = no salary set yet) */
  firstAdvanceDate: string | null;
  /** the newest row ids the page saw, sent back with a save (409 when out of date) */
  expect: { setting: string | null; visibility: string | null; advance: string | null };
}

/** Owner and PlantOps support: everything the salary sections of a person page show, for one month. */
export async function salaryPanel(user: AtUser, personId: string, month: string): Promise<SalaryPanel> {
  requireAccess(user, "salary_view");
  await knownPerson(user, personId);
  const view = await salaryMonths(user, month, { personId });
  return withTenant(user.tenantId, async (tx) => {
    const where = <T extends typeof salarySettings | typeof salaryAdvances | typeof salaryVisibility>(t: T) => and(eq(t.tenantId, user.tenantId), eq(t.userId, personId));
    const settings = await tx.select().from(salarySettings).where(where(salarySettings)).orderBy(desc(salarySettings.createdAt), desc(salarySettings.id));
    const visibility = await tx.select().from(salaryVisibility).where(where(salaryVisibility)).orderBy(desc(salaryVisibility.createdAt), desc(salaryVisibility.id)).limit(1);
    const advances = await tx.select().from(salaryAdvances).where(where(salaryAdvances)).orderBy(asc(salaryAdvances.onDate), asc(salaryAdvances.createdAt));

    const history: HistoryRow[] = settings.map((s) => ({
      id: s.id,
      fromMonth: s.fromMonth.slice(0, 7),
      payBasis: s.payBasis,
      monthlyPaise: s.monthlyPaise,
      dayRatePaise: s.dayRatePaise,
      shiftMinutes: s.shiftMinutes,
      paidLeaveHalfdays: s.paidLeaveHalfdays,
      getsOvertime: s.getsOvertime,
      otRatePaise: s.otRatePaise,
      joinedOn: s.joinedOn,
      leftOn: s.leftOn,
      reason: s.reason,
      byName: s.createdByName,
      at: s.createdAt.toISOString(),
    }));
    const applies = settingFor(history.map((h) => ({ ...h, createdAt: h.at })), month) ?? history[0] ?? null;
    const first = firstSalaryMonth(history.map((h) => ({ ...h, createdAt: h.at })));
    const corrected = new Map<string, number>();
    for (const a of advances) if (a.correctsId) corrected.set(a.correctsId, (corrected.get(a.correctsId) ?? 0) + a.amountPaise);
    return {
      month,
      today: view.today,
      thisMonth: istMonth(),
      figures: view.people[0]?.current ?? null,
      applies,
      history,
      canSee: visibility[0]?.canSee ?? false,
      advances: advances
        .filter((a) => a.onDate.slice(0, 7) === month)
        .map((a) => ({
          id: a.id,
          onDate: a.onDate,
          amountPaise: a.amountPaise,
          note: a.note,
          reason: a.reason,
          correctsId: a.correctsId,
          byName: a.createdByName,
          leftPaise: a.amountPaise > 0 ? a.amountPaise + (corrected.get(a.id) ?? 0) : null,
        })),
      firstAdvanceDate: first ? `${first}-01` : null,
      // the same query the saves check against
      expect: {
        setting: (await newest(tx, salarySettings, user.tenantId, personId))?.id ?? null,
        visibility: (await newest(tx, salaryVisibility, user.tenantId, personId))?.id ?? null,
        advance: (await newest(tx, salaryAdvances, user.tenantId, personId))?.id ?? null,
      },
    };
  });
}

/** The From month choices on the Salary box: 12 months back to 3 months ahead. */
export const fromMonthChoices = (thisMonth: string) => Array.from({ length: 16 }, (_, i) => addMonths(thisMonth, 3 - i));

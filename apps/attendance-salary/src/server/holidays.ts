// A person's own holiday list (rule 24, v0.53.0; owner 2026-11-09, first for Ramu at plant 001). The owner adds holidays
// one person at a time (a date, a name, Paid or not, an optional choice group), removes them, and marks ONE festival
// per choice group as the person's choice leave. Every change is a new row (append-only in the database); the newest
// row for a person and day wins. What a holiday does to the salary is in lib/salary.ts (rule 24).
// Who: the owner changes it (`holiday_edit`); the owner and PlantOps support see it (`salary_view`). The month calendar
// shows only Paid holidays (owner: choice leave is not marked there); the salary page and slip show both.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { fmtMonth, istDay, validDay } from "@/lib/days";
import { HOLIDAY_GROUP_MAX, HOLIDAY_NAME_MAX, MAX_HOLIDAYS_PER_SAVE } from "@/lib/holidays";
import type { Holiday } from "@/lib/salary";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict } from "./http";
import { lockPerson } from "./marks";
import { knownPerson } from "./people";
import type { AtUser } from "./session";

const { personHolidays, salaryPayments, salaryPaymentUndos } = schema;

/** Holidays may be listed from 1 Jan 2026 up to the end of next year. */
const FIRST_DAY = "2026-01-01";
const lastDay = (now: Date) => `${Number(istDay(now).slice(0, 4)) + 1}-12-31`;

/** One person's (or several people's) holidays between two India dates: person -> day -> holiday. */
export async function loadHolidays(tx: AtTx, tenantId: string, fromDate: string, toDate: string, personIds?: readonly string[]): Promise<Map<string, Map<string, Holiday>>> {
  const rows = await tx
    .select()
    .from(personHolidays)
    .where(and(eq(personHolidays.tenantId, tenantId), gte(personHolidays.day, fromDate), lte(personHolidays.day, toDate), personIds ? inArray(personHolidays.userId, [...personIds]) : undefined))
    .orderBy(asc(personHolidays.createdAt), asc(personHolidays.id));
  const out = new Map<string, Map<string, Holiday>>();
  for (const r of rows) {
    const days = out.get(r.userId) ?? new Map<string, Holiday>();
    const was = days.get(r.day);
    if (r.action === "add") {
      const paid = r.paid === true;
      const group = paid ? null : r.choiceGroup;
      // a changed holiday keeps its choice leave while it can still be one (not Paid, in a group)
      days.set(r.day, { name: r.name!, paid, group, choice: !!was?.choice && !paid && !!group && group === was.group });
    } else if (r.action === "remove") days.delete(r.day);
    else if (was) days.set(r.day, { ...was, choice: r.action === "choice" && !was.paid && !!was.group });
    out.set(r.userId, days);
  }
  return out;
}

const personMap = async (tx: AtTx, tenantId: string, personId: string, from: string, to: string) =>
  (await loadHolidays(tx, tenantId, from, to, [personId])).get(personId) ?? new Map<string, Holiday>();

/** One person's holidays in a date range (calendar and day pages; the caller has checked who may look). */
export function personHolidayMap(user: AtUser, personId: string, fromDate: string, toDate: string) {
  return withTenant(user.tenantId, (tx) => personMap(tx, user.tenantId, personId, fromDate, toDate));
}

export interface HolidayEntry extends Holiday {
  day: string;
}

export interface HolidayList {
  year: string;
  entries: HolidayEntry[];
  /** the person's paid months ("YYYY-MM"), so the box can say a change there goes into the next month */
  paidMonths: string[];
  /** the group labels used this year (the add form offers them) */
  groups: string[];
}

/** Owner and PlantOps support: a person's holidays in one year, oldest first. */
export async function holidayList(user: AtUser, personId: string, year: string): Promise<HolidayList> {
  requireAccess(user, "salary_view");
  if (!/^\d{4}$/.test(year)) throw badRequest("Not a year");
  return withTenant(user.tenantId, async (tx) => {
    const map = await personMap(tx, user.tenantId, personId, `${year}-01-01`, `${year}-12-31`);
    const entries = [...map.entries()].map(([day, h]) => ({ day, ...h })).sort((a, b) => (a.day < b.day ? -1 : 1));
    return { year, entries, paidMonths: await paidMonthsOf(tx, user.tenantId, personId), groups: [...new Set(entries.flatMap((e) => (e.group ? [e.group] : [])))] };
  });
}

/** A holiday change in a month already marked paid is refused (Undo paid first). */
async function refusePaid(tx: AtTx, tenantId: string, personId: string, days: readonly string[]) {
  const paid = new Set(await paidMonthsOf(tx, tenantId, personId));
  const hit = days.find((d) => paid.has(d.slice(0, 7)));
  if (hit) throw conflict(`${fmtMonth(hit.slice(0, 7))} is already marked paid, so its holidays can't change. Undo paid first.`);
}

async function paidMonthsOf(tx: AtTx, tenantId: string, personId: string) {
  const paid = await tx.select({ id: salaryPayments.id, month: salaryPayments.month }).from(salaryPayments).where(and(eq(salaryPayments.tenantId, tenantId), eq(salaryPayments.userId, personId)));
  if (paid.length === 0) return [];
  const undone = new Set((await tx.select({ id: salaryPaymentUndos.paymentId }).from(salaryPaymentUndos).where(and(eq(salaryPaymentUndos.tenantId, tenantId), inArray(salaryPaymentUndos.paymentId, paid.map((p) => p.id))))).map((u) => u.id));
  return [...new Set(paid.filter((p) => !undone.has(p.id)).map((p) => p.month.slice(0, 7)))].sort();
}

const Row = z.object({
  day: z.string().refine(validDay, "Not a date"),
  name: z.string().trim().min(1, "Write the holiday's name").max(HOLIDAY_NAME_MAX, `At most ${HOLIDAY_NAME_MAX} characters`),
  paid: z.boolean(),
  group: z.string().trim().max(HOLIDAY_GROUP_MAX, `A group name has at most ${HOLIDAY_GROUP_MAX} characters`).nullable().optional(),
});

export const AddHolidaysInput = z.object({
  user_id: z.uuid(),
  rows: z.array(Row).min(1, "Add at least one holiday").max(MAX_HOLIDAYS_PER_SAVE, `At most ${MAX_HOLIDAYS_PER_SAVE} holidays at once`),
});

/**
 * Owner only: adds holidays to one person's list (one row, or a pasted sheet), all saved or none. A day already on the
 * list with the same name, Paid and group is skipped; a different one replaces it (a Paid holiday never has a group).
 * Each change gets its own line in Recent changes. A month already marked paid can't change (owner 2026-11-09: the list
 * starts from the next unpaid month; Undo paid first to change one).
 */
export async function addHolidays(user: AtUser, input: z.infer<typeof AddHolidaysInput>, now = new Date()) {
  requireAccess(user, "holiday_edit");
  const byDay = new Map<string, z.infer<typeof Row>>();
  for (const r of input.rows) {
    if (byDay.has(r.day)) throw badRequest(`${r.day} is in the list twice`);
    byDay.set(r.day, r);
  }
  const days = [...byDay.keys()].sort();
  if (days[0]! < FIRST_DAY || days.at(-1)! > lastDay(now)) throw badRequest("A holiday must be between 1 Jan 2026 and the end of next year");
  const person = await knownPerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    await refusePaid(tx, user.tenantId, person.userId, days);
    const current = await personMap(tx, user.tenantId, person.userId, days[0]!, days.at(-1)!);
    let changed = 0;
    for (const day of days) {
      const r = byDay.get(day)!;
      const group = r.paid ? null : r.group?.trim() || null;
      const was = current.get(day);
      if (was && was.name === r.name && was.paid === r.paid && was.group === group) continue;
      await tx.insert(personHolidays).values({ tenantId: user.tenantId, userId: person.userId, userName: person.name.slice(0, 100), day, action: "add", name: r.name, paid: r.paid, choiceGroup: group, createdBy: user.userId, createdByName: user.name.slice(0, 100) });
      await audit(tx, user, "holiday.add", day, { person: person.name, day, name: r.name, paid: r.paid, group, replaced: was ? was.name : null });
      changed += 1;
    }
    return { changed, skipped: days.length - changed };
  });
}

export const HolidayDayInput = z.object({
  user_id: z.uuid(),
  day: z.string().refine(validDay, "Not a date"),
});

/** Owner only: takes a day off the person's list (its choice leave goes with it). */
export async function removeHoliday(user: AtUser, input: z.infer<typeof HolidayDayInput>) {
  requireAccess(user, "holiday_edit");
  const person = await knownPerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const was = (await personMap(tx, user.tenantId, person.userId, input.day, input.day)).get(input.day);
    if (!was) throw conflict("That day is not on the list any more");
    await refusePaid(tx, user.tenantId, person.userId, [input.day]);
    await tx.insert(personHolidays).values({ tenantId: user.tenantId, userId: person.userId, userName: person.name.slice(0, 100), day: input.day, action: "remove", createdBy: user.userId, createdByName: user.name.slice(0, 100) });
    await audit(tx, user, "holiday.remove", input.day, { person: person.name, day: input.day, name: was.name });
    return { removed: true };
  });
}

export const ChoiceInput = HolidayDayInput.extend({ choice: z.boolean() });

/**
 * Owner only: marks a festival (not Paid, in a choice group) as the person's choice leave, or undoes it. One per group:
 * another one in the same group must be undone first.
 */
export async function setChoice(user: AtUser, input: z.infer<typeof ChoiceInput>) {
  requireAccess(user, "holiday_edit");
  const person = await knownPerson(user, input.user_id);
  const year = input.day.slice(0, 4);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    // groups are looked at a year either side, so a group across New Year is still one group
    const map = await personMap(tx, user.tenantId, person.userId, `${Number(year) - 1}-01-01`, `${Number(year) + 1}-12-31`);
    const h = map.get(input.day);
    if (!h) throw conflict("That day is not on the list any more");
    if (h.choice === input.choice) return { changed: false };
    await refusePaid(tx, user.tenantId, person.userId, [input.day]);
    if (input.choice) {
      if (h.paid) throw badRequest("A Paid holiday is paid anyway; choice leave is for the other festivals");
      if (!h.group) throw badRequest("This festival has no choice group");
      const other = [...map.entries()].find(([d, x]) => d !== input.day && x.choice && x.group === h.group);
      if (other) throw conflict(`${other[1].name} is already the choice leave for ${h.group}. Undo it first.`);
    }
    await tx.insert(personHolidays).values({ tenantId: user.tenantId, userId: person.userId, userName: person.name.slice(0, 100), day: input.day, action: input.choice ? "choice" : "unchoice", createdBy: user.userId, createdByName: user.name.slice(0, 100) });
    await audit(tx, user, input.choice ? "holiday.choice" : "holiday.unchoice", input.day, { person: person.name, day: input.day, name: h.name, group: h.group });
    return { changed: true };
  });
}

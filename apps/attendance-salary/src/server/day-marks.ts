// Day marks (v0.26.0, docs/DAY_MARKS_PLAN.md; owner 2026-10-19): the owner marks one person on one date ON (a full
// present day) or OFF (a paid day off), or Clear (back to the IN / OUT marks). No times, no reason. Every change is a
// new row (append-only in the database); the newest row for a person and day wins. Rule 20 in lib/salary.ts decides
// what a mark does to the salary; overtime still comes only from real IN / OUT times.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { istDay, validDay } from "@/lib/days";
import type { DayMark } from "@/lib/salary";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest } from "./http";
import { lockPerson } from "./marks";
import { knownPerson } from "./people";
import type { AtUser } from "./session";

const { dayMarks } = schema;

export const DayMarkInput = z.object({
  user_id: z.uuid(),
  day: z.string().refine(validDay, "Not a date"),
  mark: z.enum(["on", "off", "clear"]),
});

/** One person's or the whole plant's marks between two India dates (inclusive): person -> day -> on / off. */
export async function loadDayMarks(tx: AtTx, tenantId: string, fromDate: string, toDate: string, personIds?: readonly string[]): Promise<Map<string, Map<string, DayMark>>> {
  const rows = await tx
    .select({ userId: dayMarks.userId, day: dayMarks.day, mark: dayMarks.mark })
    .from(dayMarks)
    .where(and(eq(dayMarks.tenantId, tenantId), gte(dayMarks.day, fromDate), lte(dayMarks.day, toDate), personIds ? inArray(dayMarks.userId, [...personIds]) : undefined))
    .orderBy(asc(dayMarks.createdAt), asc(dayMarks.id));
  const out = new Map<string, Map<string, DayMark>>();
  for (const r of rows) {
    const days = out.get(r.userId) ?? new Map<string, DayMark>();
    if (r.mark === "clear") days.delete(r.day);
    else days.set(r.day, r.mark);
    out.set(r.userId, days);
  }
  return out;
}

/** One person's marks in a date range (the calendar and day pages). */
export function personDayMarks(user: AtUser, personId: string, fromDate: string, toDate: string) {
  return withTenant(user.tenantId, async (tx) => (await loadDayMarks(tx, user.tenantId, fromDate, toDate, [personId])).get(personId) ?? new Map<string, DayMark>());
}

/**
 * Owner only: marks one person's day, today or earlier (the calendar opens past days and today only); a mark that is
 * the same as the day's current one saves nothing. Recorded in Recent changes.
 */
export async function setDayMark(user: AtUser, input: z.infer<typeof DayMarkInput>, now = new Date()) {
  requireAccess(user, "day_mark");
  const today = istDay(now);
  if (input.day > today) throw badRequest("A day can be marked from that day on, not before");
  if (input.day < "2026-01-01") throw badRequest("That date is too far back");
  const person = await knownPerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const current = (await loadDayMarks(tx, user.tenantId, input.day, input.day, [person.userId])).get(person.userId)?.get(input.day) ?? null;
    if ((current ?? "clear") === input.mark) return { day: input.day, mark: current, changed: false };
    await tx.insert(dayMarks).values({
      tenantId: user.tenantId,
      userId: person.userId,
      userName: person.name.slice(0, 100),
      day: input.day,
      mark: input.mark,
      createdBy: user.userId,
      createdByName: user.name.slice(0, 100),
    });
    await audit(tx, user, "day.mark", input.day, { person: person.name, day: input.day, mark: input.mark });
    return { day: input.day, mark: input.mark === "clear" ? null : input.mark, changed: true };
  });
}

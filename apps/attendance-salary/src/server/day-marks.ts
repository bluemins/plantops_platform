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

/** At most this many days in one "Mark days" save (owner 2026-10-20: a month's worth). */
export const MAX_DAYS_PER_SAVE = 31;

export const DayMarksInput = z.object({
  user_id: z.uuid(),
  days: z.array(z.string().refine(validDay, "Not a date")).min(1, "Pick at least one day").max(MAX_DAYS_PER_SAVE, `At most ${MAX_DAYS_PER_SAVE} days at once`),
  mark: z.enum(["on", "off", "clear"]),
});

type Mark = DayMark | "clear";

/**
 * Owner only: marks one person's day, today or earlier (the calendar opens past days and today only); a mark that is
 * the same as the day's current one saves nothing. Recorded in Recent changes.
 */
export async function setDayMark(user: AtUser, input: z.infer<typeof DayMarkInput>, now = new Date()) {
  const { days } = await setDayMarks(user, { user_id: input.user_id, days: [input.day], mark: input.mark }, now);
  return days[0]!;
}

/**
 * Owner only, the person page's "Mark days" (owner 2026-10-20): one mark for several days of one person, all saved
 * or none. Each day follows `setDayMark`'s rules (today or earlier; the same mark again is skipped) and gets its own
 * row and its own line in Recent changes.
 */
export async function setDayMarks(user: AtUser, input: z.infer<typeof DayMarksInput>, now = new Date()) {
  requireAccess(user, "day_mark");
  const today = istDay(now);
  const days = [...new Set(input.days)].sort();
  if (days.length > MAX_DAYS_PER_SAVE) throw badRequest(`At most ${MAX_DAYS_PER_SAVE} days at once`);
  if (days.some((d) => d > today)) throw badRequest("A day can be marked from that day on, not before");
  if (days.some((d) => d < "2026-01-01")) throw badRequest("That date is too far back");
  const person = await knownPerson(user, input.user_id);
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    const current = (await loadDayMarks(tx, user.tenantId, days[0]!, days.at(-1)!, [person.userId])).get(person.userId) ?? new Map<string, DayMark>();
    const out: { day: string; mark: DayMark | null; changed: boolean }[] = [];
    for (const day of days) {
      const was = current.get(day) ?? null;
      if (((was ?? "clear") as Mark) === input.mark) {
        out.push({ day, mark: was, changed: false });
        continue;
      }
      await tx.insert(dayMarks).values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: person.name.slice(0, 100),
        day,
        mark: input.mark,
        createdBy: user.userId,
        createdByName: user.name.slice(0, 100),
      });
      await audit(tx, user, "day.mark", day, { person: person.name, day, mark: input.mark });
      out.push({ day, mark: input.mark === "clear" ? null : input.mark, changed: true });
    }
    return { days: out, changed: out.filter((d) => d.changed).length };
  });
}

// The owner's fixes (docs/ATTENDANCE_PHASE_PLAN.md "Staff -> person"): add a time, or cancel a mark, always with a
// reason. There is no edit: both are new rows (append-only in the database), and the mark that was wrong stays on
// record, crossed out. Both send the day's "stamp" from the page; if anything changed that day meanwhile (a scan,
// another owner's fix) the answer is 409 and the page reloads.
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { addDays, dayStart, istDay, validDay } from "@/lib/days";
import { fmtTime } from "@/lib/punch";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { dbNow, lockPerson } from "./marks";
import { correctedNotification } from "./notify";
import { knownPerson } from "./people";
import type { AtUser } from "./session";

const { punches, punchCancels } = schema;

/**
 * What the page saw of a person's day: how many marks and cancels they have around it, and the newest one's time.
 * Any scan or fix touching that day changes it.
 */
async function stampOf(tx: AtTx, tenantId: string, personId: string, date: string) {
  const window = and(eq(punches.tenantId, tenantId), eq(punches.userId, personId), gte(punches.at, dayStart(addDays(date, -2))), lt(punches.at, dayStart(addDays(date, 3))));
  const marks = await tx.select({ id: punches.id, createdAt: punches.createdAt, by: punches.createdByName }).from(punches).where(window);
  const cancels = marks.length
    ? await tx.select({ createdAt: punchCancels.createdAt, by: punchCancels.createdByName }).from(punchCancels).where(and(eq(punchCancels.tenantId, tenantId), inArray(punchCancels.punchId, marks.map((m) => m.id))))
    : [];
  const all = [...marks, ...cancels].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { stamp: `${marks.length}.${cancels.length}.${all[0]?.createdAt.getTime() ?? 0}`, lastBy: all[0]?.by ?? null };
}

/** The stamp for the owner's day page. */
export async function dayStamp(user: AtUser, personId: string, date: string) {
  requireAccess(user, "see_everyone");
  return (await withTenant(user.tenantId, (tx) => stampOf(tx, user.tenantId, personId, date))).stamp;
}

async function checkStamp(tx: AtTx, user: AtUser, personId: string, date: string, expect: string) {
  const now = await stampOf(tx, user.tenantId, personId, date);
  if (now.stamp !== expect) throw conflict(`Just changed by ${now.lastBy ?? "someone"}. The page has been refreshed: check it and try again.`);
}

const Reason = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(3, "Write a reason (at least 3 characters)").max(300, "The reason is at most 300 characters"));
const Day = z.string().refine(validDay, "Not a date");

export const AddInput = z.object({
  user_id: z.uuid(),
  /** the day page the owner is on (its stamp is `expect`) */
  day: Day,
  kind: z.enum(["in", "out"]),
  /** the mark's own India date: the page's day, or the next day (a night shift's OUT) */
  date: Day,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time like 18:30"),
  reason: Reason,
  expect: z.string().max(100),
});

/** Owner: add a forgotten IN or OUT for a person, with a reason. */
export async function addFix(user: AtUser, input: z.infer<typeof AddInput>) {
  requireAccess(user, "fix");
  if (input.date !== input.day && input.date !== addDays(input.day, 1)) throw badRequest("The time must be on this day or the next morning");
  const person = await knownPerson(user, input.user_id);
  const at = new Date(`${input.date}T${input.time}:00+05:30`);
  const saved = await withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, person.userId);
    if (at > (await dbNow(tx))) throw badRequest("That time is in the future");
    await checkStamp(tx, user, person.userId, input.day, input.expect);
    const [row] = await tx
      .insert(punches)
      .values({
        tenantId: user.tenantId,
        userId: person.userId,
        userName: person.name.slice(0, 100),
        kind: input.kind,
        at,
        source: "owner",
        reason: input.reason,
        createdBy: user.userId,
        createdByName: user.name.slice(0, 100),
      })
      .returning({ id: punches.id, at: punches.at });
    await audit(tx, user, "fix.add", row!.id, { person: person.name, kind: input.kind, at: at.toISOString(), reason: input.reason });
    return row!;
  });
  // `notice` is sent by the route after the answer: "Your attendance on 14 Oct was changed" to that worker only
  // (none when an owner who is also Plant staff fixes their own marks)
  const notice = person.userId === user.userId ? null : correctedNotification(user, person.userId, input.date, `Added ${input.kind.toUpperCase()} ${input.time}: ${input.reason}`, saved.id);
  return { id: saved.id, at: saved.at.toISOString(), notice };
}

export const CancelInput = z.object({
  punch_id: z.uuid(),
  day: Day,
  reason: Reason,
  expect: z.string().max(100),
});

/** Owner: cancel a wrong mark, with a reason. It stays on record, crossed out. Once per mark. */
export async function cancelFix(user: AtUser, input: z.infer<typeof CancelInput>) {
  requireAccess(user, "fix");
  const done = await withTenant(user.tenantId, async (tx) => {
    const [mark] = await tx.select().from(punches).where(and(eq(punches.tenantId, user.tenantId), eq(punches.id, input.punch_id)));
    if (!mark) throw notFound("Not found");
    await lockPerson(tx, user.tenantId, mark.userId);
    const [already] = await tx.select({ by: punchCancels.createdByName }).from(punchCancels).where(and(eq(punchCancels.tenantId, user.tenantId), eq(punchCancels.punchId, mark.id))).orderBy(desc(punchCancels.createdAt));
    if (already) throw conflict(`Already cancelled by ${already.by}.`);
    await checkStamp(tx, user, mark.userId, input.day, input.expect);
    const [c] = await tx
      .insert(punchCancels)
      .values({ tenantId: user.tenantId, punchId: mark.id, reason: input.reason, createdBy: user.userId, createdByName: user.name.slice(0, 100) })
      .returning({ id: punchCancels.id });
    await audit(tx, user, "fix.cancel", mark.id, { person: mark.userName, kind: mark.kind, at: mark.at.toISOString(), reason: input.reason });
    return { mark, cancelId: c!.id };
  });
  const { mark } = done;
  const notice = mark.userId === user.userId ? null : correctedNotification(user, mark.userId, istDay(mark.at), `Cancelled ${mark.kind.toUpperCase()} ${fmtTime(mark.at)}: ${input.reason}`, done.cancelId);
  return { cancelled: mark.id, notice };
}

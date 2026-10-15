// Who the owner's views are about (docs/ATTENDANCE_PHASE_PLAN.md "Owner views"): the plant's ACTIVE users holding
// Plant staff, from the platform. Someone who left (disabled, or Plant staff taken away) drops off Today but keeps
// their history: they are found through the name copied on their marks.
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { roleWorksIn } from "@plantops/types";
import { dayStart, addDays } from "@/lib/days";
import type { Cancel, Mark } from "@/lib/sessions";
import { requireAccess } from "./access";
import { schema, withTenant, type AtTx } from "./db";
import { notFound } from "./http";
import { kit } from "./kit";
import type { AtUser } from "./session";

const { punches, punchCancels } = schema;

export interface Person {
  userId: string;
  name: string;
}

export interface StaffList {
  /** active Plant staff, A-Z (empty with platformDown when the platform can't be reached) */
  active: Person[];
  /** people with marks here who are not active Plant staff now */
  former: Person[];
  platformDown: boolean;
}

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** Everyone with marks in this plant, with the newest name copied on their marks. */
async function peopleWithMarks(tx: AtTx, tenantId: string): Promise<Person[]> {
  const rows = await tx
    .selectDistinctOn([punches.userId], { userId: punches.userId, name: punches.userName })
    .from(punches)
    .where(eq(punches.tenantId, tenantId))
    .orderBy(punches.userId, desc(punches.at));
  return rows;
}

/** Active Plant staff (from the platform) and people who left (from their marks). */
export async function staffList(user: AtUser): Promise<StaffList> {
  requireAccess(user, "see_everyone");
  const contacts = await kit.contacts(user.tenantId);
  const active = (contacts ?? [])
    .filter((c) => c.roles.some((r) => roleWorksIn(r, "attendance_salary")))
    .map((c) => ({ userId: c.user_id, name: c.display_name }))
    .sort(byName);
  const ids = new Set(active.map((p) => p.userId));
  const marked = await withTenant(user.tenantId, (tx) => peopleWithMarks(tx, user.tenantId));
  return { active, former: marked.filter((p) => !ids.has(p.userId)).sort(byName), platformDown: contacts === null };
}

/** The person's name if they are active Plant staff or have marks in this plant; otherwise 404. */
export async function knownPerson(user: AtUser, personId: string): Promise<Person> {
  requireAccess(user, "see_everyone");
  const contacts = await kit.contacts(user.tenantId);
  const c = contacts?.find((x) => x.user_id === personId && x.roles.some((r) => roleWorksIn(r, "attendance_salary")));
  if (c) return { userId: personId, name: c.display_name };
  const [row] = await withTenant(user.tenantId, (tx) =>
    tx.select({ name: punches.userName }).from(punches).where(and(eq(punches.tenantId, user.tenantId), eq(punches.userId, personId))).orderBy(desc(punches.at)).limit(1),
  );
  if (!row) throw notFound("Not found");
  return { userId: personId, name: row.name };
}

export interface Loaded {
  marks: Mark[];
  cancels: Cancel[];
  /** newest name copied on the person's marks in this window */
  name: string;
}

/**
 * Marks and cancels between two India dates (inclusive), with 2 days added on each side so a shift crossing the edge
 * pairs correctly (no block is longer than 16 hours). One person, or the whole plant (grouped by person).
 */
export async function loadMarks(tx: AtTx, tenantId: string, fromDate: string, toDate: string, personId?: string): Promise<Map<string, Loaded>> {
  const from = dayStart(addDays(fromDate, -2));
  const to = dayStart(addDays(toDate, 3));
  const rows = await tx
    .select()
    .from(punches)
    .where(and(eq(punches.tenantId, tenantId), gte(punches.at, from), lt(punches.at, to), personId ? eq(punches.userId, personId) : sql`true`))
    .orderBy(punches.at);
  const ids = rows.map((r) => r.id);
  const cancels = ids.length ? await tx.select().from(punchCancels).where(and(eq(punchCancels.tenantId, tenantId), inArray(punchCancels.punchId, ids))) : [];
  const cancelOf = new Map(cancels.map((c) => [c.punchId, c]));
  const out = new Map<string, Loaded>();
  for (const r of rows) {
    let p = out.get(r.userId);
    if (!p) out.set(r.userId, (p = { marks: [], cancels: [], name: r.userName }));
    p.name = r.userName; // rows are in time order: the last one wins
    p.marks.push({ id: r.id, kind: r.kind, at: r.at, source: r.source, reason: r.reason, byName: r.createdByName, distanceM: r.distanceM });
    const c = cancelOf.get(r.id);
    if (c) p.cancels.push({ punchId: c.punchId, reason: c.reason, byName: c.createdByName, at: c.createdAt });
  }
  return out;
}

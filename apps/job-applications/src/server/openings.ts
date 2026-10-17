// The plant's openings and its public page message (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Openings"). The owner
// edits; PlantOps support looks; HR desk is not here. Openings are switched off, never deleted, and applications keep
// a copy of the name they applied for, so editing an opening never changes old applications.
import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_MESSAGE, GROUP_IDS, GROUPS, LIMITS } from "@/lib/groups";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type JaTx } from "./db";
import { notFound, uuidParam } from "./http";
import type { JaUser } from "./session";
import type { OnOff, OpeningGroup } from "./schema";

const { openings, applications, pageSettings } = schema;

const text = (min: number, max: number, what: string) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${what} is required` : `${what}: at least ${min} characters`)
    .max(max, `${what}: at most ${max} characters`);
const optional = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what}: at most ${max} characters`)
    .nullish()
    .transform((v) => v || null);

export const OpeningInput = z.object({
  title: text(2, LIMITS.title, "Position"),
  grp: z.enum(GROUP_IDS, "Pick a group"),
  tag: optional(LIMITS.tag, "Short tag"),
  description: text(1, LIMITS.description, "Job description"),
  minQualification: text(1, LIMITS.minQualification, "Minimum qualification"),
  goodToHave: optional(LIMITS.goodToHave, "Good to have"),
  status: z.enum(["active", "off"]),
});
export type OpeningInput = z.infer<typeof OpeningInput>;

export const MessageInput = z.object({ message: z.string().trim().max(LIMITS.message, `Message: at most ${LIMITS.message} characters`) });
export const MoveInput = z.object({ direction: z.enum(["up", "down"]) });

export interface OpeningView extends OpeningInput {
  id: string;
  sortOrder: number;
  /** applications received for this opening (they keep the name they applied for) */
  applications: number;
}

const groupIndex = (g: string) => GROUPS.findIndex((x) => x.id === g);
const byPageOrder = <T extends { grp: string; sortOrder: number; title: string }>(a: T, b: T) =>
  groupIndex(a.grp) - groupIndex(b.grp) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);

const toView = (r: typeof openings.$inferSelect, counts: Map<string, number>): OpeningView => ({
  id: r.id,
  title: r.title,
  grp: r.grp,
  tag: r.tag,
  description: r.description,
  minQualification: r.minQualification,
  goodToHave: r.goodToHave,
  status: r.status,
  sortOrder: r.sortOrder,
  applications: counts.get(r.id) ?? 0,
});

async function applicationCounts(tx: JaTx, tenantId: string) {
  const rows = await tx
    .select({ id: applications.openingId, n: count() })
    .from(applications)
    .where(and(eq(applications.tenantId, tenantId), isNotNull(applications.openingId)))
    .groupBy(applications.openingId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

/** Owner / support: every opening, in page order, with how many applications each received. */
export async function listOpenings(user: JaUser): Promise<OpeningView[]> {
  requireAccess(user, "view_openings");
  return withTenant(user.tenantId, async (tx) => {
    const [rows, counts] = await Promise.all([tx.select().from(openings).where(eq(openings.tenantId, user.tenantId)), applicationCounts(tx, user.tenantId)]);
    return rows.map((r) => toView(r, counts)).sort(byPageOrder);
  });
}

export async function getOpening(user: JaUser, id: string): Promise<OpeningView> {
  requireAccess(user, "view_openings");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(openings).where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, id)));
    if (!row) throw notFound("This position doesn't exist");
    return toView(row, await applicationCounts(tx, user.tenantId));
  });
}

async function endOfGroup(tx: JaTx, tenantId: string, grp: OpeningGroup) {
  const [r] = await tx
    .select({ max: sql<number | null>`max(${openings.sortOrder})` })
    .from(openings)
    .where(and(eq(openings.tenantId, tenantId), eq(openings.grp, grp)));
  return r?.max === null || r?.max === undefined ? 0 : Number(r.max) + 1;
}

export async function createOpening(user: JaUser, input: OpeningInput) {
  requireAccess(user, "manage_openings");
  return withTenant(user.tenantId, async (tx) => {
    const sortOrder = await endOfGroup(tx, user.tenantId, input.grp);
    const [row] = await tx
      .insert(openings)
      .values({ tenantId: user.tenantId, ...input, sortOrder, createdBy: user.userId, createdByName: user.name })
      .returning({ id: openings.id });
    await audit(tx, user, "opening.added", row!.id, { title: input.title, grp: input.grp, status: input.status });
    return { id: row!.id };
  });
}

const FIELDS = ["title", "grp", "tag", "description", "minQualification", "goodToHave", "status"] as const;

/** Saves every field (incl. on / off). Recent changes lists only what changed. */
export async function updateOpening(user: JaUser, id: string, input: OpeningInput) {
  requireAccess(user, "manage_openings");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(openings).where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, id))).for("update");
    if (!row) throw notFound("This position doesn't exist");
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of FIELDS) if ((row[f] ?? null) !== (input[f] ?? null)) changes[f] = { from: row[f], to: input[f] };
    if (!Object.keys(changes).length) return { id, changed: false };
    const sortOrder = changes.grp ? await endOfGroup(tx, user.tenantId, input.grp) : row.sortOrder;
    await tx
      .update(openings)
      .set({ ...input, sortOrder, updatedAt: new Date() })
      .where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, id)));
    await audit(tx, user, "opening.changed", id, { title: input.title, changes });
    return { id, changed: true };
  });
}

/** One place up or down within its group (the whole group is renumbered 0, 1, 2 … so equal numbers can't stick). */
export async function moveOpening(user: JaUser, id: string, direction: "up" | "down") {
  requireAccess(user, "manage_openings");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(openings).where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, id)));
    if (!row) throw notFound("This position doesn't exist");
    const group = (await tx.select().from(openings).where(and(eq(openings.tenantId, user.tenantId), eq(openings.grp, row.grp))).for("update")).sort(byPageOrder);
    const from = group.findIndex((o) => o.id === id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= group.length) return { moved: false };
    [group[from], group[to]] = [group[to]!, group[from]!];
    for (const [i, o] of group.entries()) {
      if (o.sortOrder !== i) await tx.update(openings).set({ sortOrder: i }).where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, o.id)));
    }
    await audit(tx, user, "opening.moved", id, { title: row.title, grp: row.grp, direction });
    return { moved: true };
  });
}

export async function pageMessage(tx: JaTx, tenantId: string): Promise<{ message: string; isDefault: boolean }> {
  const [row] = await tx.select().from(pageSettings).where(eq(pageSettings.tenantId, tenantId));
  return row?.message ? { message: row.message, isDefault: false } : { message: DEFAULT_MESSAGE, isDefault: true };
}

export async function getPageMessage(user: JaUser) {
  requireAccess(user, "view_openings");
  return withTenant(user.tenantId, (tx) => pageMessage(tx, user.tenantId));
}

/** The text at the top of the public page; empty = back to the default. */
export async function setPageMessage(user: JaUser, message: string) {
  requireAccess(user, "manage_openings");
  return withTenant(user.tenantId, async (tx) => {
    const before = await pageMessage(tx, user.tenantId);
    await tx
      .insert(pageSettings)
      .values({ tenantId: user.tenantId, message })
      .onConflictDoUpdate({ target: pageSettings.tenantId, set: { message, updatedAt: new Date() } });
    if (message !== (before.isDefault ? "" : before.message)) await audit(tx, user, "page.message", null, { to: message || "(default)" });
    return pageMessage(tx, user.tenantId);
  });
}

// ---------- the public page (no login: the plant comes only from the address, see public.ts) ----------

export interface PublicOpening {
  id: string;
  title: string;
  grp: OpeningGroup;
  tag: string | null;
}

/** What job seekers see: the switched-on openings in page order, and the page message. Nothing else. */
export async function publicPage(tenantId: string): Promise<{ openings: PublicOpening[]; message: string }> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: openings.id, title: openings.title, grp: openings.grp, tag: openings.tag, sortOrder: openings.sortOrder })
      .from(openings)
      .where(and(eq(openings.tenantId, tenantId), eq(openings.status, "active" satisfies OnOff)))
      .orderBy(asc(openings.sortOrder));
    const { message } = await pageMessage(tx, tenantId);
    return { openings: rows.sort(byPageOrder).map(({ id, title, grp, tag }) => ({ id, title, grp, tag })), message };
  });
}

/** One switched-on opening of this plant, or null (unknown id, another plant's, or switched off). */
export async function publicOpening(tenantId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: openings.id, title: openings.title, grp: openings.grp, description: openings.description, minQualification: openings.minQualification, goodToHave: openings.goodToHave })
      .from(openings)
      .where(and(eq(openings.tenantId, tenantId), eq(openings.id, id), eq(openings.status, "active")));
    return row ?? null;
  });
}

// The plant's applications for the owner and HR desk (docs/JOB_APPLICATIONS_PHASE_PLAN.md screens 5 and 6): list,
// one application, status, notes, resume pages, CSV and the owner's "Remove now". Every function checks the one
// access table; the plant always comes from the login.
import { and, asc, count, desc, eq, gte, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { normalisePhone } from "@plantops/module-kit/phone";
import { formatRef } from "@/lib/apply";
import { NOTE_MAX, removalDate, STATUS_IDS, statusOf } from "@/lib/status";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type JaTx } from "./db";
import { conflict, HttpError, notFound, uuidParam } from "./http";
import type { JaUser } from "./session";
import type { ApplicationStatus } from "./schema";
import { fileStorage } from "./storage";

const { applications, applicationEvents, applicationFiles, supportViews } = schema;

export type StatusFilter = ApplicationStatus | "all";
export interface ListFilters {
  status?: StatusFilter;
  q?: string;
  /** an opening id, "any" (Any job) or "" (all positions) */
  position?: string;
}

export interface ListRow {
  id: string;
  ref: string;
  name: string;
  phone: string;
  place: string;
  position: string;
  status: ApplicationStatus;
  createdAt: string;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Name / place (any part), reference (J-42, 42), phone digits (3 or more). */
function searchWhere(q: string): SQL | undefined {
  const text = q.trim();
  if (!text) return undefined;
  const like = `%${likeEscape(text)}%`;
  const any: SQL[] = [sql`${applications.name} ilike ${like}`, sql`${applications.place} ilike ${like}`];
  const ref = /^(?:j-?)?0*(\d{1,9})$/i.exec(text);
  if (ref) any.push(eq(applications.refNo, Number(ref[1])));
  const digits = normalisePhone(text) ?? text.replace(/[\s\-.()+]/g, "");
  if (/^\d{3,}$/.test(digits)) any.push(sql`${applications.phone} like ${`%${digits.slice(-10)}%`}`);
  return or(...any);
}

function positionWhere(position: string | undefined): SQL | undefined {
  if (!position) return undefined;
  if (position === "any") return isNull(applications.openingId);
  return z.uuid().safeParse(position).success ? eq(applications.openingId, position) : sql`false`;
}

/** Screen 5: newest first (200 at a time), with counts per status for the chips (counts ignore search and position). */
export async function listApplications(user: JaUser, f: ListFilters = {}, limit = 200) {
  requireAccess(user, "read");
  return withTenant(user.tenantId, async (tx) => {
    const status = f.status && f.status !== "all" && STATUS_IDS.includes(f.status) ? f.status : null;
    const where = and(eq(applications.tenantId, user.tenantId), status ? eq(applications.status, status) : undefined, searchWhere(f.q ?? ""), positionWhere(f.position));
    const rows = await tx.select().from(applications).where(where).orderBy(desc(applications.createdAt), desc(applications.refNo)).limit(limit + 1);
    const byStatus = await tx.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.tenantId, user.tenantId)).groupBy(applications.status);
    const positions = await tx
      .selectDistinct({ id: applications.openingId, title: applications.openingTitle })
      .from(applications)
      .where(eq(applications.tenantId, user.tenantId));
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Partial<Record<ApplicationStatus, number>>;
    return {
      rows: rows.slice(0, limit).map((r) => ({ id: r.id, ref: formatRef(r.refNo), name: r.name, phone: r.phone, place: r.place, position: r.openingTitle ?? "Any job", status: r.status, createdAt: r.createdAt.toISOString() })) as ListRow[],
      more: rows.length > limit,
      counts: { ...counts, all: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
      positions: positions.filter((p) => p.id).map((p) => ({ id: p.id!, title: p.title! })).sort((a, b) => a.title.localeCompare(b.title)),
    };
  });
}

export interface HistoryLine {
  at: string;
  text: string;
}

/**
 * Screen 6. The first open by the owner or HR desk records "Opened by …" once; PlantOps support never does (its
 * views go to the owner's Support access page instead).
 */
export async function getApplication(user: JaUser, id: string, now = new Date()) {
  requireAccess(user, "read");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [a] = await tx.select().from(applications).where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id)));
    if (!a) throw notFound("This application doesn't exist (it may have been removed)");
    if (!a.seenAt && !user.isSupport) {
      const opened = await tx
        .update(applications)
        .set({ seenAt: now, seenBy: user.userId })
        .where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id), isNull(applications.seenAt)))
        .returning({ id: applications.id });
      if (opened.length) await tx.insert(applicationEvents).values({ tenantId: user.tenantId, applicationId: id, kind: "seen", userId: user.userId, userName: user.name, at: now });
    }
    const [files, events, before] = await Promise.all([
      tx.select().from(applicationFiles).where(and(eq(applicationFiles.tenantId, user.tenantId), eq(applicationFiles.applicationId, id))).orderBy(asc(applicationFiles.pageNo)),
      tx.select().from(applicationEvents).where(and(eq(applicationEvents.tenantId, user.tenantId), eq(applicationEvents.applicationId, id))).orderBy(asc(applicationEvents.at)),
      tx
        .select({ id: applications.id, refNo: applications.refNo, position: applications.openingTitle, at: applications.createdAt })
        .from(applications)
        .where(and(eq(applications.tenantId, user.tenantId), eq(applications.phone, a.phone), ne(applications.id, id)))
        .orderBy(desc(applications.createdAt)),
    ]);
    const history: HistoryLine[] = [
      { at: a.createdAt.toISOString(), text: "Sent from the public page" },
      ...events.map((e) => ({
        at: e.at.toISOString(),
        text: e.kind === "seen" ? `Opened by ${e.userName}` : e.kind === "status" ? `${statusOf(e.toStatus!).label} by ${e.userName}${e.text ? `: ${e.text}` : ""}` : `Note by ${e.userName}: ${e.text}`,
      })),
    ];
    return {
      id: a.id,
      ref: formatRef(a.refNo),
      name: a.name,
      phone: a.phone,
      place: a.place,
      position: a.openingTitle ?? "Any job",
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      consentAt: a.consentAt.toISOString(),
      removalOn: removalDate(a.createdAt).toISOString(),
      files: files.map((f) => ({ id: f.id, pageNo: f.pageNo, type: f.contentType, size: f.sizeBytes })),
      history,
      appliedBefore: before.map((b) => ({ id: b.id, ref: formatRef(b.refNo), position: b.position ?? "Any job", at: b.at.toISOString() })),
    };
  });
}

/** Who last changed the status (for "Just changed by …"). */
async function lastChangedBy(tx: JaTx, tenantId: string, id: string) {
  const [e] = await tx
    .select({ by: applicationEvents.userName })
    .from(applicationEvents)
    .where(and(eq(applicationEvents.tenantId, tenantId), eq(applicationEvents.applicationId, id), eq(applicationEvents.kind, "status")))
    .orderBy(desc(applicationEvents.at))
    .limit(1);
  return e?.by ?? "someone else";
}

export const StatusInput = z.object({
  to: z.enum(STATUS_IDS),
  /** the status the person saw: if someone changed it meanwhile, 409 */
  expected: z.enum(STATUS_IDS),
  text: z.string().trim().max(NOTE_MAX, `At most ${NOTE_MAX} characters`).optional(),
});

/** Any order, also back; a reason is optional. */
export async function changeStatus(user: JaUser, id: string, input: z.infer<typeof StatusInput>, now = new Date()) {
  requireAccess(user, "update");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [a] = await tx.select().from(applications).where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id))).for("update");
    if (!a) throw notFound("This application doesn't exist (it may have been removed)");
    if (a.status !== input.expected) throw conflict(`Just changed by ${await lastChangedBy(tx, user.tenantId, id)}. Please reload.`);
    if (a.status === input.to) return { status: a.status };
    await tx.update(applications).set({ status: input.to, statusChangedAt: now }).where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id)));
    await tx.insert(applicationEvents).values({ tenantId: user.tenantId, applicationId: id, kind: "status", fromStatus: a.status, toStatus: input.to, text: input.text || null, userId: user.userId, userName: user.name, at: now });
    return { status: input.to };
  });
}

export const NoteInput = z.object({ text: z.string().trim().min(1, "Write the note first").max(NOTE_MAX, `At most ${NOTE_MAX} characters`) });

/** Notes are never changed or deleted (database permissions). */
export async function addNote(user: JaUser, id: string, text: string, now = new Date()) {
  requireAccess(user, "update");
  uuidParam(id);
  return withTenant(user.tenantId, async (tx) => {
    const [a] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id)));
    if (!a) throw notFound("This application doesn't exist (it may have been removed)");
    await tx.insert(applicationEvents).values({ tenantId: user.tenantId, applicationId: id, kind: "note", text, userId: user.userId, userName: user.name, at: now });
    return { ok: true };
  });
}

/** One resume page, for the file route. PlantOps support's views are logged for the owner. */
export async function readResumeFile(user: JaUser, fileId: string) {
  requireAccess(user, "read");
  uuidParam(fileId);
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx.select().from(applicationFiles).where(and(eq(applicationFiles.tenantId, user.tenantId), eq(applicationFiles.id, fileId)));
    if (!f) throw notFound();
    if (user.isSupport) {
      await tx.insert(supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/files/${fileId}` });
    }
    return f;
  });
  return { data: await fileStorage().get(row.storageKey), type: row.contentType, pageNo: row.pageNo };
}

/** Owner: one row per application (no files), formulas neutralised, the export audited. */
export async function exportCsv(user: JaUser) {
  requireAccess(user, "export");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(applications).where(eq(applications.tenantId, user.tenantId)).orderBy(asc(applications.refNo));
    const notes = await tx
      .select({ applicationId: applicationEvents.applicationId, text: applicationEvents.text, at: applicationEvents.at })
      .from(applicationEvents)
      .where(and(eq(applicationEvents.tenantId, user.tenantId), eq(applicationEvents.kind, "note")))
      .orderBy(asc(applicationEvents.at));
    const lastNote = new Map(notes.map((n) => [n.applicationId, n.text]));
    await audit(tx, user, "export.csv", null, { rows: rows.length });
    return csv([
      ["Reference", "Sent", "Position", "Name", "Mobile", "Place", "Status", "Last note", "Removed on"],
      ...rows.map((r) => [formatRef(r.refNo), csvTime(r.createdAt), r.openingTitle ?? "Any job", r.name, r.phone, r.place, statusOf(r.status).label, lastNote.get(r.id) ?? "", csvTime(removalDate(r.createdAt)).slice(0, 10)]),
    ]);
  });
}

export const RemoveInput = z.object({ reason: z.string().trim().min(3, "Write why (at least 3 characters)").max(300, "At most 300 characters") });

/**
 * Owner's "Remove now" (e.g. the applicant asked): the database function deletes the application, its history and
 * file rows and queues the files (the daily job deletes them from storage and the backup). Only the audit line stays.
 */
export async function removeApplication(user: JaUser, id: string, reason: string) {
  requireAccess(user, "remove");
  uuidParam(id);
  const checked = RemoveInput.safeParse({ reason });
  if (!checked.success) throw new HttpError(400, checked.error.issues[0]!.message);
  reason = checked.data.reason;
  return withTenant(user.tenantId, async (tx) => {
    const res = await tx.execute<{ ref: number | null }>(sql`select job_applications.remove_application(${user.tenantId}::uuid, ${id}::uuid, ${reason}) as ref`);
    const ref = res.rows[0]?.ref;
    if (ref === null || ref === undefined) throw notFound("This application doesn't exist (it may have been removed)");
    await audit(tx, user, "application.removed", null, { ref: formatRef(ref), reason });
    return { removed: formatRef(ref) };
  });
}

/** For the tile and checks: applications sent since `since`, and new ones not opened. */
export async function countsSince(tx: JaTx, tenantId: string, since: Date) {
  const [r] = await tx.select({ n: count() }).from(applications).where(and(eq(applications.tenantId, tenantId), gte(applications.createdAt, since)));
  return Number(r?.n ?? 0);
}


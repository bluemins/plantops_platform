// Photos and video of a complaint (docs/COMPLAINT_BOX_PHASE_PLAN.md "Photos and video"). Type checked by content,
// size and count limits, the plan's storage limit; stored privately and never replaced or deleted. Every download
// checks access and plant, and answers byte ranges (iPhone Safari won't play a video without them).
import { and, eq, isNull, sql } from "drizzle-orm";
import { fileSha256, newStorageKey, sniffType, sniffVideo } from "@plantops/module-kit/storage";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";
import { kit } from "./kit";
import type { FileKind } from "./schema";
import { fileStorage, MAX_PHOTO_BYTES, MAX_PHOTOS, MAX_VIDEO_BYTES, MAX_VIDEOS } from "./storage";
import type { CbUser } from "./session";

const { complaintEvents, complaints, files, supportViews } = schema;

/** A complaint's own photos / video may be added by whoever logged it (or the owner) within this time. */
export const ADD_FILES_WITHIN_MS = 24 * 60 * 60 * 1000;

/** The plan's Complaint Box storage limit in bytes (super_admin sets MB; blank = unlimited). */
async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.complaint_box?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

/** What the file really is, from its first bytes: a photo (JPEG / PNG / WebP) or a video (MP4 / MOV). */
function kindOf(data: Buffer): { kind: FileKind; type: string } | null {
  const photo = sniffType(data);
  if (photo && photo !== "application/pdf") return { kind: "photo", type: photo };
  const video = sniffVideo(data);
  return video ? { kind: "video", type: video } : null;
}

/**
 * Adds one photo or video to a complaint (after it was saved; "Try again" uses the same call), or - with `noteId` -
 * a photo to one of its notes (the note's author, within 24 hours, up to 5 photos per note, no video).
 */
export async function uploadComplaintFile(user: CbUser, complaintId: string, data: Buffer, opts: { noteId?: string; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  requireAccess(user, "log");
  if (!data.length) throw badRequest("The file is empty");
  const what = kindOf(data);
  if (!what) throw new HttpError(415, "Only photos (JPG, PNG, WebP) and videos (MP4, MOV) can be added");
  if (opts.noteId && what.kind === "video") throw new HttpError(415, "A note can have photos only, not a video");
  if (what.kind === "photo" && data.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photos can be at most 10 MB");
  if (what.kind === "video" && data.length > MAX_VIDEO_BYTES) throw new HttpError(413, "Videos can be at most 30 MB (about 20–30 seconds)");
  const limit = await storageLimitBytes(user.tenantId);

  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select().from(complaints).where(and(eq(complaints.tenantId, user.tenantId), eq(complaints.id, complaintId)));
    if (!c) throw notFound("Complaint not found");
    if (opts.noteId) {
      const [note] = await tx
        .select()
        .from(complaintEvents)
        .where(and(eq(complaintEvents.tenantId, user.tenantId), eq(complaintEvents.id, opts.noteId), eq(complaintEvents.complaintId, complaintId), eq(complaintEvents.kind, "note")));
      if (!note) throw notFound("Note not found");
      if (note.createdBy !== user.userId) throw forbidden("Only the person who wrote this note can add its photos");
      if (now - note.createdAt.getTime() > ADD_FILES_WITHIN_MS) throw forbidden("Photos can only be added to a note within 24 hours. Add a new note instead.");
    } else {
      if (!user.isOwner && c.reportedBy !== user.userId) throw forbidden("Only the person who logged this complaint (or the owner) can add its photos. Add a note instead.");
      if (now - c.createdAt.getTime() > ADD_FILES_WITHIN_MS) throw forbidden("Photos and video can only be added within 24 hours of logging. Add a note instead.");
    }

    // one upload per complaint at a time, so two at once can't pass the limits together
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('complaint_box.files'), hashtext(${complaintId}))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(files)
      .where(and(eq(files.tenantId, user.tenantId), eq(files.complaintId, complaintId), opts.noteId ? eq(files.eventId, opts.noteId) : isNull(files.eventId), eq(files.kind, what.kind)));
    if (what.kind === "photo" && n >= MAX_PHOTOS) throw conflict(opts.noteId ? `This note already has ${MAX_PHOTOS} photos` : `This complaint already has ${MAX_PHOTOS} photos`);
    if (what.kind === "video" && n >= MAX_VIDEOS) throw conflict("This complaint already has a video");

    let usedBefore = 0;
    if (limit !== null) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('complaint_box.storage'), hashtext(${user.tenantId}))`);
      const [used] = await tx.select({ n: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` }).from(files).where(eq(files.tenantId, user.tenantId));
      usedBefore = Number(used?.n ?? 0);
      if (usedBefore + data.length > limit) throw new HttpError(413, "Storage full for your plan – ask PlantOps to extend it");
    }

    const key = newStorageKey(user.tenantId);
    await fileStorage().put(key, data, what.type);
    const [row] = await tx
      .insert(files)
      .values({ tenantId: user.tenantId, complaintId, eventId: opts.noteId ?? null, kind: what.kind, contentType: what.type, sizeBytes: data.length, sha256: fileSha256(data), storageKey: key, uploadedBy: user.userId, uploadedByName: user.name })
      .returning();
    // `storage` is for the 80% / 95% warning (only when the plan has a limit)
    return { id: row!.id, kind: row!.kind, size: row!.sizeBytes, storage: limit === null ? null : { before: usedBefore, after: usedBefore + data.length, limit } };
  });
}

/** A file's bytes, only for the viewer's own plant. A PlantOps support view of it is logged for the owner. */
export async function readComplaintFile(user: CbUser, fileId: string) {
  requireAccess(user, "read");
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx.select().from(files).where(and(eq(files.tenantId, user.tenantId), eq(files.id, fileId)));
    if (f && user.isSupport) {
      await tx.insert(supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/files/${fileId}` });
    }
    return f;
  });
  if (!row) throw notFound("File not found");
  return { contentType: row.contentType, kind: row.kind, data: await fileStorage().get(row.storageKey) };
}

/**
 * One byte range of a file of `size` bytes: "bytes=a-b", "bytes=a-" or "bytes=-n". null = no (usable) Range header,
 * send the whole file; "unsatisfiable" = the range lies outside the file (416).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null; // missing, several ranges or nonsense: whole file
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

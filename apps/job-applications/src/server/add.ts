// The owner / HR desk adding an applicant by hand: someone who phoned or walked in (owner, 2026-11-01). It is the same
// application row as the public page's (reference, status, notes, CSV, 12-month removal), marked by its consent
// version. Resume pages come one file per request, also later when a CV arrives; files are added, never replaced.
// Logged-in writes stay JSON or a raw file body (CSRF), like every module.
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { newStorageKey, sniffType } from "@plantops/module-kit/storage";
import { ENTERED_CONSENT, formatRef, MAX_FILE_BYTES, MAX_PHOTOS } from "@/lib/apply";
import { NOTE_MAX } from "@/lib/status";
import { requireAccess } from "./access";
import { ApplyFields, lockRefs, nextRefNo, recentRepeat, storageLimitBytes, usedBytes } from "./apply";
import { audit } from "./audit";
import { schema, withTenant } from "./db";
import { conflict, HttpError, notFound, uuidParam } from "./http";
import type { ResumeType } from "./schema";
import type { JaUser } from "./session";
import { fileStorage } from "./storage";

const { applications, applicationEvents, applicationFiles, openings } = schema;

export const AddInput = ApplyFields.omit({ consent: true }).extend({
  consent: z.literal(true, "Tick that they agreed we keep their details for 12 months"),
  note: z.string().trim().max(NOTE_MAX, `Note: at most ${NOTE_MAX} characters`).optional(),
});

const dateText = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);

/** The positions to pick from: every opening of the plant, also switched-off ones (someone may call about an old ad). */
export async function addChoices(user: JaUser) {
  requireAccess(user, "add");
  return withTenant(user.tenantId, (tx) =>
    tx
      .select({ id: openings.id, title: openings.title, status: openings.status })
      .from(openings)
      .where(eq(openings.tenantId, user.tenantId))
      .orderBy(asc(openings.title)),
  );
}

export async function addApplicant(user: JaUser, input: z.infer<typeof AddInput>, now = new Date()) {
  requireAccess(user, "add");
  return withTenant(user.tenantId, async (tx) => {
    let opening: { id: string; title: string } | null = null;
    if (input.position !== "any") {
      const [o] = await tx
        .select({ id: openings.id, title: openings.title })
        .from(openings)
        .where(and(eq(openings.tenantId, user.tenantId), eq(openings.id, input.position)));
      if (!o) throw new HttpError(400, "This position doesn't exist. Pick another one, or Any job.");
      opening = o;
    }
    await lockRefs(tx, user.tenantId);

    // the same form saved twice (double tap, a retry): the first one
    const [again] = await tx
      .select({ id: applications.id, refNo: applications.refNo })
      .from(applications)
      .where(and(eq(applications.tenantId, user.tenantId), eq(applications.requestKey, input.request_key)));
    if (again) return { id: again.id, ref: formatRef(again.refNo), saved: null };

    const repeat = await recentRepeat(tx, user.tenantId, input.phone, opening?.id ?? null, now);
    if (repeat) throw conflict(`Already in the list: ${formatRef(repeat.refNo)}, added ${dateText(repeat.at)}. Add a note there instead.`);

    const refNo = await nextRefNo(tx, user.tenantId);
    const [row] = await tx
      .insert(applications)
      .values({
        tenantId: user.tenantId,
        refNo,
        openingId: opening?.id ?? null,
        openingTitle: opening?.title ?? null,
        name: input.name,
        phone: input.phone,
        place: input.place,
        consentVersion: ENTERED_CONSENT,
        consentAt: now,
        requestKey: input.request_key,
        createdAt: now,
        statusChangedAt: now,
        // whoever added it has seen it: no "Opened by …" right after "Added by …"
        seenAt: now,
        seenBy: user.userId,
      })
      .returning({ id: applications.id });
    const id = row!.id;
    if (input.note) await tx.insert(applicationEvents).values({ tenantId: user.tenantId, applicationId: id, kind: "note", text: input.note, userId: user.userId, userName: user.name, at: now });
    // the ref only, never the person's details (the audit line outlives a removed application)
    await audit(tx, user, "application.added", id, { ref: formatRef(refNo) });
    return { id, ref: formatRef(refNo), saved: { id, refNo, openingTitle: opening?.title ?? null, place: input.place } };
  });
}

/** One resume page (the PDF, or one photo): a PDF only on an application without files; photos up to 3 in all. */
export async function addResumePage(user: JaUser, id: string, data: Buffer) {
  requireAccess(user, "add");
  uuidParam(id);
  const type = sniffType(data);
  if (!type) throw new HttpError(415, "The resume must be a PDF or a photo (JPEG, PNG or WebP).");
  if (data.length > MAX_FILE_BYTES) throw new HttpError(413, "Each file can be at most 5 MB.");
  return withTenant(user.tenantId, async (tx) => {
    // the row lock: two uploads at once still get pages 1 and 2
    const [a] = await tx.select({ refNo: applications.refNo }).from(applications).where(and(eq(applications.tenantId, user.tenantId), eq(applications.id, id))).for("update");
    if (!a) throw notFound("This application doesn't exist (it may have been removed)");
    const files = await tx.select({ type: applicationFiles.contentType }).from(applicationFiles).where(and(eq(applicationFiles.tenantId, user.tenantId), eq(applicationFiles.applicationId, id)));
    if (files.some((f) => f.type === "application/pdf")) throw conflict("This application already has a PDF resume.");
    if (type === "application/pdf" && files.length) throw conflict("This application already has photos of the resume. Add photos, not a PDF.");
    if (files.length >= MAX_PHOTOS) throw conflict(`At most ${MAX_PHOTOS} photos.`);

    const limit = await storageLimitBytes(user.tenantId);
    const before = limit ? await usedBytes(tx, user.tenantId) : 0;
    if (limit && before + data.length > limit) throw new HttpError(413, "Job applications storage is full. Ask PlantOps for more space.");

    const storage = fileStorage();
    const key = newStorageKey(user.tenantId);
    await storage.put(key, data, type);
    try {
      const pageNo = files.length + 1;
      await tx.insert(applicationFiles).values({
        tenantId: user.tenantId,
        applicationId: id,
        pageNo,
        storageKey: key,
        contentType: type as ResumeType,
        sizeBytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      await audit(tx, user, "application.resume", id, { ref: formatRef(a.refNo), page: pageNo, pdf: type === "application/pdf" });
      return { pageNo, storage: limit ? { before, after: before + data.length, limit } : null };
    } catch (err) {
      await storage.remove(key).catch(() => undefined); // the daily job catches any left
      throw err;
    }
  });
}

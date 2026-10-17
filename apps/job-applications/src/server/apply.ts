// Sending an application from the public page (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Sending an application"). This is
// the only place strangers can write to PlantOps, so every input is treated as hostile:
//   * the plant comes only from the address (resolvePublicPlant); ids and titles in the form are never trusted
//   * spam: a hidden trap field, 20 sends per connection per hour, Cloudflare Turnstile when set up, one application
//     per phone per position per 30 days
//   * files are checked by their first bytes, never by name or the browser's type
//   * files are written first, then every row in ONE transaction; a failed save removes its files again
import { createHash, randomInt } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { newStorageKey, sniffType } from "@plantops/module-kit/storage";
import { CONSENT_VERSION, formatRef, LIMITS, MAX_FILE_BYTES, MAX_PHOTOS } from "@/lib/apply";
import { schema, withTenant } from "./db";
import { HttpError, rateLimit } from "./http";
import { kit } from "./kit";
import type { PublicPlantView } from "./public";
import type { ResumeType } from "./schema";
import { fileStorage } from "./storage";
import { checkTurnstile } from "./turnstile";

const { applications, applicationFiles, openings } = schema;

/** per connection (owner, 2026-10-17: 20, so a hiring drive on one mobile network isn't blocked) */
export const SENDS_PER_HOUR = 20;
const REPEAT_DAYS = 30;
const DAY = 86_400_000;

const text = (min: number, max: number, what: string) =>
  z.string().trim().min(min, `${what}: at least ${min} characters`).max(max, `${what}: at most ${max} characters`);

export const ApplyFields = z.object({
  position: z.union([z.literal("any"), z.uuid("Please pick a position")]),
  name: text(LIMITS.name[0], LIMITS.name[1], "Full name"),
  phone: z
    .string()
    .max(30)
    .transform((v, ctx) => normalisePhone(v) ?? (ctx.addIssue({ code: "custom", message: "Mobile number: 10 digits, starting with 6, 7, 8 or 9" }), z.NEVER)),
  place: text(LIMITS.place[0], LIMITS.place[1], "Where you live"),
  consent: z.literal("yes", "Please tick that you agree, so the plant may keep your details"),
  request_key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Please reload the page and try again"),
});

export interface SendInput {
  fields: Record<string, string | undefined>;
  files: Buffer[];
  ip: string;
  now?: Date;
}

export interface SentApplication {
  ref: string;
  name: string;
  phone: string;
  /** for the notifications (null when nothing was saved: the trap) */
  saved: { id: string; refNo: number; openingTitle: string | null; place: string } | null;
  /** storage use before / after, for the 80 / 95 % warnings (null when the plan has no limit) */
  storage: { before: number; after: number; limit: number } | null;
}

/** The plan's storage limit in bytes, or null (blank = unlimited; PlantOps unreachable = not enforced, like Complaint Box). */
async function storageLimitBytes(tenantId: string) {
  const mb = (await kit.plan(tenantId))?.limits.modules.job_applications?.storage_mb;
  return mb ? mb * 1024 * 1024 : null;
}

/** Refused because the plan's storage is full: the caller tells the owners. */
export class StorageFull extends HttpError {
  constructor(
    public used: number,
    public limit: number,
  ) {
    super(503, "Applications are closed right now. Please try again later.");
  }
}

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Please check the form";
const dateText = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(d);

export async function submitApplication(plant: PublicPlantView, input: SendInput): Promise<SentApplication> {
  const now = input.now ?? new Date();

  // 1. the trap: a field people never see. Bots fill it; they get a "sent" answer and nothing is saved.
  if ((input.fields.website ?? "").trim()) {
    return { ref: formatRef(randomInt(1, 10_000)), name: input.fields.name ?? "", phone: "", saved: null, storage: null };
  }

  // 2. at most 20 sends per connection per hour (in memory; the address is never stored)
  rateLimit(`apply:${input.ip}`, SENDS_PER_HOUR, 3_600_000, "Too many applications from this connection. Please try again later.", now.getTime());

  // 3. Cloudflare's check, when set up
  await checkTurnstile(input.fields["cf-turnstile-response"] ?? null, input.ip);

  // 4. the fields
  const parsed = ApplyFields.safeParse(input.fields);
  if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
  const f = parsed.data;

  // 5. the files: one PDF, or 1-3 photos; each checked by its first bytes
  if (!input.files.length) throw new HttpError(400, "Please add your resume: a PDF, or 1 to 3 photos of it.");
  const files = input.files.map((data) => ({ data, type: sniffType(data) }));
  for (const file of files) {
    if (!file.type) throw new HttpError(415, "The resume must be a PDF or a photo (JPEG, PNG or WebP).");
    if (file.data.length > MAX_FILE_BYTES) throw new HttpError(413, "Each file can be at most 5 MB.");
  }
  const pdfs = files.filter((x) => x.type === "application/pdf").length;
  if (pdfs && files.length > 1) throw new HttpError(400, "Send either one PDF or photos, not both.");
  if (files.length > MAX_PHOTOS) throw new HttpError(400, `At most ${MAX_PHOTOS} photos.`);
  const total = files.reduce((n, x) => n + x.data.length, 0);

  return withTenant(plant.tenantId, async (tx) => {
    // 6. the position: "any", or a switched-on opening of THIS plant (its name is copied from the database)
    let opening: { id: string; title: string } | null = null;
    if (f.position !== "any") {
      const [o] = await tx
        .select({ id: openings.id, title: openings.title })
        .from(openings)
        .where(and(eq(openings.tenantId, plant.tenantId), eq(openings.id, f.position), eq(openings.status, "active")));
      if (!o) throw new HttpError(400, "This position is no longer open. Please pick another one, or Any job.");
      opening = o;
    }

    // one send at a time per plant from here: reference numbers, the double-tap and 30-day checks can't race
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('job_applications.ref'), hashtext(${plant.tenantId}))`);

    // 7. the same form sent twice (double tap, a retry): the first application's reference
    const [again] = await tx
      .select({ refNo: applications.refNo, name: applications.name, phone: applications.phone })
      .from(applications)
      .where(and(eq(applications.tenantId, plant.tenantId), eq(applications.requestKey, f.request_key)));
    if (again) return { ref: formatRef(again.refNo), name: again.name, phone: again.phone, saved: null, storage: null };

    // 8. one application per phone per position (Any job counts as one) per 30 days
    const [repeat] = await tx
      .select({ at: applications.createdAt })
      .from(applications)
      .where(
        and(
          eq(applications.tenantId, plant.tenantId),
          eq(applications.phone, f.phone),
          opening ? eq(applications.openingId, opening.id) : isNull(applications.openingId),
          gte(applications.createdAt, new Date(now.getTime() - REPEAT_DAYS * DAY)),
        ),
      )
      .limit(1);
    if (repeat) throw new HttpError(409, `You already applied on ${dateText(repeat.at)}. We have your details.`);

    // 9. the plan's storage
    const limit = await storageLimitBytes(plant.tenantId);
    let before = 0;
    if (limit) {
      const [u] = await tx
        .select({ used: sql<string>`coalesce(sum(${applicationFiles.sizeBytes}), 0)::bigint` })
        .from(applicationFiles)
        .where(eq(applicationFiles.tenantId, plant.tenantId));
      before = Number(u?.used ?? 0);
      if (before + total > limit) throw new StorageFull(before, limit);
    }

    // 10. files first (random keys), then the rows; if the rows fail, the files are removed again
    const storage = fileStorage();
    const written: string[] = [];
    try {
      for (const file of files) {
        const key = newStorageKey(plant.tenantId);
        await storage.put(key, file.data, file.type!);
        written.push(key);
      }
      const [max] = await tx
        .select({ n: sql<number>`coalesce(max(${applications.refNo}), 0)::int` })
        .from(applications)
        .where(eq(applications.tenantId, plant.tenantId));
      const refNo = Number(max?.n ?? 0) + 1;
      const [row] = await tx
        .insert(applications)
        .values({
          tenantId: plant.tenantId,
          refNo,
          openingId: opening?.id ?? null,
          openingTitle: opening?.title ?? null,
          name: f.name,
          phone: f.phone,
          place: f.place,
          consentVersion: CONSENT_VERSION,
          consentAt: now,
          requestKey: f.request_key,
          createdAt: now,
          statusChangedAt: now,
        })
        .returning({ id: applications.id });
      await tx.insert(applicationFiles).values(
        files.map((file, i) => ({
          tenantId: plant.tenantId,
          applicationId: row!.id,
          pageNo: i + 1,
          storageKey: written[i]!,
          contentType: file.type as ResumeType,
          sizeBytes: file.data.length,
          sha256: createHash("sha256").update(file.data).digest("hex"),
        })),
      );
      return {
        ref: formatRef(refNo),
        name: f.name,
        phone: f.phone,
        saved: { id: row!.id, refNo, openingTitle: opening?.title ?? null, place: f.place },
        storage: limit ? { before, after: before + total, limit } : null,
      };
    } catch (err) {
      for (const key of written) await storage.remove(key).catch(() => undefined); // the daily job catches any left
      throw err;
    }
  });
}

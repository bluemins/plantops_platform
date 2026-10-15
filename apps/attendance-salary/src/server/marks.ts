// Marking IN / OUT from the QR (docs/ATTENDANCE_PHASE_PLAN.md "How a worker marks attendance"). Everything that
// matters is decided here, never in the browser: the plant and the person come from the session, the time from the
// database clock, IN or OUT from the person's last valid mark, the distance from the plant's own point. The phone's
// coordinates are used for the distance and then dropped: only the distance and the accuracy are stored.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { NotificationInput } from "@plantops/types";
import { distanceM, fmtDistance } from "@/lib/geo";
import { fmtTime, isDoubleTap, MAX_ACCURACY_M, nextKind, stateText, type Kind, type LastMark } from "@/lib/punch";
import { requireAccess } from "./access";
import { schema, withTenant, type AtTx } from "./db";
import { HttpError } from "./http";
import { outsideNotification } from "./notify";
import { checkKey, KEY_MESSAGES, readSettings } from "./settings";
import type { AtUser } from "./session";

const { punches, punchCancels } = schema;

/** A refused mark: a plain message plus a code the scan screen uses to pick its panel. */
export class MarkRefused extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: "key" | "no_location_set" | "no_location" | "too_rough" | "changed" | "double" | "outside",
    public extra: Record<string, unknown> = {},
    /** sent to the platform after the answer (the owners' "outside" bell); never part of the answer */
    public notice: NotificationInput | null = null,
  ) {
    super(status, message);
  }
}

/** The person's last mark that the owner hasn't cancelled (scan or owner-added). */
export async function lastValidMark(tx: AtTx, tenantId: string, userId: string): Promise<LastMark | null> {
  const [row] = await tx
    .select({ kind: punches.kind, at: punches.at })
    .from(punches)
    .leftJoin(punchCancels, and(eq(punchCancels.tenantId, punches.tenantId), eq(punchCancels.punchId, punches.id)))
    .where(and(eq(punches.tenantId, tenantId), eq(punches.userId, userId), isNull(punchCancels.id)))
    .orderBy(desc(punches.at))
    .limit(1);
  return row ?? null;
}

/** The database's clock (the one time source for marks; the phone's clock is never used). */
export const dbNow = async (tx: AtTx) => new Date((await tx.execute<{ now: string | Date }>(sql`select now() as now`)).rows[0]!.now);

/**
 * One change at a time per person (a scan, an owner's fix): whoever comes second waits for the first to finish, then
 * sees it. Held until the transaction ends.
 */
export async function lockPerson(tx: AtTx, tenantId: string, personId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attendance:${tenantId}:${personId}`}, 0))`);
}

export interface ScanState {
  key: "ok" | "missing" | "no_qr" | "bad";
  key_message: string | null;
  location_set: boolean;
  next: Kind;
  state: string;
}

/** What the scan screen shows before the tap (nothing is saved). */
export async function scanState(user: AtUser, k: string | null): Promise<ScanState> {
  requireAccess(user, "mark");
  return withTenant(user.tenantId, async (tx) => {
    const settings = await readSettings(tx, user.tenantId);
    const key = checkKey(settings, k);
    const [last, now] = await Promise.all([lastValidMark(tx, user.tenantId, user.userId), dbNow(tx)]);
    return {
      key,
      key_message: key === "ok" ? null : KEY_MESSAGES[key],
      location_set: settings?.lat != null,
      next: nextKind(last, now),
      state: stateText(last, now),
    };
  });
}

export const PunchInput = z.object({
  k: z.string().max(200),
  expect: z.enum(["in", "out"]),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(1_000_000),
    })
    .nullable(),
}); // anything else the browser sends (a time, a plant, a person, a distance) is dropped here

/** Saves one IN or OUT for the logged-in worker, or refuses with a plain reason. */
export async function punch(user: AtUser, input: z.infer<typeof PunchInput>) {
  requireAccess(user, "mark");
  const result = await withTenant(user.tenantId, async (tx) => {
    // one mark at a time per person: a second tap at the same moment waits here, then sees the first one
    await lockPerson(tx, user.tenantId, user.userId);
    const settings = await readSettings(tx, user.tenantId);
    const key = checkKey(settings, input.k);
    if (key !== "ok") throw new MarkRefused(403, KEY_MESSAGES[key], "key");
    if (settings!.lat == null || settings!.lng == null) throw new MarkRefused(400, "The owner hasn't set the plant location yet.", "no_location_set");
    if (!input.location) throw new MarkRefused(400, "Allow location to mark attendance.", "no_location");
    if (input.location.accuracy > MAX_ACCURACY_M) {
      throw new MarkRefused(400, `Location too rough (±${fmtDistance(input.location.accuracy)}). Step outside and try again.`, "too_rough");
    }
    const [last, now] = await Promise.all([lastValidMark(tx, user.tenantId, user.userId), dbNow(tx)]);
    const kind = nextKind(last, now);
    if (isDoubleTap(last, now)) throw new MarkRefused(409, `Already marked at ${fmtTime(last!.at)}.`, "double", { next: kind, state: stateText(last, now) });
    if (kind !== input.expect) {
      const msg = kind === "out" ? `You are already IN since ${fmtTime(last!.at)}.` : "You are already OUT.";
      throw new MarkRefused(409, msg, "changed", { next: kind, state: stateText(last, now) });
    }
    const distance = distanceM({ lat: Number(settings!.lat), lng: Number(settings!.lng) }, input.location);
    if (distance > settings!.radiusM) return { outside: true as const, kind, distance };
    const [row] = await tx
      .insert(punches)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        userName: user.name.slice(0, 100),
        kind,
        at: now,
        source: "scan",
        distanceM: Math.round(distance),
        accuracyM: Math.round(input.location.accuracy),
        createdBy: user.userId,
        createdByName: user.name.slice(0, 100),
      })
      .returning({ id: punches.id, kind: punches.kind, at: punches.at, distanceM: punches.distanceM });
    return { outside: false as const, row: row! };
  });
  if (result.outside) {
    throw new MarkRefused(
      403,
      `You are ${fmtDistance(result.distance)} from the plant. Mark ${result.kind.toUpperCase()} at the plant.`,
      "outside",
      { distance_m: Math.round(result.distance) },
      outsideNotification(user, result.kind, result.distance),
    );
  }
  return { id: result.row.id, kind: result.row.kind, at: result.row.at.toISOString(), distance_m: result.row.distanceM };
}

/** The worker's own "IN since 9:02" / "You are OUT" line for their calendar (no QR needed to look). */
export async function myState(user: AtUser): Promise<{ next: Kind; state: string }> {
  requireAccess(user, "see_own");
  return withTenant(user.tenantId, async (tx) => {
    const [last, now] = await Promise.all([lastValidMark(tx, user.tenantId, user.userId), dbNow(tx)]);
    return { next: nextKind(last, now), state: stateText(last, now) };
  });
}

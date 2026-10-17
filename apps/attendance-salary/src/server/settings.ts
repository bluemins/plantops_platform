// The plant's attendance settings: its point, the circle, and the QR on the wall (docs/ATTENDANCE_PHASE_PLAN.md
// "Plant location"). The QR key is never stored: the server works it out from its own secret, the plant and the QR's
// "made at" time; the database keeps only its hash. "Make a new QR" changes the time, so every old print stops.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validLatLng } from "@/lib/geo";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type AtTx } from "./db";
import { env } from "./env";
import type { AtUser } from "./session";

const { plantSettings } = schema;
export type SettingsRow = typeof plantSettings.$inferSelect;

export const RADIUS_MIN = 50;
export const RADIUS_MAX = 2000;
export const RADIUS_DEFAULT = 200;

/** The key printed in the QR for this plant and this QR's date. Only the server can work it out (its secret). */
export function qrKeyFor(tenantId: string, madeAt: Date) {
  return createHmac("sha256", env.sessionSecret).update(`attendance-qr|${tenantId}|${madeAt.toISOString()}`).digest("base64url");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type KeyCheck = "ok" | "missing" | "no_qr" | "bad";

/** Is `k` (from the scanned link) this plant's current QR? Another plant's key, an old one or junk are all "bad". */
export function checkKey(row: SettingsRow | null, k: string | null | undefined): KeyCheck {
  if (!k) return "missing";
  if (!row?.qrKeyHash) return "no_qr";
  const given = Buffer.from(sha256(k), "hex");
  const stored = Buffer.from(row.qrKeyHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored) ? "ok" : "bad";
}

export const KEY_MESSAGES: Record<Exclude<KeyCheck, "ok">, string> = {
  missing: "Scan the QR on the plant wall to mark attendance.",
  no_qr: "The owner hasn't made the QR yet.",
  bad: "This QR is not for your plant, or it is old. Ask the owner for the new one.",
};

export async function readSettings(tx: AtTx, tenantId: string): Promise<SettingsRow | null> {
  const [row] = await tx.select().from(plantSettings).where(eq(plantSettings.tenantId, tenantId));
  return row ?? null;
}

export interface SettingsView {
  lat: number | null;
  lng: number | null;
  radius_m: number;
  qr_made_at: string | null;
  /** the morning "not marked" alert hour (8-11 IST); null = Off */
  not_marked_hour: number | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

const toView = (r: SettingsRow | null): SettingsView => ({
  lat: r?.lat == null ? null : Number(r.lat),
  lng: r?.lng == null ? null : Number(r.lng),
  radius_m: r?.radiusM ?? RADIUS_DEFAULT,
  qr_made_at: r?.qrMadeAt?.toISOString() ?? null,
  not_marked_hour: r ? r.notMarkedHour : NOT_MARKED_DEFAULT,
  updated_by_name: r?.updatedByName ?? null,
  updated_at: r?.updatedAt?.toISOString() ?? null,
});

/** The settings page (owner; PlantOps support read-only). */
export async function settingsFor(user: AtUser): Promise<SettingsView> {
  requireAccess(user, "view_settings");
  return toView(await withTenant(user.tenantId, (tx) => readSettings(tx, user.tenantId)));
}

export const SettingsInput = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_m: z.number().int().min(RADIUS_MIN, `The circle is at least ${RADIUS_MIN} m`).max(RADIUS_MAX, `The circle is at most 2,000 m`),
  })
  .refine((v) => validLatLng(v.lat, v.lng), "Not a valid point");

/** Owner: the plant's point and circle. Each change is in Recent changes. */
export async function saveSettings(user: AtUser, input: z.infer<typeof SettingsInput>): Promise<SettingsView> {
  requireAccess(user, "settings");
  const lat = Number(input.lat.toFixed(6));
  const lng = Number(input.lng.toFixed(6));
  return withTenant(user.tenantId, async (tx) => {
    const before = await readSettings(tx, user.tenantId);
    const who = { updatedBy: user.userId, updatedByName: user.name, updatedAt: new Date() };
    const [row] = await tx
      .insert(plantSettings)
      .values({ tenantId: user.tenantId, lat: String(lat), lng: String(lng), radiusM: input.radius_m, ...who })
      .onConflictDoUpdate({ target: plantSettings.tenantId, set: { lat: String(lat), lng: String(lng), radiusM: input.radius_m, ...who } })
      .returning();
    const moved = before?.lat == null || Number(before.lat) !== lat || Number(before.lng) !== lng;
    if (moved) await audit(tx, user, "settings.location", null, { lat, lng, ...(before?.lat != null ? { from: { lat: Number(before.lat), lng: Number(before.lng) } } : {}) });
    if ((before?.radiusM ?? RADIUS_DEFAULT) !== input.radius_m || !before) await audit(tx, user, "settings.radius", null, { from: before?.radiusM ?? null, to: input.radius_m });
    return toView(row!);
  });
}

/** The hours the owner may pick for the "not marked" alert (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 10); null = Off. */
export const NOT_MARKED_HOURS = [8, 9, 10, 11] as const;
export const NOT_MARKED_DEFAULT = 10;
export const NotMarkedInput = z.object({ hour: z.union([z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.null()]) });

/** Owner: the hour of the morning "not marked" alert to owners and supervisors, or Off. In Recent changes. */
export async function saveNotMarkedHour(user: AtUser, input: z.infer<typeof NotMarkedInput>): Promise<SettingsView> {
  requireAccess(user, "settings");
  return withTenant(user.tenantId, async (tx) => {
    const before = await readSettings(tx, user.tenantId);
    const from = before ? before.notMarkedHour : NOT_MARKED_DEFAULT;
    const who = { updatedBy: user.userId, updatedByName: user.name, updatedAt: new Date() };
    const [row] = await tx
      .insert(plantSettings)
      .values({ tenantId: user.tenantId, notMarkedHour: input.hour, ...who })
      .onConflictDoUpdate({ target: plantSettings.tenantId, set: { notMarkedHour: input.hour, ...who } })
      .returning();
    if (from !== input.hour) await audit(tx, user, "settings.not_marked", null, { from, to: input.hour });
    return toView(row!);
  });
}

/** Owner: a new QR. The old key stops at once; the new print must go up at the scan spot. */
export async function newQr(user: AtUser): Promise<SettingsView> {
  requireAccess(user, "settings");
  const madeAt = new Date();
  const hash = sha256(qrKeyFor(user.tenantId, madeAt));
  return withTenant(user.tenantId, async (tx) => {
    const who = { updatedBy: user.userId, updatedByName: user.name, updatedAt: madeAt };
    const [row] = await tx
      .insert(plantSettings)
      .values({ tenantId: user.tenantId, qrKeyHash: hash, qrMadeAt: madeAt, ...who })
      .onConflictDoUpdate({ target: plantSettings.tenantId, set: { qrKeyHash: hash, qrMadeAt: madeAt, ...who } })
      .returning();
    await audit(tx, user, "qr.new", null, { made_at: madeAt.toISOString() }); // never the key
    return toView(row!);
  });
}

/** Owner: the link printed in the QR right now (null until a QR is made). */
export async function qrLinkFor(user: AtUser, origin: string): Promise<string | null> {
  requireAccess(user, "settings");
  const row = await withTenant(user.tenantId, (tx) => readSettings(tx, user.tenantId));
  if (!row?.qrMadeAt) return null;
  return new URL(`/scan?k=${qrKeyFor(user.tenantId, row.qrMadeAt)}`, env.publicUrl || origin).toString();
}

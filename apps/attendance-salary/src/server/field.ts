// Field day log (docs/FIELD_DAY_PHASE_PLAN.md): Field staff record their day on their own phone: start (location,
// place, meter km + photo), each shop visited (a Sales customer or a typed shop, meeting notes, optionally the shop's
// location saved in Sales), end. Documentation only: nothing here touches claims or pay.
//
// Rules (owner, 2026-10-19 / 2026-11-14):
//   * only Plant staff with the owner's Field staff tick for that month, and only for today (after midnight: last
//     night's open day can still get visits and its End)
//   * a rough location (worse than ±150 m) is saved and marked, never saved as a shop's location; no location = refused
//   * mistakes: a corrected start / end is a new row with a reason, a removed visit a cancel row with a reason; the
//     person on the same day only, the owner on any day. Nothing is changed or deleted (the database refuses it).
//   * the owner, Supervisors (read-only) and the person themself see a day; support read-only; Office staff never.
// The browser never sees a Sales lookup ticket: searches and shop locations go through this server.
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchLookupTicket } from "@plantops/auth";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { normalisePhone } from "@plantops/module-kit/phone";
import { fileSha256, newStorageKey, sniffType } from "@plantops/module-kit/storage";
import { addDays, istDay, istMonth, monthDays, validDay, validMonth } from "@/lib/days";
import { fieldDayView, isRough, mapsUrl, openDayFor, parseKm, ROUGH_M, type DayState, type FieldCancelRow, type FieldDayView, type FieldEventRow } from "@/lib/field";
import { settingFor } from "@/lib/salary";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { loadClaims } from "./claims";
import { schema, withTenant, type AtTx } from "./db";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";
import { kit } from "./kit";
import { dbNow, lockPerson } from "./marks";
import type { AtUser } from "./session";
import { fileStorage, lockStorage, MAX_PHOTO_BYTES, storageLimitBytes, storageUsedBytes } from "./storage";

const { fieldEvents, fieldEventFiles, fieldEventCancels, salarySettings, supportViews } = schema;

/** A new meter photo can be used for a start / end within this time of uploading it. */
export const PHOTO_USE_WITHIN_MS = 24 * 60 * 60 * 1000;
/** Sales has this long to answer a search or a shop location. */
const SALES_TIMEOUT_MS = 3_000;

const by = (u: AtUser) => u.name.slice(0, 100);
const NOT_FIELD_STAFF = "The field day is only for field staff. Ask the owner.";
const NO_LOCATION = "No location. Allow location for this site in the phone's settings, switch location on, and try again.";

// ---------- loading ----------

type EventRecord = typeof fieldEvents.$inferSelect;

const toRow = (r: EventRecord): FieldEventRow => ({
  id: r.id,
  userId: r.userId,
  userName: r.userName,
  onDate: r.onDate,
  kind: r.kind,
  lat: r.lat === null ? null : Number(r.lat),
  lng: r.lng === null ? null : Number(r.lng),
  accuracyM: r.accuracyM,
  placeText: r.placeText,
  kmTenths: r.kmTenths,
  photoFileId: r.photoFileId,
  correctsId: r.correctsId,
  reason: r.reason,
  customerId: r.customerId,
  customerName: r.customerName,
  customerPlace: r.customerPlace,
  customerPhone: r.customerPhone,
  saveLocation: r.saveLocation,
  note: r.note,
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  at: r.createdAt.toISOString(),
});

interface Loaded {
  events: FieldEventRow[];
  cancels: FieldCancelRow[];
  /** the newest name copied on the rows */
  name: string | null;
}

/** One person's rows (or everyone's, without `personId`) between two India dates, oldest first. */
async function loadRows(tx: AtTx, tenantId: string, opts: { personId?: string; from: string; to: string }): Promise<Loaded> {
  const rows = await tx
    .select()
    .from(fieldEvents)
    .where(
      and(
        eq(fieldEvents.tenantId, tenantId),
        gte(fieldEvents.onDate, opts.from),
        lte(fieldEvents.onDate, opts.to),
        ...(opts.personId ? [eq(fieldEvents.userId, opts.personId)] : []),
      ),
    )
    .orderBy(asc(fieldEvents.createdAt), asc(fieldEvents.id));
  const ids = rows.filter((r) => r.kind === "visit").map((r) => r.id);
  const cancels = ids.length
    ? await tx
        .select()
        .from(fieldEventCancels)
        .where(and(eq(fieldEventCancels.tenantId, tenantId), inArray(fieldEventCancels.eventId, ids)))
    : [];
  return {
    events: rows.map(toRow),
    cancels: cancels.map((c) => ({ eventId: c.eventId, reason: c.reason, createdByName: c.createdByName, at: c.createdAt.toISOString() })),
    name: rows.at(-1)?.userName ?? null,
  };
}

const stateOf = (events: readonly FieldEventRow[], date: string): DayState => ({
  started: events.some((e) => e.onDate === date && e.kind === "start"),
  ended: events.some((e) => e.onDate === date && e.kind === "end"),
});

/** Has this person the owner's Field staff tick in the setting for that month? */
async function ticked(tx: AtTx, tenantId: string, personId: string, month: string) {
  const rows = await tx.select().from(salarySettings).where(and(eq(salarySettings.tenantId, tenantId), eq(salarySettings.userId, personId)));
  return !!settingFor(rows.map((r) => ({ ...r, fromMonth: r.fromMonth.slice(0, 7) })), month)?.fieldStaff;
}

/** Today, yesterday, both days' state and the open day (see openDayFor) for one person. */
async function dayContext(tx: AtTx, tenantId: string, personId: string, now: Date) {
  const today = istDay(now);
  const yesterday = addDays(today, -1);
  const loaded = await loadRows(tx, tenantId, { personId, from: yesterday, to: today });
  const states = { today: stateOf(loaded.events, today), yesterday: stateOf(loaded.events, yesterday) };
  return { today, yesterday, states, open: openDayFor(today, yesterday, states), ...loaded };
}

/** May the person still fix rows of this day themselves: today, or last night's round while it is not ended. */
const ownDayEditable = (ctx: Awaited<ReturnType<typeof dayContext>>, onDate: string) =>
  onDate === ctx.today || (onDate === ctx.yesterday && ctx.states.yesterday.started && !ctx.states.yesterday.ended);

/**
 * Does this person have My field day at all: Plant staff (field_own) with the Field staff tick for this month, or a
 * round from last night still open. Without, there is no tab and the page is 404.
 */
export async function hasFieldDay(user: AtUser, now: Date = new Date()): Promise<boolean> {
  if (!can(user, "field_own")) return false;
  return withTenant(user.tenantId, async (tx) => {
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    return (await ticked(tx, user.tenantId, user.userId, ctx.today.slice(0, 7))) || ctx.open === ctx.yesterday;
  });
}

// ---------- input ----------

const Location = {
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  accuracy_m: z.number().min(0).max(100_000).nullish(),
};

/** The phone's reading, rounded as stored; refused when there is none. */
function location(input: { lat?: number | null; lng?: number | null; accuracy_m?: number | null }) {
  if (input.lat == null || input.lng == null || input.accuracy_m == null) throw badRequest(NO_LOCATION);
  return { lat: String(Math.round(input.lat * 1e6) / 1e6), lng: String(Math.round(input.lng * 1e6) / 1e6), accuracyM: Math.round(input.accuracy_m) };
}

/** Free text: trimmed, empty = none, at most `max` characters. */
function text(v: string | null | undefined, max: number, what: string): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (t.length > max) throw badRequest(`${what}: at most ${max} characters`);
  return t;
}

function km(typed: string | null | undefined): number {
  const k = parseKm(typed ?? "");
  if (k === null) throw badRequest("Km reading: up to 9999999.9, at most one decimal (45210 or 45210.5)");
  return k;
}

function reasonOf(v: string | null | undefined) {
  const r = (v ?? "").trim();
  if (r.length < 3 || r.length > 300) throw badRequest("Write why (3 to 300 characters)");
  return r;
}

/** A new meter photo for `personId`'s day: uploaded by `actor`, recently, and not used by another start / end yet. */
async function freshPhoto(tx: AtTx, actor: AtUser, personId: string, photoId: string, now: Date) {
  const [f] = await tx.select().from(fieldEventFiles).where(and(eq(fieldEventFiles.tenantId, actor.tenantId), eq(fieldEventFiles.id, photoId)));
  if (!f || f.userId !== personId || f.createdBy !== actor.userId) throw badRequest("Take the photo of the meter again");
  if (now.getTime() - f.createdAt.getTime() > PHOTO_USE_WITHIN_MS) throw badRequest("That photo is too old. Take the photo of the meter again.");
  const [used] = await tx.select({ id: fieldEvents.id }).from(fieldEvents).where(and(eq(fieldEvents.tenantId, actor.tenantId), eq(fieldEvents.photoFileId, photoId))).limit(1);
  if (used) throw badRequest("That photo was already saved. Take a new photo of the meter.");
  return f.id;
}

// ---------- the meter photo ----------

/**
 * A meter photo, uploaded before its start / end (or a correction). Your own day (field_own), or for the owner
 * correcting someone's reading (`personId`, field_fix). Photos only, ≤ 10 MB, the plan's storage limit (claim photos and
 * field photos together).
 */
export async function uploadFieldPhoto(user: AtUser, data: Buffer, opts: { personId?: string | null } = {}) {
  const personId = opts.personId ?? user.userId;
  requireAccess(user, personId === user.userId && can(user, "field_own") ? "field_own" : "field_fix");
  if (!data.length) throw badRequest("The photo is empty");
  const type = sniffType(data);
  if (!type || type === "application/pdf") throw new HttpError(415, "Only photos (JPG, PNG, WebP) can be added");
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photos can be at most 10 MB");
  const limit = await storageLimitBytes(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    let usedBefore = 0;
    if (limit !== null) {
      await lockStorage(tx, user.tenantId);
      usedBefore = await storageUsedBytes(tx, user.tenantId);
      if (usedBefore + data.length > limit) throw new HttpError(413, "Storage full for your plan – ask PlantOps to extend it");
    }
    const key = newStorageKey(user.tenantId);
    await fileStorage().put(key, data, type);
    const [row] = await tx
      .insert(fieldEventFiles)
      .values({ tenantId: user.tenantId, userId: personId, storageKey: key, contentType: type, sizeBytes: data.length, sha256: fileSha256(data), createdBy: user.userId, createdByName: by(user) })
      .returning();
    return { id: row!.id, size: row!.sizeBytes, storage: limit === null ? null : { before: usedBefore, after: usedBefore + data.length, limit } };
  });
}

/** A meter photo: the owner, Supervisors and support (logged), or the person whose day it is. Anyone else: 404. */
export async function readFieldPhoto(user: AtUser, fileId: string) {
  const row = await withTenant(user.tenantId, async (tx) => {
    const [f] = await tx.select().from(fieldEventFiles).where(and(eq(fieldEventFiles.tenantId, user.tenantId), eq(fieldEventFiles.id, fileId)));
    if (!f || (f.userId !== user.userId && !can(user, "field_view"))) throw notFound("Photo not found");
    if (user.isSupport) await tx.insert(supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/field-photos/${fileId}` });
    return f;
  });
  return { contentType: row.contentType, data: await fileStorage().get(row.storageKey) };
}

// ---------- start / visit / end ----------

export const StartEndInput = z.object({ ...Location, place: z.string().max(200).nullish(), km: z.string().max(20), photo_id: z.uuid() });

/** Start my day: today only, once (a wrong km is a correction). */
export async function startDay(user: AtUser, input: z.infer<typeof StartEndInput>) {
  requireAccess(user, "field_own");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, user.userId);
    const now = await dbNow(tx);
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    if (!(await ticked(tx, user.tenantId, user.userId, ctx.today.slice(0, 7)))) throw notFound(NOT_FIELD_STAFF);
    if (ctx.states.today.started) throw conflict("You already started today. Use “Correct start km” to fix the reading.");
    const loc = location(input);
    const kmTenths = km(input.km);
    const photoFileId = await freshPhoto(tx, user, user.userId, input.photo_id, now);
    const [row] = await tx
      .insert(fieldEvents)
      .values({ tenantId: user.tenantId, userId: user.userId, userName: by(user), onDate: ctx.today, kind: "start", ...loc, placeText: text(input.place, 100, "Place"), kmTenths, photoFileId, createdBy: user.userId, createdByName: by(user) })
      .returning();
    return { id: row!.id, on_date: ctx.today, rough: isRough(loc.accuracyM) };
  });
}

export const VisitInput = z.object({
  ...Location,
  /** a Sales customer picked from the search (its name / place copied) */
  customer_id: z.uuid().nullish(),
  customer_name: z.string().max(200),
  customer_place: z.string().max(200).nullish(),
  /** a typed shop's phone (optional, Indian mobile) */
  phone: z.string().max(30).nullish(),
  note: z.string().max(400).nullish(),
  /** "Save this location as the shop's location" (a Sales customer, ±150 m or better) */
  save_location: z.boolean().nullish(),
});

export type ShopLocationState = "saved" | "not_saved" | "unknown";

/**
 * A shop visited, on the open day (today's, or last night's round after midnight). The visit is saved first; the shop's
 * location goes to Sales after it (`sendShopLocation`), so a Sales failure never loses the visit.
 */
export async function addVisit(user: AtUser, input: z.infer<typeof VisitInput>) {
  requireAccess(user, "field_own");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, user.userId);
    const now = await dbNow(tx);
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    if (!ctx.open) throw badRequest("Start your day first");
    if (ctx.states[ctx.open === ctx.today ? "today" : "yesterday"].ended) throw conflict("Your field day is already ended");
    const loc = location(input);
    const name = text(input.customer_name, 100, "Shop name");
    if (!name) throw badRequest("Pick the customer, or type the shop's name");
    const customerId = input.customer_id ?? null;
    let phone: string | null = null;
    if (input.phone?.trim()) {
      if (customerId) throw badRequest("A phone number is only for a shop that isn't in the list");
      phone = normalisePhone(input.phone);
      if (!phone) throw badRequest("Phone: a 10-digit Indian mobile number (starting 6–9)");
    }
    const save = customerId ? !!input.save_location : null;
    if (!customerId && input.save_location) throw badRequest("A typed shop can't save a location: there is no customer to save it on");
    if (save && loc.accuracyM > ROUGH_M) throw badRequest(`Location too rough (±${loc.accuracyM} m) to save for the shop. Untick it to save the visit.`);
    const [row] = await tx
      .insert(fieldEvents)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        userName: by(user),
        onDate: ctx.open,
        kind: "visit",
        ...loc,
        customerId,
        customerName: name,
        customerPlace: text(input.customer_place, 100, "Place"),
        customerPhone: phone,
        saveLocation: save,
        note: text(input.note, 300, "Meeting notes"),
        createdBy: user.userId,
        createdByName: by(user),
      })
      .returning();
    return { id: row!.id, on_date: ctx.open, rough: isRough(loc.accuracyM), save_location: !!save };
  });
}

/** End my day: closes the open day (an End after midnight closes last night's round). km at least the start's. */
export async function endDay(user: AtUser, input: z.infer<typeof StartEndInput>) {
  requireAccess(user, "field_own");
  return withTenant(user.tenantId, async (tx) => {
    await lockPerson(tx, user.tenantId, user.userId);
    const now = await dbNow(tx);
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    if (!ctx.open) throw badRequest("Start your day first");
    const day = fieldDayView(ctx.open, ctx.events, ctx.cancels);
    if (day.end) throw conflict("You already ended this field day. Use “Correct end km” to fix the reading.");
    const loc = location(input);
    const kmTenths = km(input.km);
    if (day.start && kmTenths < day.start.kmTenths!) throw badRequest(`The end reading can't be below the start (${(day.start.kmTenths! / 10).toFixed(1)} km)`);
    const photoFileId = await freshPhoto(tx, user, user.userId, input.photo_id, now);
    const [row] = await tx
      .insert(fieldEvents)
      .values({ tenantId: user.tenantId, userId: user.userId, userName: by(user), onDate: ctx.open, kind: "end", ...loc, placeText: text(input.place, 100, "Place"), kmTenths, photoFileId, createdBy: user.userId, createdByName: by(user) })
      .returning();
    return { id: row!.id, on_date: ctx.open, km_tenths: day.start ? kmTenths - day.start.kmTenths! : null };
  });
}

// ---------- mistakes ----------

/** The row and whether `user` may fix it: the person on the same day, the owner any day; others 404 / 403. */
async function fixable(tx: AtTx, user: AtUser, eventId: string, now: Date) {
  const [r] = await tx.select().from(fieldEvents).where(and(eq(fieldEvents.tenantId, user.tenantId), eq(fieldEvents.id, eventId)));
  if (!r || (r.userId !== user.userId && !can(user, "field_view"))) throw notFound("Not found");
  await lockPerson(tx, user.tenantId, r.userId);
  if (r.userId === user.userId && can(user, "field_own") && !can(user, "field_fix")) {
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    if (!ownDayEditable(ctx, r.onDate)) throw forbidden("You can fix your field day on the same day only. Ask the owner.");
  } else {
    requireAccess(user, "field_fix");
  }
  return r;
}

export const CorrectInput = z.object({ event_id: z.uuid(), km: z.string().max(20), photo_id: z.uuid().nullish(), reason: z.string().max(400) });

/**
 * A wrong start / end km: a new row pointing to the one it replaces, with a reason. Keeps that row's location and place,
 * and its photo unless a new one is given. The end still at least the start.
 */
export async function correctStartEnd(user: AtUser, input: z.infer<typeof CorrectInput>) {
  if (!can(user, "field_own") && !can(user, "field_fix")) requireAccess(user, "field_fix");
  return withTenant(user.tenantId, async (tx) => {
    const now = await dbNow(tx);
    const r = await fixable(tx, user, input.event_id, now);
    if (r.kind === "visit") throw badRequest("A visit is removed, not corrected");
    const all = await loadRows(tx, user.tenantId, { personId: r.userId, from: r.onDate, to: r.onDate });
    const day = fieldDayView(r.onDate, all.events, all.cancels);
    const current = r.kind === "start" ? day.start : day.end;
    if (current?.id !== r.id) throw conflict("This reading was already corrected. Open the day again.");
    const kmTenths = km(input.km);
    const reason = reasonOf(input.reason);
    if (r.kind === "start" && day.end && kmTenths > day.end.kmTenths!) throw badRequest(`The start reading can't be above the end (${(day.end.kmTenths! / 10).toFixed(1)} km)`);
    if (r.kind === "end" && day.start && kmTenths < day.start.kmTenths!) throw badRequest(`The end reading can't be below the start (${(day.start.kmTenths! / 10).toFixed(1)} km)`);
    const photoFileId = input.photo_id ? await freshPhoto(tx, user, r.userId, input.photo_id, now) : r.photoFileId;
    const [row] = await tx
      .insert(fieldEvents)
      .values({ tenantId: user.tenantId, userId: r.userId, userName: r.userName, onDate: r.onDate, kind: r.kind, lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, placeText: r.placeText, kmTenths, photoFileId, correctsId: r.id, reason, createdBy: user.userId, createdByName: by(user) })
      .returning();
    await audit(tx, user, "field.correct", row!.id, { person: r.userName, on: r.onDate, kind: r.kind, from_km: r.kmTenths, to_km: kmTenths, new_photo: !!input.photo_id, reason });
    return { id: row!.id };
  });
}

export const RemoveInput = z.object({ event_id: z.uuid(), reason: z.string().max(400) });

/** A wrong visit: removed with a reason, once. It stays on record, crossed out. A shop location already saved stays in Sales. */
export async function removeVisit(user: AtUser, input: z.infer<typeof RemoveInput>) {
  if (!can(user, "field_own") && !can(user, "field_fix")) requireAccess(user, "field_fix");
  return withTenant(user.tenantId, async (tx) => {
    const now = await dbNow(tx);
    const r = await fixable(tx, user, input.event_id, now);
    if (r.kind !== "visit") throw badRequest("Only a visit can be removed. Correct the km reading instead.");
    const reason = reasonOf(input.reason);
    const [row] = await tx
      .insert(fieldEventCancels)
      .values({ tenantId: user.tenantId, eventId: r.id, reason, createdBy: user.userId, createdByName: by(user) })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict("This visit was already removed");
    await audit(tx, user, "field.remove", r.id, { person: r.userName, on: r.onDate, shop: r.customerName, reason });
    return { id: row.id };
  });
}

// ---------- Sales: the customer search and the shop's location ----------

export interface SalesCustomer {
  id: string;
  name: string;
  place: string;
  location: { at: string; by: string; source: string } | null;
}

/** A ticket for Sales, or null when Sales is off for the plant / the platform can't be reached. */
async function salesTicket(tenantId: string, scope: "customers" | "customer_location") {
  return fetchLookupTicket(kit.creds(), tenantId, "order_capture", scope).catch(() => null);
}

async function salesCall(t: { ticket: string; url: string }, path: string, init: RequestInit = {}) {
  const res = await fetch(new URL(path, t.url), {
    ...init,
    headers: { authorization: `Bearer ${t.ticket}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(SALES_TIMEOUT_MS),
  });
  return res;
}

/**
 * The visit screen's customer search (name, place, or 6+ digits of a phone). `available: false` = "Customer list
 * unavailable, type the shop name" (Sales off, not answering in 3 s, or an error).
 */
export async function searchCustomers(user: AtUser, q: string): Promise<{ available: boolean; customers: SalesCustomer[] }> {
  requireAccess(user, "field_own");
  const query = q.trim();
  if (query.length < 2 || query.length > 60) return { available: true, customers: [] };
  const t = await salesTicket(user.tenantId, "customers");
  if (!t) return { available: false, customers: [] };
  try {
    const res = await salesCall(t, `/api/plantops/customers?q=${encodeURIComponent(query)}`);
    if (!res.ok) return { available: false, customers: [] };
    const body = z.object({ customers: z.array(z.object({ id: z.string(), name: z.string(), place: z.string(), location: z.object({ at: z.string(), by: z.string(), source: z.string() }).nullable() })) }).parse(await res.json());
    return { available: true, customers: body.customers };
  } catch {
    return { available: false, customers: [] };
  }
}

/**
 * Sends a visit's location to Sales as the shop's location (after the visit is saved, and again from "Try again").
 * Once per visit: Sales keys it on the visit id, so a resend never saves twice. Only the person who visited.
 */
export async function sendShopLocation(user: AtUser, visitId: string): Promise<{ state: ShopLocationState; message?: string }> {
  requireAccess(user, "field_own");
  const r = await withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(fieldEvents).where(and(eq(fieldEvents.tenantId, user.tenantId), eq(fieldEvents.id, visitId), eq(fieldEvents.userId, user.userId)));
    if (!row || row.kind !== "visit") throw notFound("Visit not found");
    const [cancel] = await tx.select({ id: fieldEventCancels.id }).from(fieldEventCancels).where(and(eq(fieldEventCancels.tenantId, user.tenantId), eq(fieldEventCancels.eventId, visitId)));
    if (cancel) throw conflict("This visit was removed");
    return row;
  });
  if (!r.saveLocation || !r.customerId || r.lat === null || r.lng === null) throw badRequest("This visit didn't ask to save the shop's location");
  const t = await salesTicket(user.tenantId, "customer_location");
  if (!t) return { state: "not_saved", message: "Shop location not saved (customer list unavailable)" };
  try {
    const res = await salesCall(t, `/api/plantops/customers/${r.customerId}/location`, {
      method: "POST",
      body: JSON.stringify({ lat: Number(r.lat), lng: Number(r.lng), accuracy_m: r.accuracyM, visit_id: r.id, set_by_user_id: r.userId, set_by_name: r.userName.slice(0, 80) }),
    });
    if (res.ok) return { state: "saved" };
    const message = res.status === 404 ? "Shop location not saved: the customer was switched off in Sales" : res.status === 400 ? "Shop location not saved: location too rough" : "Shop location not saved (customer list unavailable)";
    return { state: "not_saved", message };
  } catch {
    return { state: "not_saved", message: "Shop location not saved (customer list unavailable)" };
  }
}

/**
 * For the day pages: which ticked visits saved the shop's location, read from Sales (never stored here). "unknown"
 * when Sales can't say (off, not answering, or a Sales without this check yet).
 */
async function shopLocationStates(tenantId: string, visits: readonly FieldEventRow[]): Promise<Record<string, ShopLocationState>> {
  const ticked = visits.filter((v) => v.saveLocation).map((v) => v.id);
  if (ticked.length === 0) return {};
  const unknown = Object.fromEntries(ticked.map((id) => [id, "unknown" as const]));
  const t = await salesTicket(tenantId, "customer_location");
  if (!t) return unknown;
  try {
    const res = await salesCall(t, "/api/plantops/locations/by-visit", { method: "POST", body: JSON.stringify({ visit_ids: ticked }) });
    if (!res.ok) return unknown;
    const saved = new Set(z.object({ saved: z.array(z.string()) }).parse(await res.json()).saved);
    return Object.fromEntries(ticked.map((id) => [id, saved.has(id) ? ("saved" as const) : ("not_saved" as const)]));
  } catch {
    return unknown;
  }
}

// ---------- views ----------

export interface MyFieldDay {
  today: string;
  /** the day on screen: today's, or last night's round while it is still open */
  day: FieldDayView;
  /** Start my day is offered: ticked this month and today not started */
  canStart: boolean;
  /** visits that asked to save the shop's location: saved in Sales or not */
  locations: Record<string, ShopLocationState>;
}

/** The worker's own field day (My field day). 404 when they don't have it (see hasFieldDay). */
export async function myFieldDay(user: AtUser, now: Date = new Date()): Promise<MyFieldDay> {
  if (!can(user, "field_own")) throw notFound();
  const r = await withTenant(user.tenantId, async (tx) => {
    const ctx = await dayContext(tx, user.tenantId, user.userId, now);
    const isTicked = await ticked(tx, user.tenantId, user.userId, ctx.today.slice(0, 7));
    if (!isTicked && ctx.open !== ctx.yesterday) throw notFound();
    const date = ctx.states.today.started ? ctx.today : ctx.open ?? ctx.today;
    return { ctx, isTicked, day: fieldDayView(date, ctx.events, ctx.cancels) };
  });
  return {
    today: r.ctx.today,
    day: r.day,
    canStart: r.isTicked && !r.ctx.states.today.started,
    locations: await shopLocationStates(user.tenantId, r.day.visits),
  };
}

export interface FieldDayPage {
  person: { userId: string; name: string };
  day: FieldDayView;
  locations: Record<string, ShopLocationState>;
  /** that person's field-duty claims on that date (km claimed, status): the "claimed 90 km · meter 84.3 km" line */
  claims: { km: number; status: string }[];
  /** the owner may correct / remove */
  canFix: boolean;
}

/** One person's field day: the owner, Supervisors, support (logged by the page), or the person themself. */
export async function fieldDay(user: AtUser, personId: string, date: string): Promise<FieldDayPage> {
  if (!validDay(date)) throw notFound();
  if (personId !== user.userId || !can(user, "field_own")) {
    if (!can(user, "field_view")) throw notFound();
  }
  const r = await withTenant(user.tenantId, async (tx) => {
    const loaded = await loadRows(tx, user.tenantId, { personId, from: date, to: date });
    if (!loaded.name) throw notFound("No field day on that date");
    const claims = can(user, "claim_view") ? (await loadClaims(tx, user.tenantId, { personId, from: date, to: date })).filter((c) => c.kind === "field_duty" && c.status !== "withdrawn") : [];
    return { loaded, claims };
  });
  const day = fieldDayView(date, r.loaded.events, r.loaded.cancels);
  return {
    person: { userId: personId, name: r.loaded.name! },
    day,
    locations: await shopLocationStates(user.tenantId, day.visits),
    claims: r.claims.map((c) => ({ km: (c.kmTenths ?? 0) / 10, status: c.status })),
    canFix: can(user, "field_fix"),
  };
}

export interface FieldMonthRow {
  date: string;
  startedAt: string | null;
  endedAt: string | null;
  kmTenths: number | null;
  visits: number;
  notEnded: boolean;
  rough: boolean;
}

export interface FieldMonth {
  person: { userId: string; name: string };
  month: string;
  prev: string;
  next: string | null;
  /** newest date first */
  days: FieldMonthRow[];
  totals: { kmTenths: number; visits: number; days: number };
  canExport: boolean;
}

/** A person's field days in a month (owner, Supervisor, support). The person's name from their rows, else the platform. */
export async function fieldMonth(user: AtUser, personId: string, month: string | null, now: Date = new Date()): Promise<FieldMonth> {
  if (!can(user, "field_view")) throw notFound();
  const m = month ?? istMonth(now);
  if (!validMonth(m) || m > istMonth(now)) throw notFound();
  const days = monthDays(m);
  const loaded = await withTenant(user.tenantId, (tx) => loadRows(tx, user.tenantId, { personId, from: days[0]!, to: days.at(-1)! }));
  const name = loaded.name ?? (await kit.contacts(user.tenantId))?.find((c) => c.user_id === personId)?.display_name ?? null;
  if (!name) throw notFound();
  const rows = [...new Set(loaded.events.map((e) => e.onDate))]
    .sort()
    .reverse()
    .map((date) => {
      const d = fieldDayView(date, loaded.events, loaded.cancels);
      return { date, startedAt: d.startedAt, endedAt: d.endedAt, kmTenths: d.kmTenths, visits: d.visits.length, notEnded: d.notEnded, rough: d.anyRough };
    });
  return {
    person: { userId: personId, name },
    month: m,
    prev: addDays(`${m}-01`, -1).slice(0, 7),
    next: m < istMonth(now) ? addDays(days.at(-1)!, 1).slice(0, 7) : null,
    days: rows,
    totals: { kmTenths: rows.reduce((s, d) => s + (d.kmTenths ?? 0), 0), visits: rows.reduce((s, d) => s + d.visits, 0), days: rows.length },
    canExport: can(user, "field_fix"),
  };
}

/** Has this person any field day on record (the person page shows the Field days link)? */
export async function hasFieldDays(tenantId: string, personId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [r] = await tx.select({ id: fieldEvents.id }).from(fieldEvents).where(and(eq(fieldEvents.tenantId, tenantId), eq(fieldEvents.userId, personId))).limit(1);
    return !!r;
  });
}

export interface InTheField {
  userId: string;
  name: string;
  startedAt: string;
  lastVisit: { name: string; at: string } | null;
}

/** The Today board's "In the field" card: today's started, not ended rounds, with each person's last visit. */
export async function inTheField(tenantId: string, now: Date = new Date()): Promise<InTheField[]> {
  const today = istDay(now);
  const loaded = await withTenant(tenantId, (tx) => loadRows(tx, tenantId, { from: today, to: today }));
  const people = new Map<string, FieldEventRow[]>();
  for (const e of loaded.events) people.set(e.userId, [...(people.get(e.userId) ?? []), e]);
  const out: InTheField[] = [];
  for (const [userId, events] of people) {
    const d = fieldDayView(today, events, loaded.cancels);
    if (!d.notEnded) continue;
    const last = d.visits.at(-1);
    out.push({ userId, name: events.at(-1)!.userName, startedAt: d.startedAt!, lastVisit: last ? { name: last.customerName!, at: last.at } : null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * The Claims tab's line: km by meter and shops for each (person, date) with a field day. Key `${userId}:${date}`.
 * Read-only; claims and pay never change.
 */
export async function metersFor(tenantId: string, pairs: readonly { userId: string; date: string }[]): Promise<Map<string, { kmTenths: number | null; visits: number }>> {
  const out = new Map<string, { kmTenths: number | null; visits: number }>();
  if (pairs.length === 0) return out;
  const dates = pairs.map((p) => p.date).sort();
  const loaded = await withTenant(tenantId, (tx) => loadRows(tx, tenantId, { from: dates[0]!, to: dates.at(-1)! }));
  for (const p of pairs) {
    const events = loaded.events.filter((e) => e.userId === p.userId && e.onDate === p.date);
    if (events.length === 0) continue;
    const d = fieldDayView(p.date, events, loaded.cancels);
    out.set(`${p.userId}:${p.date}`, { kmTenths: d.kmTenths, visits: d.visits.length });
  }
  return out;
}

/** Everyone's field day on one India date (Sales' Day report): km by meter, shops, ended or not. Read-only. */
export async function fieldDaysOn(tenantId: string, date: string): Promise<{ name: string; kmTenths: number | null; visits: number; notEnded: boolean }[]> {
  const loaded = await withTenant(tenantId, (tx) => loadRows(tx, tenantId, { from: date, to: date }));
  const people = new Map<string, FieldEventRow[]>();
  for (const e of loaded.events) people.set(e.userId, [...(people.get(e.userId) ?? []), e]);
  return [...people.values()]
    .map((events) => {
      const d = fieldDayView(date, events, loaded.cancels);
      return { name: events.at(-1)!.userName, kmTenths: d.kmTenths, visits: d.visits.length, notEnded: d.notEnded };
    })
    .filter((d) => d.visits || d.kmTenths !== null || d.notEnded)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export interface NotEnded {
  userId: string;
  name: string;
  date: string;
  startedAt: string;
  shops: number;
}

/**
 * Yesterday's field days that were started and never ended, for the 07:00 bell (docs/FIELD_DAY_PHASE_PLAN.md
 * "Notifications"). The person can still end it later (until they start a new day); the bell is sent once either way.
 */
export async function notEndedYesterday(tenantId: string, now: Date = new Date()): Promise<NotEnded[]> {
  const yesterday = addDays(istDay(now), -1);
  const loaded = await withTenant(tenantId, (tx) => loadRows(tx, tenantId, { from: yesterday, to: yesterday }));
  const people = new Map<string, FieldEventRow[]>();
  for (const e of loaded.events) people.set(e.userId, [...(people.get(e.userId) ?? []), e]);
  const out: NotEnded[] = [];
  for (const [userId, events] of people) {
    const d = fieldDayView(yesterday, events, loaded.cancels);
    if (d.notEnded) out.push({ userId, name: events.at(-1)!.userName, date: yesterday, startedAt: d.startedAt!, shops: d.visits.length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// ---------- CSV ----------

export const FIELD_CSV_HEADER = ["Date", "Person", "Time", "Kind", "Shop", "Place", "Phone", "Latitude", "Longitude", "Accuracy m", "Km", "Meeting notes", "Removed", "Replaced", "Reason"];

/** The owner's CSV of one person's field month: one row per start / visit / end (replaced and removed ones flagged). */
export async function fieldCsv(user: AtUser, personId: string, month: string) {
  requireAccess(user, "field_fix");
  if (!validMonth(month)) throw badRequest("Pick a month");
  const days = monthDays(month);
  return withTenant(user.tenantId, async (tx) => {
    const loaded = await loadRows(tx, user.tenantId, { personId, from: days[0]!, to: days.at(-1)! });
    const rows: unknown[][] = [FIELD_CSV_HEADER];
    for (const date of [...new Set(loaded.events.map((e) => e.onDate))].sort()) {
      for (const t of fieldDayView(date, loaded.events, loaded.cancels).timeline) {
        rows.push([
          date,
          loaded.name,
          csvTime(t.at),
          t.kind === "start" ? "Start" : t.kind === "end" ? "End" : "Visit",
          t.customerName ?? "",
          t.kind === "visit" ? (t.customerPlace ?? "") : (t.placeText ?? ""),
          t.customerPhone ?? "",
          t.lat ?? "",
          t.lng ?? "",
          t.accuracyM ?? "",
          t.kmTenths === null ? "" : (t.kmTenths / 10).toFixed(1),
          t.note ?? "",
          t.removed ? "yes" : "",
          t.replaced ? "yes" : "",
          t.removed?.reason ?? t.reason ?? "",
        ]);
      }
    }
    await audit(tx, user, "export.field_csv", personId, { person: loaded.name, month, rows: rows.length - 1 });
    return { name: loaded.name ?? "field", body: csv(rows) };
  });
}

export { mapsUrl };

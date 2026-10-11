import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import type { RoleId } from "@plantops/types";
import { complaintDb } from "@/server/db";
import { supportUser, toCbUser, type CbUser } from "@/server/session";

/** A Complaint Box user of one plant, as the session would describe them. */
export function cbUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): CbUser {
  const now = Date.now();
  return toCbUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["complaint_box"], login_at: now, checked_at: now });
}

/** A fresh plant: owner, complaint desk, plant staff, a store keeper (no Complaint Box role) and PlantOps support. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: cbUser(tenantId, ["tenant_admin"], "Sujata"),
    desk: cbUser(tenantId, ["complaint_desk"], "Atharv"),
    staff: cbUser(tenantId, ["plant_staff"], "Kedar"),
    keeper: cbUser(tenantId, ["store_keeper"], "Bindu"),
    support: supportUser(tenantId, randomUUID()),
  };
}

export async function asOwner<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await c.connect();
  try {
    return await c.query<T>(text, values);
  } finally {
    await c.end();
  }
}

/** Raw SQL as the app's own login (complaint_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return complaintDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return tx.execute(sql.raw(text));
  });
}

export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  throw new Error("Expected the database to refuse this, but it succeeded");
}

export async function refused(fn: () => unknown): Promise<{ status: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as Error & { status?: number };
    return { status: e.status ?? 0, message: e.message };
  }
  throw new Error("Expected this to be refused, but it succeeded");
}

/**
 * One plant's sample rows in every table, inserted as the app (so the grants are exercised too): an item, a
 * complaint, a note, a photo, a support view, an audit row and an outbox row. Returns their ids.
 */
export async function seedPlant(tenantId: string, refNo = 1) {
  const who = randomUUID();
  const one = async (text: string) => ((await asApp(tenantId, text)).rows[0] as { id: string }).id;
  const item = await one(`insert into complaint_box.items (tenant_id, name, created_by, created_by_name) values ('${tenantId}', '20 L jar', '${who}', 'Sujata') returning id`);
  const complaint = await one(`insert into complaint_box.complaints (tenant_id, ref_no, customer_name, phone_typed, phone, place, item_id, item_name, description, reported_by, reported_by_name)
    values ('${tenantId}', ${refNo}, 'Ramesh', '+91 98765 43210', '9876543210', 'Kalinga Nagar', '${item}', '20 L jar', 'Leaking from the cap', '${who}', 'Atharv') returning id`);
  const event = await one(`insert into complaint_box.complaint_events (tenant_id, complaint_id, kind, text, created_by, created_by_name) values ('${tenantId}', '${complaint}', 'note', 'Called back', '${who}', 'Atharv') returning id`);
  const file = await one(`insert into complaint_box.files (tenant_id, complaint_id, event_id, kind, content_type, size_bytes, sha256, storage_key, uploaded_by, uploaded_by_name)
    values ('${tenantId}', '${complaint}', '${event}', 'photo', 'image/jpeg', 1000, '${"a".repeat(64)}', 'tenant/${tenantId}/${randomUUID()}', '${who}', 'Atharv') returning id`);
  await asApp(tenantId, `insert into complaint_box.support_views (tenant_id, super_admin_id, super_admin_name, path) values ('${tenantId}', '${who}', 'PlantOps support', '/')`);
  await asApp(tenantId, `insert into complaint_box.audit_log (tenant_id, actor, action) values ('${tenantId}', 'user:${who}', 'item.added')`);
  const outbox = await one(`insert into complaint_box.notification_outbox (tenant_id, input) values ('${tenantId}', '{}') returning id`);
  return { who, item, complaint, event, file, outbox };
}

/** The tables in the complaint_box schema (the guard tests compare against this list). */
export const TABLES = ["audit_log", "complaint_events", "complaints", "files", "items", "notification_outbox", "support_views"];

// ---------- small sample files (only their first bytes matter to the checks) ----------
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(32, 1)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from("JFIF stub photo")]);
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 stub")]);
export const MP4 = ftyp("isom");
export const MOV = ftyp("qt  ");
export const HEIC = ftyp("heic");
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
export const SVG = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
export const HTML = Buffer.from("<!doctype html><html><body>hi</body></html>");
/** A photo / video of exactly `bytes` bytes. */
export const sized = (sample: Buffer, bytes: number) => Buffer.concat([sample, Buffer.alloc(Math.max(0, bytes - sample.length))]);

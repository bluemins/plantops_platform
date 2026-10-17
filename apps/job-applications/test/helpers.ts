import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import type { RoleId } from "@plantops/types";
import { jobsDb } from "@/server/db";
import { supportUser, toJaUser, type JaUser } from "@/server/session";

/** A Job applications user of one plant, as the session would describe them. */
export function jaUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): JaUser {
  const now = Date.now();
  return toJaUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["job_applications"], login_at: now, checked_at: now });
}

/** A fresh plant: owner, HR desk, HR desk who is also an employee, Plant staff only, a store keeper, PlantOps support. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: jaUser(tenantId, ["tenant_admin"], "Sujata"),
    hr: jaUser(tenantId, ["hr_desk"], "Meera"),
    hrStaff: jaUser(tenantId, ["hr_desk", "plant_staff"], "Kedar"),
    general: jaUser(tenantId, ["plant_staff"], "Reeta"),
    keeper: jaUser(tenantId, ["store_keeper"], "Bindu"),
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

/** Raw SQL as the app's own login (jobs_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return jobsDb().transaction(async (tx) => {
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

let nextRef = 1;
/** An application row for this plant, inserted as the app (`days` old: backdated by the owner login). */
export async function addApplication(tenantId: string, opts: { opening?: { id: string; title: string }; days?: number; phone?: string } = {}) {
  const ref = nextRef++;
  const o = opts.opening;
  const { rows } = await asApp(
    tenantId,
    `insert into job_applications.applications (tenant_id, ref_no, opening_id, opening_title, name, phone, place, consent_version, consent_at, request_key)
     values ('${tenantId}', ${ref}, ${o ? `'${o.id}'` : "null"}, ${o ? `'${o.title}'` : "null"}, 'Ramesh Sahu', '${opts.phone ?? "9876543210"}', 'Bargarh', 'v1', now(), '${randomUUID()}') returning id`,
  );
  const id = (rows[0] as { id: string }).id;
  if (opts.days) await asOwner("update job_applications.applications set created_at = now() - make_interval(days => $2) where id = $1", [id, opts.days]);
  return { id, ref };
}

/**
 * One plant's sample rows in every table, inserted as the app (so the grants are exercised too): an opening, the page
 * message, an application with a note and a resume page, a support view, an audit row, an outbox row; plus a queued
 * file removal (only the database functions may add those, so it comes through remove_application).
 */
export async function seedPlant(tenantId: string) {
  const who = randomUUID();
  const one = async (text: string) => ((await asApp(tenantId, text)).rows[0] as { id: string }).id;
  const opening = await one(`insert into job_applications.openings (tenant_id, title, grp, description, min_qualification, created_by, created_by_name)
    values ('${tenantId}', 'Lab Assistant', 'lab_quality', 'Daily water tests', 'B.Sc. Chemistry', '${who}', 'Sujata') returning id`);
  await asApp(tenantId, `insert into job_applications.page_settings (tenant_id, message) values ('${tenantId}', 'We are hiring')`);
  const application = (await addApplication(tenantId, { opening: { id: opening, title: "Lab Assistant" } })).id;
  const event = await one(`insert into job_applications.application_events (tenant_id, application_id, kind, text, user_id, user_name)
    values ('${tenantId}', '${application}', 'note', 'Called, will come Monday', '${who}', 'Meera') returning id`);
  const file = await one(`insert into job_applications.application_files (tenant_id, application_id, page_no, storage_key, content_type, size_bytes, sha256)
    values ('${tenantId}', '${application}', 1, 'tenant/${tenantId}/${randomUUID()}', 'application/pdf', 1000, '${"a".repeat(64)}') returning id`);
  await asApp(tenantId, `insert into job_applications.support_views (tenant_id, super_admin_id, super_admin_name, path) values ('${tenantId}', '${who}', 'PlantOps support', '/applications')`);
  await asApp(tenantId, `insert into job_applications.audit_log (tenant_id, actor, action) values ('${tenantId}', 'user:${who}', 'opening.added')`);
  const outbox = await one(`insert into job_applications.notification_outbox (tenant_id, input) values ('${tenantId}', '{}') returning id`);
  // a removed application leaves a queued file behind
  const gone = (await addApplication(tenantId)).id;
  await asApp(tenantId, `insert into job_applications.application_files (tenant_id, application_id, page_no, storage_key, content_type, size_bytes, sha256)
    values ('${tenantId}', '${gone}', 1, 'tenant/${tenantId}/${randomUUID()}', 'image/jpeg', 1000, '${"b".repeat(64)}')`);
  await asApp(tenantId, `select job_applications.remove_application('${tenantId}', '${gone}', 'Applicant asked')`);
  return { who, opening, application, event, file, outbox };
}

/** The tables in the job_applications schema (the guard tests compare against this list). */
export const TABLES = [
  "application_events",
  "application_files",
  "applications",
  "audit_log",
  "file_removals",
  "notification_outbox",
  "openings",
  "page_settings",
  "support_views",
];

// ---------- small sample files (only their first bytes matter to the checks) ----------
const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(32, 1)]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from("JFIF stub photo")]);
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 stub")]);
export const HEIC = ftyp("heic");
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
export const SVG = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
export const HTML = Buffer.from("<!doctype html><html><body>hi</body></html>");
export const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0x90)]);
/** A file of exactly `bytes` bytes that starts like `sample`. */
export const sized = (sample: Buffer, bytes: number) => Buffer.concat([sample, Buffer.alloc(Math.max(0, bytes - sample.length))]);

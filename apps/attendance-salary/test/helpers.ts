import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import type { RoleId } from "@plantops/types";
import { attendDb } from "@/server/db";
import { kit } from "@/server/kit";
import { supportUser, toAtUser, type AtUser } from "@/server/session";

/** An Attendance user of one plant, as the session would describe them. */
export function atUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): AtUser {
  const now = Date.now();
  return toAtUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["attendance_salary"], login_at: now, checked_at: now });
}

/** A fresh plant: owner, owner who is also Plant staff, a worker, a store keeper (no Attendance rights), support. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: atUser(tenantId, ["tenant_admin"], "Sujata"),
    ownerWorker: atUser(tenantId, ["tenant_admin", "plant_staff"], "Ravi"),
    worker: atUser(tenantId, ["plant_staff"], "Ramu"),
    keeper: atUser(tenantId, ["store_keeper"], "Bindu"),
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

/** Raw SQL as the app's own login (attendance_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return attendDb().transaction(async (tx) => {
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
 * One plant's sample rows in every table, inserted as the app (so the grants are exercised too): settings with a
 * location and QR, a scanned IN by the worker, an owner-added OUT, a cancel of the scan, a support view, an audit row
 * and an outbox row. Returns their ids.
 */
export async function seedPlant(tenantId: string) {
  const worker = randomUUID();
  const owner = randomUUID();
  const one = async (text: string) => ((await asApp(tenantId, text)).rows[0] as { id: string }).id;
  await asApp(tenantId, `insert into attendance_salary.plant_settings (tenant_id, lat, lng, radius_m, qr_key_hash, qr_made_at, updated_by, updated_by_name)
    values ('${tenantId}', 21.3470, 83.6270, 200, '${"a".repeat(64)}', now(), '${owner}', 'Sujata')`);
  const scan = await one(`insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name)
    values ('${tenantId}', '${worker}', 'Ramu', 'in', now() - interval '9 hours', 'scan', 30, 12, '${worker}', 'Ramu') returning id`);
  const fix = await one(`insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, reason, created_by, created_by_name)
    values ('${tenantId}', '${worker}', 'Ramu', 'out', now() - interval '1 hour', 'owner', 'forgot to scan', '${owner}', 'Sujata') returning id`);
  const cancel = await one(`insert into attendance_salary.punch_cancels (tenant_id, punch_id, reason, created_by, created_by_name)
    values ('${tenantId}', '${scan}', 'scanned twice at the gate', '${owner}', 'Sujata') returning id`);
  await asApp(tenantId, `insert into attendance_salary.support_views (tenant_id, super_admin_id, super_admin_name, path) values ('${tenantId}', '${owner}', 'PlantOps support', '/')`);
  await asApp(tenantId, `insert into attendance_salary.audit_log (tenant_id, actor, action) values ('${tenantId}', 'user:${owner}', 'settings.location')`);
  const outbox = await one(`insert into attendance_salary.notification_outbox (tenant_id, input) values ('${tenantId}', '{}') returning id`);
  return { worker, owner, scan, fix, cancel, outbox };
}

/** The tables in the attendance_salary schema (the guard tests compare against this list). */
export const TABLES = ["audit_log", "notification_outbox", "plant_settings", "punch_cancels", "punches", "support_views"];

/**
 * Makes `user` the logged-in person for pages and API routes, the way the proxy and the kit's session cookie would
 * present them. Restore with the returned function (or vi.restoreAllMocks()).
 */
export function signInAs(user: AtUser) {
  const spy = vi.spyOn(kit, "currentSession");
  spy.mockResolvedValue(
    user.isSupport
      ? ({ kind: "support", support: { tenant_id: user.tenantId, super_admin_id: user.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: user.tenantId, user_id: user.userId, display_name: user.name, roles: user.roles, enabled_modules: ["attendance_salary"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );
  return () => spy.mockRestore();
}

/** A JSON request to a route handler. */
export const jsonReq = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost:3006${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Status, plain message and (for a refused mark) its code. */
export async function refusal(fn: () => unknown): Promise<{ status: number; message: string; code?: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    return { status: e.status ?? 0, message: e.message, code: e.code };
  }
  throw new Error("Expected this to be refused, but it succeeded");
}

/** All the text inside a server page's element tree (server components inside are not rendered). */
export function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? textOf(props.children) : "";
}

/** A point `metres` due north of `from` (along a meridian, so the haversine distance is exactly that). */
export const northOf = (from: { lat: number; lng: number }, metres: number) => ({ lat: from.lat + (metres / 6_371_000) * (180 / Math.PI), lng: from.lng });

/** The people list the platform would give for these users (AlertContact rows). */
export const contactsFor = (...users: AtUser[]) => users.map((u) => ({ user_id: u.userId, display_name: u.name, phone: null, email: null, roles: u.roles }));

/**
 * A mark for `u` at an India time ("2026-09-30 22:00"), written as the app login. `owner` = an owner-added mark with
 * that reason. Returns its id.
 */
export async function markAt(u: AtUser, kind: "in" | "out", when: string, opts: { owner?: string } = {}) {
  const t = `'${when}:00+05:30'`;
  const name = u.name.replace(/'/g, "''");
  const text = opts.owner
    ? `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, reason, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${name}', '${kind}', ${t}, 'owner', '${opts.owner}', gen_random_uuid(), 'Sujata') returning id`
    : `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${name}', '${kind}', ${t}, 'scan', 30, 10, '${u.userId}', '${name}') returning id`;
  return ((await asApp(u.tenantId, text)).rows[0] as { id: string }).id;
}

/** A moment given in India time: "2026-09-10 12:00". */
export const ist = (s: string) => new Date(`${s.replace(" ", "T")}:00+05:30`);

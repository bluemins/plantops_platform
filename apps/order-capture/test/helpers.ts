import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { vi } from "vitest";
import type { RoleId } from "@plantops/types";
import { orderDb } from "@/server/db";
import { kit } from "@/server/kit";
import { supportUser, toOcUser, type OcUser } from "@/server/session";

/** An Order Capture user of one plant, as the session would describe them. */
export function ocUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): OcUser {
  const now = Date.now();
  return toOcUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["order_capture"], login_at: now, checked_at: now });
}

/** A fresh plant: owner, Order desk, plant staff and a store keeper (no Order Capture rights), PlantOps support. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: ocUser(tenantId, ["tenant_admin"], "Sujata"),
    desk: ocUser(tenantId, ["order_desk"], "Atharv"),
    staff: ocUser(tenantId, ["plant_staff"], "Kedar"),
    keeper: ocUser(tenantId, ["store_keeper"], "Bindu"),
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

/** Raw SQL as the app's own login (order_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return orderDb().transaction(async (tx) => {
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
 * One plant's sample rows in every table, inserted as the app (so the grants are exercised too): a product rate, a
 * customer, an order O-0001 (500ml 1 box @ 90 + 1ltr 3 box @ 140 = 510), its lines and "created" event, a support
 * view, an audit row, an outbox row and a pending WhatsApp thank-you. Returns their ids.
 */
export async function seedPlant(tenantId: string, refNo = 1, phone = "9876543210") {
  const who = randomUUID();
  const [sku500, sku1l] = [randomUUID(), randomUUID()];
  const one = async (text: string) => ((await asApp(tenantId, text)).rows[0] as { id: string }).id;
  const rate = await one(`insert into order_capture.product_rates (tenant_id, sku_id, unit, default_rate, updated_by) values ('${tenantId}', '${sku500}', 'box', 90, '${who}') returning id`);
  const customer = await one(`insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name)
    values ('${tenantId}', 'Sri ram hotel', '+91 ${phone}', '${phone}', 'bijepur', '${who}', 'Atharv') returning id`);
  const order = await one(`insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, total, entered_by, entered_by_name)
    values ('${tenantId}', ${refNo}, 'key-${randomUUID()}', '${customer}', 'Sri ram hotel', '${phone}', 'bijepur', 510, '${who}', 'Atharv') returning id`);
  const line = await one(`insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
    values ('${tenantId}', '${order}', 1, 1, '${sku500}', '500ml', 'box', 1, 90, 90) returning id`);
  await asApp(tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
    values ('${tenantId}', '${order}', 1, 2, '${sku1l}', '1ltr', 'box', 3, 140, 420)`);
  const event = await one(`insert into order_capture.order_events (tenant_id, order_id, kind, version, created_by, created_by_name) values ('${tenantId}', '${order}', 'created', 1, '${who}', 'Atharv') returning id`);
  await asApp(tenantId, `insert into order_capture.support_views (tenant_id, super_admin_id, super_admin_name, path) values ('${tenantId}', '${who}', 'PlantOps support', '/')`);
  await asApp(tenantId, `insert into order_capture.audit_log (tenant_id, actor, action) values ('${tenantId}', 'user:${who}', 'rate.set')`);
  const outbox = await one(`insert into order_capture.notification_outbox (tenant_id, input) values ('${tenantId}', '{}') returning id`);
  const message = await one(`insert into order_capture.customer_messages (tenant_id, order_id, kind, to_phone, requested_by, requested_by_name)
    values ('${tenantId}', '${order}', 'delivery_thanks', '${phone}', '${who}', 'Atharv') returning id`);
  const consent = await one(`insert into order_capture.customer_consents (tenant_id, customer_id, scope, status, wording, source, created_by, created_by_name)
    values ('${tenantId}', '${customer}', 'reorder_reminder', 'granted', 'optin-v1', 'staff_phone', '${who}', 'Atharv') returning id`);
  await asApp(tenantId, `insert into order_capture.reminder_groups (tenant_id, customer_id, grp) values ('${tenantId}', '${customer}', 'remind')`);
  return { who, sku500, sku1l, rate, customer, order, line, event, outbox, message, consent };
}

/** The tables in the order_capture schema (the guard tests compare against this list). */
export const TABLES = ["audit_log", "customer_consents", "customer_messages", "customers", "notification_outbox", "order_events", "order_lines", "orders", "product_rates", "reminder_groups", "support_views"];

/**
 * Calls an API route as `user` (owner, Order desk, support...), the way the proxy and the kit's session cookie would
 * present them. Restore with the returned function (or vi.restoreAllMocks()).
 */
export function signInAs(user: OcUser) {
  const spy = vi.spyOn(kit, "currentSession");
  spy.mockResolvedValue(
    user.isSupport
      ? ({ kind: "support", support: { tenant_id: user.tenantId, super_admin_id: user.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: user.tenantId, user_id: user.userId, display_name: user.name, roles: user.roles, enabled_modules: ["order_capture"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );
  return () => spy.mockRestore();
}

/** A JSON request to a route handler. */
export const jsonReq = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost:3005${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Audit rows of one plant, oldest first. */
export async function auditRows(tenantId: string) {
  return (await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from order_capture.audit_log where tenant_id = $1 order by id", [tenantId])).rows;
}

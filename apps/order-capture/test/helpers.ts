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
  // phone calls (0007): a ring, its missed mark, an Attended, a "Not an order number"
  const ring = await one(`insert into order_capture.call_events (tenant_id, key_id, phone, event) values ('${tenantId}', '${who}', '9000000009', 'incoming') returning id`);
  await asApp(tenantId, `insert into order_capture.call_events (tenant_id, key_id, phone, event, ring_id) values ('${tenantId}', '${who}', '9000000009', 'missed', '${ring}')`);
  const attended = await one(`insert into order_capture.call_attended (tenant_id, phone, upto, outcome, customer_id, attended_by, attended_by_name)
    values ('${tenantId}', '9000000009', now(), 'known', '${customer}', '${who}', 'Raju') returning id`);
  const ignored = await one(`insert into order_capture.ignored_number_changes (tenant_id, phone, action, label, changed_by, changed_by_name)
    values ('${tenantId}', '9111111111', 'add', 'Brother', '${who}', 'Sujata') returning id`);
  // sales ledger (0008): an import, a Zoho contact, a Zoho bill + line, a PlantOps bill, a payment, its allocation, an adjustment
  const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${tenantId}', '${who}', 'Sujata') returning id`);
  const contact = await one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, mobile_typed, mobile, customer_id, import_id)
    values ('${tenantId}', 'zc-${randomUUID()}', 'Sri ram hotel', '+91 ${phone}', '${phone}', '${customer}', '${imp}') returning id`);
  const zohoBill = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, due_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
    values ('${tenantId}', 'zoho', 'INV-000001', 'zi-1', '2026-10-01', '2026-10-01', '${contact}', 'Sri ram hotel', 500, 500, '${imp}', '${who}', 'Sujata') returning id`);
  const billLine = await one(`insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_code, item_name, quantity, rate, line_total)
    values ('${tenantId}', '${zohoBill}', 1, 'PV_BM_500', '500ml Water Bottle', 5, 100, 500) returning id`);
  const bill = await one(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, order_id, sub_total, total, created_by, created_by_name)
    values ('${tenantId}', 'plantops', 'B-0001', 1, '2026-11-06', '${customer}', 'Sri ram hotel', '${order}', 510, 510, '${who}', 'Sujata') returning id`);
  const payment = await one(`insert into order_capture.payments (tenant_id, source, number, ref_no, payment_date, customer_id, customer_name, mode, amount, created_by, created_by_name)
    values ('${tenantId}', 'plantops', 'P-0001', 1, '2026-11-06', '${customer}', 'Sri ram hotel', 'cash', 300, '${who}', 'Sujata') returning id`);
  const allocation = await one(`insert into order_capture.payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name)
    values ('${tenantId}', '${payment}', '${zohoBill}', 300, '2026-11-06', '${who}', 'Sujata') returning id`);
  const adjustment = await one(`insert into order_capture.bill_adjustments (tenant_id, bill_id, kind, amount, reason, adjusted_on, import_id, created_by, created_by_name)
    values ('${tenantId}', '${zohoBill}', 'zoho_closed', 200, 'Closed in Zoho', '2026-11-05', '${imp}', '${who}', 'Sujata') returning id`);
  await asApp(tenantId, `insert into order_capture.bill_settings (tenant_id, updated_by, updated_by_name) values ('${tenantId}', '${who}', 'Sujata') on conflict do nothing`);
  // customer page Part 2 (0010): a comment, a contact person, a shop location
  const comment = await one(`insert into order_capture.customer_comments (tenant_id, customer_id, body, by_user, by_name) values ('${tenantId}', '${customer}', 'Pays on Saturdays', '${who}', 'Sujata') returning id`);
  const person = await one(`insert into order_capture.customer_persons (tenant_id, customer_id, name, phone, role, by_user, by_name) values ('${tenantId}', '${customer}', 'Ramesh', '7008011223', 'shop boy', '${who}', 'Sujata') returning id`);
  const location = await one(`insert into order_capture.customer_locations (tenant_id, customer_id, kind, lat, lng, accuracy_m, source, by_user, by_name)
    values ('${tenantId}', '${customer}', 'set', 21.0234, 83.7841, 18, 'phone', '${who}', 'Raju') returning id`);
  // Drop (0012): switched on, one extra phone, a login code and a session
  await asApp(tenantId, `insert into order_capture.app_access_changes (tenant_id, customer_id, enabled, changed_by, changed_by_name) values ('${tenantId}', '${customer}', true, '${who}', 'Sujata')`);
  await asApp(tenantId, `insert into order_capture.app_phone_changes (tenant_id, customer_id, phone, action, changed_by, changed_by_name) values ('${tenantId}', '${customer}', '7008099887', 'add', '${who}', 'Sujata')`);
  await asApp(tenantId, `insert into order_capture.app_login_codes (tenant_id, customer_id, phone, code_hmac, expires_at) values ('${tenantId}', '${customer}', '${phone}', repeat('a', 64), now() + interval '10 minutes')`);
  const session = await one(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ('${tenantId}', '${customer}', '${phone}', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() + interval '90 days') returning id`);
  const device = await one(`insert into order_capture.app_devices (tenant_id, session_id, fcm_token) values ('${tenantId}', '${session}', 'fcm-' || encode(sha256(gen_random_uuid()::text::bytea), 'hex')) returning id`);
  const push = await one(`insert into order_capture.app_push_outbox (tenant_id, device_id, kind, dedupe_key, title, body, tab) values ('${tenantId}', '${device}', 'order_received', 'order:${order}:received', 'Order received', '1L × 20 box', 'home') returning id`);
  // Drop points (0013): a settings row and a free box asked, on the order
  await asApp(tenantId, `insert into order_capture.points_settings (tenant_id, effective_from, start_date, rewards, changed_by, changed_by_name)
    values ('${tenantId}', '2026-11-01', '2026-11-01', '[{"sku_id": "${sku1l}", "label": "1ltr", "points": 800}]', '${who}', 'Sujata')`);
  const redemption = await one(`insert into order_capture.points_redemptions (tenant_id, customer_id, sku_id, label, points, year_end, asked_by_phone, request_key, order_id, added_by, added_by_name, added_at)
    values ('${tenantId}', '${customer}', '${sku1l}', '1ltr', 800, '2028-01-31', '${phone}', 'rk-${randomUUID()}', '${order}', '${who}', 'Atharv', now()) returning id`);
  // Drop polls (0014): a poll and the customer's answer
  const poll = await one(`insert into order_capture.polls (tenant_id, question, choices, brands, opens_at, closes_at, created_by, created_by_name)
    values ('${tenantId}', 'Which size sells most?', '{1L,500ml}', '{Bluemins}', now() - interval '1 day', now() + interval '6 days', '${who}', 'Sujata') returning id`);
  const answer = await one(`insert into order_capture.poll_answers (tenant_id, poll_id, customer_id, phone, choice, points, points_reason)
    values ('${tenantId}', '${poll}', '${customer}', '${phone}', 0, 10, 'counted') returning id`);
  return { device, push, poll, answer, redemption, who, sku500, sku1l, rate, customer, order, line, event, outbox, message, consent, ring, attended, ignored, imp, contact, zohoBill, billLine, bill, payment, allocation, adjustment, comment, person, location };
}

/** The tables in the order_capture schema (the guard tests compare against this list). */
export const TABLES = [
  "app_access_changes", "app_devices", "app_login_codes", "app_phone_changes", "app_push_outbox", "app_sessions",
  "audit_log", "bill_adjustments", "bill_lines", "bill_settings", "bills", "call_attended", "call_events", "customer_comments", "customer_consents", "customer_locations", "customer_messages", "customer_persons", "customers",
  "ignored_number_changes", "notification_outbox", "order_events", "order_lines", "orders", "payment_allocations", "payments", "points_redemptions", "points_settings", "poll_answers", "polls", "product_rates",
  "reminder_groups", "support_views", "zoho_contacts", "zoho_imports",
];

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

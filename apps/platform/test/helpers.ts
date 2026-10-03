import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ModuleId, RoleId } from "@plantops/types";
import { hashSecret } from "@/server/crypto";
import { createTenant } from "@/server/tenants";
import * as loginRoute from "@/app/api/auth/login/route";
import * as changeSecretRoute from "@/app/api/auth/change-secret/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as superLoginRoute from "@/app/api/super/login/route";

type Handler = (req: Request, ctx: never) => Promise<Response>;

/** Calls a route handler the way Next.js would, with an optional session cookie and path params. */
export async function call(
  handler: Handler,
  opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; params?: Record<string, string> } = {},
) {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { ...opts.headers };
  if (method !== "GET") headers["content-type"] ??= "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request("http://localhost/test", {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) } as never);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

/** "name=value" part of a Set-Cookie header, ready to send back as a Cookie header. */
export function cookieFrom(setCookie: string | null) {
  if (!setCookie) throw new Error("No Set-Cookie header");
  return setCookie.split(";")[0]!;
}

export function ownerClient() {
  return new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
}

/** Runs one statement as the owner login (test fixtures only - bypasses RLS). */
export async function asOwner<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const c = ownerClient();
  await c.connect();
  try {
    return await c.query<T>(text, values);
  } finally {
    await c.end();
  }
}

export const unique = (prefix: string) => `${prefix}${randomUUID().slice(0, 8)}`.toUpperCase();

export async function makeSuperAdmin() {
  const email = `${unique("sa").toLowerCase()}@test.local`;
  const password = "super-secret-password";
  const { rows } = await asOwner<{ id: string }>(
    "insert into platform.super_admins (email, name, password_hash) values ($1, 'Test SA', $2) returning id",
    [email, await hashSecret(password)],
  );
  const res = await call(superLoginRoute.POST as Handler, { body: { email, password } });
  return { id: rows[0]!.id, email, cookie: cookieFrom(res.setCookie) };
}

/** A plant with a plan and an owner who has already set their own password. */
export async function makePlant(opts: { modules?: ModuleId[]; maxUsers?: number } = {}) {
  const code = unique("P");
  const created = await createTenant(
    { id: randomUUID(), email: "fixture@test.local", name: "fixture" },
    {
      code,
      name: `Plant ${code}`,
      plan: {
        plan_name: "Growth",
        enabled_modules: opts.modules ?? ["lab_records", "floor_stock", "preventive_mgmt"],
        limits: { platform: opts.maxUsers ? { max_users: opts.maxUsers } : {}, modules: {} },
        renews_on: null,
      },
      admin: { username: "owner", display_name: "Owner" },
    },
  );
  const adminPassword = `owner-pw-${code.toLowerCase()}`; // different for every plant
  const adminCookie = await activate(code, "owner", created.admin_temporary_password, adminPassword);
  return { tenantId: created.id, code, adminUserId: created.admin_user_id, adminPassword, adminCookie };
}

export async function login(plantCode: string, username: string, secret: string) {
  return call(loginRoute.POST as Handler, { body: { plant_code: plantCode, username, secret } });
}

/** Logs in with a temporary secret and replaces it; returns a ready-to-use session cookie. */
export async function activate(plantCode: string, username: string, temporary: string, next: string) {
  const res = await login(plantCode, username, temporary);
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  const cookie = cookieFrom(res.setCookie);
  const changed = await call(changeSecretRoute.POST as Handler, { cookie, body: { current: temporary, next } });
  if (changed.status !== 200) throw new Error(`change-secret failed: ${JSON.stringify(changed.body)}`);
  return cookie;
}

/** Owner creates a staff user, who then logs in and sets their own PIN. */
export async function makeStaff(plant: { code: string; adminCookie: string }, username: string, roles: RoleId[], pin = "246810") {
  const res = await call(adminUsersRoute.POST as Handler, {
    cookie: plant.adminCookie,
    body: { username, display_name: username, roles },
  });
  if (res.status !== 201) throw new Error(`create user failed: ${JSON.stringify(res.body)}`);
  const cookie = await activate(plant.code, username, res.body.temporary_secret, pin);
  return { userId: res.body.id as string, cookie, pin };
}

export type { Handler };

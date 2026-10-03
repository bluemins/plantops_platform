import { randomUUID } from "node:crypto";
import pg from "pg";
import type { RoleId } from "@plantops/types";
import { labDb } from "@/server/db";
import { toLabUser, type LabUser } from "@/server/session";
import { sql } from "drizzle-orm";

/** A Lab Records user of one plant, as the session would describe them. */
export function labUser(tenantId: string, roles: RoleId[], name = roles.join("+")): LabUser {
  const now = Date.now();
  return toLabUser({ tenant_id: tenantId, user_id: randomUUID(), display_name: name, roles, enabled_modules: ["lab_records"], login_at: now, checked_at: now });
}

/** A fresh plant id with a technician, a lab lead and an owner. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    tech: labUser(tenantId, ["lab_technician"], "Atharv"),
    lead: labUser(tenantId, ["lab_lead"], "Priya"),
    owner: labUser(tenantId, ["tenant_admin"], "Sujata"),
  };
}

/** Runs one statement as the owner login (test fixtures only - bypasses RLS). */
export async function asOwner<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await c.connect();
  try {
    return await c.query<T>(text, values);
  } finally {
    await c.end();
  }
}

/** Runs raw SQL as the app's own login (lab_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return labDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return tx.execute(sql.raw(text));
  });
}

/** The database's refusal message (Drizzle wraps the Postgres error in `cause`). */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  throw new Error("Expected the database to refuse this, but it succeeded");
}

/** The HTTP-style error a server function throws (status + message), or fails the test. */
export async function refused(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as Error & { status?: number };
    return { status: e.status ?? 0, message: e.message };
  }
  throw new Error("Expected this to be refused, but it succeeded");
}

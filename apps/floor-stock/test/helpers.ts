import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import type { RoleId } from "@plantops/types";
import { stockDb } from "@/server/db";
import { supportUser, toStockUser, type StockUser } from "@/server/session";

/** A Floor Stock user of one plant, as the session would describe them. */
export function stockUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): StockUser {
  const now = Date.now();
  return toStockUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["floor_stock"], login_at: now, checked_at: now });
}

/** A fresh plant: owner, store keeper, a lab technician (no Floor Stock role) and PlantOps support. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: stockUser(tenantId, ["tenant_admin"], "Sujata"),
    keeper: stockUser(tenantId, ["store_keeper"], "Atharv"),
    labTech: stockUser(tenantId, ["lab_technician"], "Techno"),
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

/** Raw SQL as the app's own login (stock_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return stockDb().transaction(async (tx) => {
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

export async function refused(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as Error & { status?: number };
    return { status: e.status ?? 0, message: e.message };
  }
  throw new Error("Expected this to be refused, but it succeeded");
}

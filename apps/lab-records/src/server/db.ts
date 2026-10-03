import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type LabDb = Db<typeof schema>;
export type LabTx = Tx<typeof schema>;

// Reuse the pool across hot reloads in dev.
const g = globalThis as unknown as { __labDb?: LabDb };

/** lab_app login: every Lab Records request. Never the table owner, always subject to row-level security. */
export function labDb(): LabDb {
  return (g.__labDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: LabTx) => Promise<T>) {
  return withTenantTx(labDb(), tenantId, fn);
}

/** For the health check: can the lab_app login reach the database? */
export async function databaseReachable() {
  try {
    await labDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__labDb?.$client.end();
  g.__labDb = undefined;
}

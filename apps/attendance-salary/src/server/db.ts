import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type AtDb = Db<typeof schema>;
export type AtTx = Tx<typeof schema>;

const g = globalThis as unknown as { __attendDb?: AtDb };

/** attendance_app login: every Attendance request. Never the table owner, always under row-level security. */
export function attendDb(): AtDb {
  return (g.__attendDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: AtTx) => Promise<T>) {
  return withTenantTx(attendDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await attendDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__attendDb?.$client.end();
  g.__attendDb = undefined;
}

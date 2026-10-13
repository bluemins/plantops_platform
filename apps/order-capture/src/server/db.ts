import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type OcDb = Db<typeof schema>;
export type OcTx = Tx<typeof schema>;

const g = globalThis as unknown as { __orderDb?: OcDb };

/** order_app login: every Order Capture request. Never the table owner, always under row-level security. */
export function orderDb(): OcDb {
  return (g.__orderDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: OcTx) => Promise<T>) {
  return withTenantTx(orderDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await orderDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__orderDb?.$client.end();
  g.__orderDb = undefined;
}

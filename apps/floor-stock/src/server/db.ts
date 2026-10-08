import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type StockDb = Db<typeof schema>;
export type StockTx = Tx<typeof schema>;

const g = globalThis as unknown as { __stockDb?: StockDb };

/** stock_app login: every Floor Stock request. Never the table owner, always under row-level security. */
export function stockDb(): StockDb {
  return (g.__stockDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: StockTx) => Promise<T>) {
  return withTenantTx(stockDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await stockDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__stockDb?.$client.end();
  g.__stockDb = undefined;
}

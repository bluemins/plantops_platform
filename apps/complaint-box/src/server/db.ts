import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type CbDb = Db<typeof schema>;
export type CbTx = Tx<typeof schema>;

const g = globalThis as unknown as { __complaintDb?: CbDb };

/** complaint_app login: every Complaint Box request. Never the table owner, always under row-level security. */
export function complaintDb(): CbDb {
  return (g.__complaintDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: CbTx) => Promise<T>) {
  return withTenantTx(complaintDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await complaintDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__complaintDb?.$client.end();
  g.__complaintDb = undefined;
}

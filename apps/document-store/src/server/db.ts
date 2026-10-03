import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type DocDb = Db<typeof schema>;
export type DocTx = Tx<typeof schema>;

const g = globalThis as unknown as { __docDb?: DocDb };

/** doc_app login: every Document Store request. Never the table owner, always under row-level security. */
export function docDb(): DocDb {
  return (g.__docDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: DocTx) => Promise<T>) {
  return withTenantTx(docDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await docDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__docDb?.$client.end();
  g.__docDb = undefined;
}

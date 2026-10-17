import { sql } from "drizzle-orm";
import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "./env";
import * as schema from "./schema";

export { schema };
export type JaDb = Db<typeof schema>;
export type JaTx = Tx<typeof schema>;

const g = globalThis as unknown as { __jobsDb?: JaDb };

/** jobs_app login: every Job applications request. Never the table owner, always under row-level security. */
export function jobsDb(): JaDb {
  return (g.__jobsDb ??= createDb(env.databaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one plant. App code never touches plant tables outside this. */
export function withTenant<T>(tenantId: string, fn: (tx: JaTx) => Promise<T>) {
  return withTenantTx(jobsDb(), tenantId, fn);
}

export async function databaseReachable() {
  try {
    await jobsDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb() {
  await g.__jobsDb?.$client.end();
  g.__jobsDb = undefined;
}

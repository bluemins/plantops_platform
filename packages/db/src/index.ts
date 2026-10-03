import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export { migrate } from "./migrate";

export type Db<TSchema extends Record<string, unknown> = Record<string, never>> = NodePgDatabase<TSchema> & {
  $client: pg.Pool;
};
export type Tx<TSchema extends Record<string, unknown> = Record<string, never>> = Parameters<
  Parameters<Db<TSchema>["transaction"]>[0]
>[0];

export function createDb<TSchema extends Record<string, unknown>>(url: string, schema: TSchema): Db<TSchema> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema }) as Db<TSchema>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction where Postgres row-level security sees only `tenantId`'s rows.
 * The tenant setting is transaction-local (like SET LOCAL), so pooled connections never leak it.
 * App code must never touch tenant tables outside this helper.
 */
export async function withTenant<TSchema extends Record<string, unknown>, T>(
  db: Db<TSchema>,
  tenantId: string,
  fn: (tx: Tx<TSchema>) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

import { createDb, withTenant as withTenantTx, type Db, type Tx } from "@plantops/db";
import { env } from "../env";
import * as schema from "./schema";

export { schema };
export type PlatformDb = Db<typeof schema>;
export type PlatformTx = Tx<typeof schema>;

// Reuse pools across hot reloads in dev.
const g = globalThis as unknown as { __plantopsAppDb?: PlatformDb; __plantopsSuperDb?: PlatformDb };

/** platform_app login: every plant-user request. Always subject to row-level security. */
export function appDb(): PlatformDb {
  return (g.__plantopsAppDb ??= createDb(env.appDatabaseUrl, schema));
}

/** platform_super login (BYPASSRLS). Only for /api/super/* after requireSuperAdmin(). */
export function superDb(): PlatformDb {
  return (g.__plantopsSuperDb ??= createDb(env.superDatabaseUrl, schema));
}

/** Run `fn` with row-level security scoped to one tenant, on the platform_app login. */
export function withTenant<T>(tenantId: string, fn: (tx: PlatformTx) => Promise<T>) {
  return withTenantTx(appDb(), tenantId, fn);
}

export async function closeDbs() {
  await g.__plantopsAppDb?.$client.end();
  await g.__plantopsSuperDb?.$client.end();
  g.__plantopsAppDb = undefined;
  g.__plantopsSuperDb = undefined;
}

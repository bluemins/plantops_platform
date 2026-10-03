// Tenant isolation: plant A can never read or change plant B's data - enforced by Postgres itself.
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { appDb, schema, superDb, withTenant } from "@/server/db";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as resetSecretRoute from "@/app/api/admin/users/[id]/reset-secret/route";
import * as unlockRoute from "@/app/api/admin/users/[id]/unlock/route";
import { asOwner, call, login, makePlant, makeStaff, type Handler } from "./helpers";

/** The database's own error message (the query library wraps it as `cause`). */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  throw new Error("Expected the database to refuse this, but it succeeded");
}

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let bStaff: Awaited<ReturnType<typeof makeStaff>>;

beforeAll(async () => {
  A = await makePlant();
  B = await makePlant();
  await makeStaff(A, "ramesh", ["lab_technician"]);
  bStaff = await makeStaff(B, "ramesh", ["lab_technician"]); // same username, different plant: allowed
});

// Every table that holds plant data, with the column that says which plant a row belongs to.
const tenantTables = [
  { table: "tenants", column: "id" },
  { table: "tenant_plans", column: "tenant_id" },
  { table: "users", column: "tenant_id" },
  { table: "user_roles", column: "tenant_id" },
  { table: "sessions", column: "tenant_id" },
  { table: "audit_log", column: "tenant_id" },
];

describe("database row-level security", () => {
  it.each(tenantTables)("plant A sees none of plant B's rows in $table", async ({ table, column }) => {
    const rows = await withTenant(A.tenantId, (tx) =>
      tx.execute<{ owner: string }>(sql.raw(`select ${column}::text as owner from platform.${table}`)),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.owner === A.tenantId)).toBe(true);
  });

  it("sso_handoff_codes are not readable by the app at all (insert-only)", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.execute(sql`select * from platform.sso_handoff_codes`)))).toMatch(/permission denied/);
  });

  it("cannot insert a row for plant B while working as plant A", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) =>
        tx.insert(schema.users).values({
          tenantId: B.tenantId,
          username: "intruder",
          displayName: "x",
          secretHash: "x",
          secretKind: "pin",
          createdBy: "test",
        }),
      ))).toMatch(/row-level security/);
  });

  it("cannot update plant B's user while working as plant A (0 rows touched)", async () => {
    const res = await withTenant(A.tenantId, (tx) =>
      tx.execute(sql`update platform.users set display_name = 'hacked' where id = ${bStaff.userId}`),
    );
    expect(res.rowCount).toBe(0);
    const [row] = await superDb().select().from(schema.users).where(eq(schema.users.id, bStaff.userId));
    expect(row!.displayName).toBe("ramesh");
  });

  it("cannot move a row from plant A to plant B", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) =>
        tx.execute(sql`update platform.users set tenant_id = ${B.tenantId} where username = 'ramesh'`),
      ))).toMatch(/row-level security/);
  });

  it("fails closed: a query without a tenant set is an error, not 'all rows'", async () => {
    // Never-set on this connection -> "unrecognized configuration parameter app.tenant_id";
    // reset after an earlier transaction -> "" which is not a valid uuid. Both refuse the query.
    expect(await dbError(appDb().select().from(schema.users))).toMatch(/app\.tenant_id|invalid input syntax for type uuid/);
  });

  it("a role row can never link a user to a different plant", async () => {
    await expect(
      superDb().insert(schema.userRoles).values({
        tenantId: A.tenantId,
        userId: bStaff.userId,
        roleId: "tenant_admin",
        grantedBy: "test",
      }),
    ).rejects.toThrow(); // foreign key (tenant_id, user_id) -> users
  });

  it("every table with plant data has FORCE row-level security and a policy (catches forgotten new tables)", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; forced: boolean; policies: number }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'platform' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'platform' and c.relkind = 'r'
         and (c.relname = 'tenants' or exists (
               select 1 from information_schema.columns col
                where col.table_schema = 'platform' and col.table_name = c.relname and col.column_name = 'tenant_id'))`);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const r of rows) expect({ table: r.table_name, rls: r.rls, forced: r.forced, hasPolicy: r.policies > 0 }).toEqual({
      table: r.table_name,
      rls: true,
      forced: true,
      hasPolicy: true,
    });
  });

  it("the app login is not a superuser, does not bypass RLS and owns no tables", async () => {
    const { rows } = await asOwner(
      `select rolsuper, rolbypassrls,
              (select count(*)::int from pg_tables where tableowner = 'platform_app') as owned
         from pg_roles where rolname = 'platform_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });

  it("the app login cannot read super_admins at all", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.select().from(schema.superAdmins)))).toMatch(/permission denied/);
  });

  it("audit_log is append-only for both logins", async () => {
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.audit_log set action = 'x'`)))).toMatch(/permission denied/);
    expect(await dbError(withTenant(A.tenantId, (tx) => tx.execute(sql`delete from platform.audit_log`)))).toMatch(/permission denied/);
    expect(await dbError(superDb().execute(sql`delete from platform.audit_log`))).toMatch(/permission denied/);
  });
});

describe("API-level isolation", () => {
  it("plant A's owner lists only plant A's users", async () => {
    const res = await call(adminUsersRoute.GET as Handler, { cookie: A.adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.map((u: { username: string }) => u.username).sort()).toEqual(["owner", "ramesh"]);
    expect(res.body.some((u: { id: string }) => u.id === bStaff.userId)).toBe(false);
  });

  it.each([
    ["GET user", adminUserRoute.GET, undefined],
    ["PATCH user", adminUserRoute.PATCH, { display_name: "hacked" }],
    ["reset PIN", resetSecretRoute.POST, {}],
    ["unlock", unlockRoute.POST, {}],
  ] as const)("plant A's owner gets 404 for plant B's user: %s", async (_name, handler, body) => {
    const res = await call(handler as Handler, {
      cookie: A.adminCookie,
      method: body === undefined ? "GET" : handler === adminUserRoute.PATCH ? "PATCH" : "POST",
      body,
      params: { id: bStaff.userId },
    });
    expect(res.status).toBe(404);
  });

  it("plant B's staff still logs in with their own PIN (nothing was changed by A)", async () => {
    expect((await login(B.code, "ramesh", bStaff.pin)).status).toBe(200);
  });

  it("a plant A user cannot log in using plant B's plant code", async () => {
    expect((await login(B.code, "owner", A.adminPassword)).status).toBe(401);
  });
});

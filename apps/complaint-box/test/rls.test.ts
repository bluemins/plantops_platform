// Tenant isolation at the database: every Complaint Box table holds tenant_id with FORCE row-level security, and
// the app login sees nothing without a plant set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { complaintDb } from "@/server/db";
import { asApp, asOwner, dbError, plant, seedPlant, TABLES } from "./helpers";

describe("row-level security", () => {
  it("every table in complaint_box has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; force: boolean; has_tenant: boolean }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'complaint_box' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'complaint_box' and c.relkind = 'r' and c.relname <> 'schema_migrations'
       order by c.relname`);
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
    for (const r of rows) expect(r, r.table_name).toMatchObject({ rls: true, force: true, has_tenant: true });
  });

  it("the app login is not the table owner and can't skip row-level security", async () => {
    const { rows } = await asOwner<{ rolbypassrls: boolean; owns: boolean }>(`
      select r.rolbypassrls,
             exists (select 1 from pg_tables t where t.schemaname = 'complaint_box' and t.tableowner = 'complaint_app') as owns
        from pg_roles r where r.rolname = 'complaint_app'`);
    expect(rows[0]).toEqual({ rolbypassrls: false, owns: false });
  });

  it("without a plant set, the app login gets an error instead of rows", async () => {
    for (const t of TABLES) {
      expect(await dbError(complaintDb().execute(sql.raw(`select * from complaint_box.${t}`))), t).toMatch(/app\.tenant_id|unrecognized configuration/);
    }
  });

  it("plant B sees none of plant A's rows, can't write into plant A, and changes 0 of A's rows", async () => {
    const a = plant();
    const ids = await seedPlant(a.tenantId);
    const b = plant();
    for (const t of TABLES) {
      expect((await asApp(a.tenantId, `select * from complaint_box.${t}`)).rows.length, t).toBeGreaterThan(0);
      expect((await asApp(b.tenantId, `select * from complaint_box.${t} where tenant_id = '${a.tenantId}'`)).rows, t).toEqual([]);
    }
    expect(await dbError(asApp(b.tenantId, `insert into complaint_box.items (tenant_id, name, created_by, created_by_name) values ('${a.tenantId}', 'X', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into complaint_box.audit_log (tenant_id, actor, action) values ('${a.tenantId}', 'x', 'x')`))).toMatch(/row-level security/);
    expect((await asApp(b.tenantId, `update complaint_box.items set name = 'Hacked' where id = '${ids.item}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update complaint_box.complaints set status = 'resolved' where id = '${ids.complaint}'`)).rowCount).toBe(0);
    // plant B can't hang its own note on plant A's complaint either (the key includes the plant)
    expect(await dbError(asApp(b.tenantId, `insert into complaint_box.complaint_events (tenant_id, complaint_id, kind, text, created_by, created_by_name) values ('${b.tenantId}', '${ids.complaint}', 'note', 'x', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
  });

  it("the plant-list functions give plant ids only", async () => {
    const a = plant();
    await seedPlant(a.tenantId);
    const open = await complaintDb().execute<{ id: string }>(sql`select t as id from complaint_box.open_tenants() t`);
    expect(open.rows.map((r) => r.id)).toContain(a.tenantId);
    const outbox = await complaintDb().execute<{ id: string }>(sql`select t as id from complaint_box.outbox_tenants() t`);
    expect(outbox.rows.map((r) => r.id)).toContain(a.tenantId);
  });
});

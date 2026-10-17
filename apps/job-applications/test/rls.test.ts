// Tenant isolation at the database: every Job applications table holds tenant_id with FORCE row-level security, and
// the app login sees nothing without a plant set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { jobsDb } from "@/server/db";
import { asApp, asOwner, dbError, plant, seedPlant, TABLES } from "./helpers";

describe("row-level security", () => {
  it("every table in job_applications has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; force: boolean; has_tenant: boolean }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'job_applications' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'job_applications' and c.relkind = 'r' and c.relname <> 'schema_migrations'
       order by c.relname`);
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
    for (const r of rows) expect(r, r.table_name).toMatchObject({ rls: true, force: true, has_tenant: true });
  });

  it("the app login is not the table owner and can't skip row-level security", async () => {
    const { rows } = await asOwner<{ rolbypassrls: boolean; owns: boolean }>(`
      select r.rolbypassrls,
             exists (select 1 from pg_tables t where t.schemaname = 'job_applications' and t.tableowner = 'jobs_app') as owns
        from pg_roles r where r.rolname = 'jobs_app'`);
    expect(rows[0]).toEqual({ rolbypassrls: false, owns: false });
  });

  it("without a plant set, the app login gets an error instead of rows", async () => {
    for (const t of TABLES) {
      expect(await dbError(jobsDb().execute(sql.raw(`select * from job_applications.${t}`))), t).toMatch(/app\.tenant_id|unrecognized configuration/);
    }
  });

  it("plant B sees none of plant A's rows, can't write into plant A, and changes 0 of A's rows", async () => {
    const a = plant();
    const ids = await seedPlant(a.tenantId);
    const b = plant();
    for (const t of TABLES) {
      expect((await asApp(a.tenantId, `select * from job_applications.${t}`)).rows.length, t).toBeGreaterThan(0);
      expect((await asApp(b.tenantId, `select * from job_applications.${t} where tenant_id = '${a.tenantId}'`)).rows, t).toEqual([]);
    }
    expect(await dbError(asApp(b.tenantId, `insert into job_applications.openings (tenant_id, title, grp, description, min_qualification, created_by, created_by_name) values ('${a.tenantId}', 'Fake job', 'other', 'x', 'x', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into job_applications.audit_log (tenant_id, actor, action) values ('${a.tenantId}', 'x', 'x')`))).toMatch(/row-level security/);
    expect((await asApp(b.tenantId, `update job_applications.openings set title = 'Hacked' where id = '${ids.opening}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update job_applications.applications set status = 'hired' where id = '${ids.application}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update job_applications.page_settings set message = 'Hacked' where tenant_id = '${a.tenantId}'`)).rowCount).toBe(0);
    // plant B can't hang its own note, file or application on plant A's rows (the keys include the plant)
    expect(await dbError(asApp(b.tenantId, `insert into job_applications.application_events (tenant_id, application_id, kind, text, user_id, user_name) values ('${b.tenantId}', '${ids.application}', 'note', 'x', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into job_applications.application_files (tenant_id, application_id, page_no, storage_key, content_type, size_bytes, sha256) values ('${b.tenantId}', '${ids.application}', 2, 'k-${ids.application}', 'image/jpeg', 10, '${"c".repeat(64)}')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into job_applications.applications (tenant_id, ref_no, opening_id, opening_title, name, phone, place, consent_version, consent_at, request_key) values ('${b.tenantId}', 1, '${ids.opening}', 'Lab Assistant', 'Xy', '9876543210', 'Xy', 'v1', now(), 'key-cross-plant')`))).toMatch(/foreign key/);
  });

  it("the plant-list functions give plant ids only", async () => {
    const a = plant();
    await seedPlant(a.tenantId);
    for (const fn of ["outbox_tenants", "purge_tenants"]) {
      const { rows } = await asApp(a.tenantId, `select * from job_applications.${fn}()`);
      expect(rows.length, fn).toBeGreaterThan(0);
      for (const r of rows) expect(Object.values(r), fn).toHaveLength(1);
      expect(rows.map((r) => Object.values(r)[0]), fn).toContain(a.tenantId);
    }
  });
});

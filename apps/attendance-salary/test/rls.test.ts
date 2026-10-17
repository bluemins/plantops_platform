// Tenant isolation at the database: every Attendance table holds tenant_id with FORCE row-level security, and the
// app login sees nothing without a plant set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendDb } from "@/server/db";
import { asApp, asOwner, dbError, plant, seedPlant, TABLES } from "./helpers";

describe("row-level security", () => {
  it("every table in attendance_salary has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; force: boolean; has_tenant: boolean }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'attendance_salary' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'attendance_salary' and c.relkind = 'r' and c.relname <> 'schema_migrations'
       order by c.relname`);
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
    for (const r of rows) expect(r, r.table_name).toMatchObject({ rls: true, force: true, has_tenant: true });
  });

  it("the app login is not the table owner and can't skip row-level security", async () => {
    const { rows } = await asOwner<{ rolbypassrls: boolean; owns: boolean }>(`
      select r.rolbypassrls,
             exists (select 1 from pg_tables t where t.schemaname = 'attendance_salary' and t.tableowner = 'attendance_app') as owns
        from pg_roles r where r.rolname = 'attendance_app'`);
    expect(rows[0]).toEqual({ rolbypassrls: false, owns: false });
  });

  it("without a plant set, the app login gets an error instead of rows", async () => {
    for (const t of TABLES) {
      expect(await dbError(attendDb().execute(sql.raw(`select * from attendance_salary.${t}`))), t).toMatch(/app\.tenant_id|unrecognized configuration/);
    }
  });

  it("plant B sees none of plant A's rows, can't write into plant A, and changes 0 of A's rows", async () => {
    const a = plant();
    const ids = await seedPlant(a.tenantId);
    const b = plant();
    for (const t of TABLES) {
      expect((await asApp(a.tenantId, `select * from attendance_salary.${t}`)).rows.length, t).toBeGreaterThan(0);
      expect((await asApp(b.tenantId, `select * from attendance_salary.${t} where tenant_id = '${a.tenantId}'`)).rows, t).toEqual([]);
    }
    expect(
      await dbError(asApp(b.tenantId, `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, reason, created_by, created_by_name) values ('${a.tenantId}', gen_random_uuid(), 'X', 'in', now(), 'owner', 'planted', gen_random_uuid(), 'x')`)),
    ).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.audit_log (tenant_id, actor, action) values ('${a.tenantId}', 'x', 'x')`))).toMatch(/row-level security/);
    // claims (migration 0004): plant B can't plant a claim, a decision or a photo in plant A
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_claims (tenant_id, user_id, user_name, kind, on_date, amount_paise, note, created_by, created_by_name) values ('${a.tenantId}', gen_random_uuid(), 'X', 'expense', '2026-10-16', 100, 'planted', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_claim_decisions (tenant_id, claim_id, decision, created_by, created_by_name) values ('${a.tenantId}', '${ids.claim}', 'approved', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_claim_files (tenant_id, claim_id, storage_key, content_type, size_bytes, sha256, created_by, created_by_name) values ('${a.tenantId}', '${ids.claim}', 'tenant/x/y', 'image/jpeg', 10, '${"c".repeat(64)}', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect((await asApp(b.tenantId, `update attendance_salary.plant_settings set radius_m = 2000 where tenant_id = '${a.tenantId}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update attendance_salary.notification_outbox set attempts = 9 where id = '${ids.outbox}'`)).rowCount).toBe(0);
    // plant B can't correct plant A's advance or undo plant A's payment (the keys include the plant)
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, corrects_id, reason, created_by, created_by_name) values ('${b.tenantId}', '${ids.worker}', 'Ramu', '2026-10-03', -100, '${ids.advance}', 'not yours', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_payment_undos (tenant_id, payment_id, reason, created_by, created_by_name) values ('${b.tenantId}', '${ids.payment}', 'not yours', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, created_by, created_by_name) values ('${a.tenantId}', gen_random_uuid(), 'X', '2026-10-01', 100, 480, false, gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    // plant B can't cancel plant A's mark (the key includes the plant)
    expect(await dbError(asApp(b.tenantId, `insert into attendance_salary.punch_cancels (tenant_id, punch_id, reason, created_by, created_by_name) values ('${b.tenantId}', '${ids.fix}', 'not yours', gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
  });

  it("the outbox, attendance and salary plant lists give plant ids only", async () => {
    const a = plant();
    await seedPlant(a.tenantId);
    for (const fn of ["outbox_tenants", "attendance_tenants", "salary_tenants"]) {
      const res = await attendDb().execute<Record<string, unknown>>(sql.raw(`select * from attendance_salary.${fn}()`));
      expect(res.rows.map((r) => Object.values(r)[0]), fn).toContain(a.tenantId);
      expect(Object.keys(res.rows[0]!), fn).toHaveLength(1);
    }
  });

  it("a plant whose last mark is older than 3 days is not in the attendance list", async () => {
    const old = plant();
    const w = crypto.randomUUID();
    await asApp(old.tenantId, `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name) values ('${old.tenantId}', '${w}', 'Old', 'in', now() - interval '4 days', 'scan', 10, 10, '${w}', 'Old')`);
    const res = await attendDb().execute<{ t: string }>(sql`select t from attendance_salary.attendance_tenants() t`);
    expect(res.rows.map((r) => r.t)).not.toContain(old.tenantId);
  });
});

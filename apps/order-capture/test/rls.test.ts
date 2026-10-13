// Tenant isolation at the database: every Order Capture table holds tenant_id with FORCE row-level security, and
// the app login sees nothing without a plant set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderDb } from "@/server/db";
import { asApp, asOwner, dbError, plant, seedPlant, TABLES } from "./helpers";

describe("row-level security", () => {
  it("every table in order_capture has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; force: boolean; has_tenant: boolean }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'order_capture' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'order_capture' and c.relkind = 'r' and c.relname <> 'schema_migrations'
       order by c.relname`);
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
    for (const r of rows) expect(r, r.table_name).toMatchObject({ rls: true, force: true, has_tenant: true });
  });

  it("the app login is not the table owner and can't skip row-level security", async () => {
    const { rows } = await asOwner<{ rolbypassrls: boolean; owns: boolean }>(`
      select r.rolbypassrls,
             exists (select 1 from pg_tables t where t.schemaname = 'order_capture' and t.tableowner = 'order_app') as owns
        from pg_roles r where r.rolname = 'order_app'`);
    expect(rows[0]).toEqual({ rolbypassrls: false, owns: false });
  });

  it("without a plant set, the app login gets an error instead of rows", async () => {
    for (const t of TABLES) {
      expect(await dbError(orderDb().execute(sql.raw(`select * from order_capture.${t}`))), t).toMatch(/app\.tenant_id|unrecognized configuration/);
    }
  });

  it("plant B sees none of plant A's rows, can't write into plant A, and changes 0 of A's rows", async () => {
    const a = plant();
    const ids = await seedPlant(a.tenantId);
    const b = plant();
    for (const t of TABLES) {
      expect((await asApp(a.tenantId, `select * from order_capture.${t}`)).rows.length, t).toBeGreaterThan(0);
      expect((await asApp(b.tenantId, `select * from order_capture.${t} where tenant_id = '${a.tenantId}'`)).rows, t).toEqual([]);
    }
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${a.tenantId}', 'X Y', '9000000000', '9000000000', 'Somewhere', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.audit_log (tenant_id, actor, action) values ('${a.tenantId}', 'x', 'x')`))).toMatch(/row-level security/);
    expect((await asApp(b.tenantId, `update order_capture.customers set name = 'Hacked' where id = '${ids.customer}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update order_capture.orders set status = 'cancelled' where id = '${ids.order}'`)).rowCount).toBe(0);
    expect((await asApp(b.tenantId, `update order_capture.product_rates set default_rate = 1 where id = '${ids.rate}'`)).rowCount).toBe(0);
    // plant B can't hang its own line or event on plant A's order, or an order on A's customer (keys include the plant)
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total) values ('${b.tenantId}', '${ids.order}', 2, 1, gen_random_uuid(), 'x', 'box', 1, 1, 1)`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.order_events (tenant_id, order_id, kind, version, created_by, created_by_name) values ('${b.tenantId}', '${ids.order}', 'changed', 2, gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, total, entered_by, entered_by_name) values ('${b.tenantId}', 1, 'key-cross-plant', '${ids.customer}', 'Sri ram hotel', '9876543210', 'bijepur', 0, gen_random_uuid(), 'x')`))).toMatch(/foreign key/);
  });

  it("the outbox plant list gives plant ids only", async () => {
    const a = plant();
    await seedPlant(a.tenantId);
    const outbox = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.outbox_tenants() t`);
    expect(outbox.rows.map((r) => r.id)).toContain(a.tenantId);
  });
});

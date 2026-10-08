// Tenant isolation at the database: every Floor Stock table holds tenant_id with FORCE row-level security,
// and the app login sees nothing without a plant set.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createItem, createSection } from "@/server/setup";
import { stockDb } from "@/server/db";
import { asApp, asOwner, dbError, plant } from "./helpers";

describe("row-level security", () => {
  it("every table in floor_stock has tenant_id and FORCE row-level security", async () => {
    const { rows } = await asOwner<{ table_name: string; rls: boolean; force: boolean; has_tenant: boolean }>(`
      select c.relname as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from information_schema.columns k where k.table_schema = 'floor_stock' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'floor_stock' and c.relkind = 'r' and c.relname <> 'schema_migrations'`);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) expect(r, r.table_name).toMatchObject({ rls: true, force: true, has_tenant: true });
  });

  it("without a plant set, the app login gets an error instead of rows", async () => {
    expect(await dbError(stockDb().execute(sql`select * from floor_stock.items`))).toMatch(/app\.tenant_id|unrecognized configuration/);
  });

  it("plant B sees none of plant A's rows and cannot write into plant A", async () => {
    const a = plant();
    const s = await createSection(a.owner, { name: "Consumable", kind: "stock" });
    await createItem(a.owner, { section_id: s.id, name: "Roll", unit: "roll" });
    const b = plant();
    for (const t of ["sections", "items", "audit_log"]) {
      expect((await asApp(b.tenantId, `select * from floor_stock.${t} where tenant_id = '${a.tenantId}'`)).rows).toEqual([]);
    }
    expect(await dbError(asApp(b.tenantId, `insert into floor_stock.sections (tenant_id, name, kind, created_by, created_by_name) values ('${a.tenantId}', 'X', 'stock', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect((await asApp(b.tenantId, `update floor_stock.items set name = 'Hacked' where tenant_id = '${a.tenantId}'`)).rowCount).toBe(0);
  });
});

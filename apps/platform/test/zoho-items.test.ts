// Zoho Items → products (docs/ZOHO_IMPORT_PHASE_PLAN.md section 4): only sold items; matched by SKU code; Zoho wins on
// name / SKU / HSN / purchase rate / status; PlantOps keeps size / pack / units; unknown codes matched by hand once;
// products not in Zoho never touched. Owner only, plants never see each other's, modules never get the purchase rate.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as skusRoute from "@/app/api/admin/skus/route";
import * as skuRoute from "@/app/api/admin/skus/[id]/route";
import * as previewRoute from "@/app/api/admin/skus/zoho/preview/route";
import * as confirmRoute from "@/app/api/admin/skus/zoho/confirm/route";
import * as moduleSkusRoute from "@/app/api/m/tenants/[tid]/skus/route";
import { parseCsv } from "@/lib/csv-read";
import { guessSpec, planItems, readZohoItems, type ExistingSku, type ZohoItem } from "@/lib/zoho-items";
import { sha256 } from "@/server/crypto";
import { withTenant } from "@/server/db";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

// The shape of Zoho's Items export (a few of its 28 columns, in Zoho's order), with plant 001's kinds of rows.
const CSV = [
  "Item ID,Item Name,SKU,HSN/SAC,Rate,Status,Usage unit,Purchase Rate,Item Type",
  "1,1 Litre Deionised Water,PV_DM_1,285300,INR 120.00,Active,,INR 105.00,Sales and Purchases",
  "2,5 Litre Deionised Water,PV_DM_5,285300,INR 160.00,Active,,INR 140.00,Sales and Purchases",
  "3,Bluemins Water - 20 Litre,PV_BM_20L,002201,INR 45.00,Active,pcs,INR 45.00,Sales and Purchases",
  "4,2L PV Empty Bottle,PV_EM_2L,,INR 7.00,Active,,INR 6.00,Sales and Purchases",
  '5,"PET PREFORM 3 STAR 28MM-32 GM",,39233090,INR 0.00,Active,kg,INR 165.00,Purchases',
  "6,Old Item,PV_OLD,22011010,INR 10.00,Inactive,,INR 5.00,Sales",
].join("\n");
const ITEMS = readZohoItems(parseCsv(CSV));

const product = (p: Partial<ExistingSku> & { id: string; name: string }): ExistingSku => ({
  sku_code: null, volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active", hsn: null, cost_rate: null, ...p,
});

describe("reading Zoho's Items export", () => {
  it("reads names, codes, HSN (leading zeros kept), purchase rate, status and whether Zoho sells it", () => {
    expect(ITEMS).toHaveLength(6);
    expect(ITEMS[2]).toEqual({ line: 4, name: "Bluemins Water - 20 Litre", sku: "PV_BM_20L", hsn: "002201", cost_rate: 45, active: true, sold: true });
    expect(ITEMS[4]!.sold).toBe(false);
    expect(ITEMS[5]!.active).toBe(false);
  });
  it("refuses a file without Item Name and SKU", () => {
    expect(() => readZohoItems(parseCsv("Name,Phone\nA,1"))).toThrow(/Items export/);
  });
  it("guesses size and pack from the name", () => {
    expect(guessSpec("500ml Water Bottle")).toEqual({ volume_ml: 500, units_per_pack: 1, pack_type: "bottle" });
    expect(guessSpec("Bluemins Water - 20 Litre")).toEqual({ volume_ml: 20000, units_per_pack: 1, pack_type: "jar" });
    expect(guessSpec("Blumeins 20L Connection").pack_type).toBe("other");
  });
});

describe("the plan", () => {
  const existing = [
    product({ id: "a", name: "Mr.Charge 1L", sku_code: "PV_DM_1" }),
    product({ id: "b", name: "Mr.Charge 5L", sku_code: "PV_DM_5L", volume_ml: 5000, units_per_pack: 4 }),
    product({ id: "c", name: "Round Empty Bottle 2L", sku_code: "PV_EM_2_R", pack_type: "bottle", units_per_pack: 1 }),
    product({ id: "d", name: "Hemex 1L", sku_code: "HE_DM_1L" }),
  ];

  it("matches by code and lets Zoho win on name / HSN / purchase rate, never size or pack", () => {
    const plan = planItems(ITEMS, existing, { match: {}, specs: {} });
    expect(plan.updated.find((u) => u.id === "a")!.changes).toEqual([
      { field: "name", from: "Mr.Charge 1L", to: "1 Litre Deionised Water" },
      { field: "hsn", from: null, to: "285300" },
      { field: "cost_rate", from: null, to: 105 },
    ]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["Bought only (not sold)"]);
  });

  it("asks for the Zoho codes no product has, offering only products not matched by code", () => {
    const plan = planItems(ITEMS, existing, { match: {}, specs: {} });
    expect(plan.to_choose.map((c) => c.sku)).toEqual(["PV_DM_5", "PV_BM_20L", "PV_EM_2L", "PV_OLD"]);
    expect(plan.candidates.map((c) => c.id)).toEqual(["b", "c", "d"]);
  });

  it("a hand match changes the code (Zoho wins) and keeps the size; 'new' adds with the given size; Hemex is kept", () => {
    const plan = planItems(ITEMS, existing, {
      match: { PV_DM_5: "b", PV_EM_2L: "c", PV_BM_20L: "new", PV_OLD: "new" },
      specs: { PV_BM_20L: { volume_ml: 20000, units_per_pack: 1, pack_type: "jar" } },
    });
    expect(plan.to_choose).toEqual([]);
    const b = plan.updated.find((u) => u.id === "b")!;
    expect(b.changes).toContainEqual({ field: "sku_code", from: "PV_DM_5L", to: "PV_DM_5" });
    expect(b.changes.map((c) => c.field)).not.toContain("volume_ml");
    expect(plan.updated.find((u) => u.id === "c")!.changes).toContainEqual({ field: "name", from: "Round Empty Bottle 2L", to: "2L PV Empty Bottle" });
    expect(plan.added.map((a) => [a.sku, a.active, a.hsn])).toEqual([["PV_BM_20L", true, "002201"], ["PV_OLD", false, "22011010"]]);
    expect(plan.kept).toEqual([{ id: "d", name: "Hemex 1L", sku_code: "HE_DM_1L" }]);
  });

  it("one product can't be picked twice; a bad HSN is warned about and not copied", () => {
    const items: ZohoItem[] = [
      { line: 2, name: "X", sku: "X1", hsn: "12", cost_rate: null, active: true, sold: true },
      { line: 3, name: "Y", sku: "Y1", hsn: "", cost_rate: null, active: true, sold: true },
    ];
    const plan = planItems(items, [product({ id: "p", name: "P", hsn: "2201" })], { match: { X1: "p", Y1: "p" }, specs: {} });
    expect(plan.updated[0]!.changes.map((c) => c.field)).not.toContain("hsn");
    expect(plan.to_choose.map((c) => c.sku)).toEqual(["Y1"]);
    expect(plan.warnings.map((w) => w.sku).sort()).toEqual(["X1", "Y1"]);
  });

  it("skips a code twice in the file and codes PlantOps can't store", () => {
    const items: ZohoItem[] = [
      { line: 2, name: "A", sku: "A1", hsn: "", cost_rate: null, active: true, sold: true },
      { line: 3, name: "B", sku: "A1", hsn: "", cost_rate: null, active: true, sold: true },
      { line: 4, name: "C", sku: "C 1", hsn: "", cost_rate: null, active: true, sold: true },
    ];
    expect(planItems(items, [], { match: {}, specs: {} }).skipped.map((s) => s.line)).toEqual([3, 4]);
  });
});

const LAB_SECRET = "lab-module-test-secret";
const LAB = { authorization: "Basic " + btoa(`lab_records:${LAB_SECRET}`) };

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  A = await makePlant();
  B = await makePlant();
});

const add = (cookie: string, body: object) => call(skusRoute.POST as Handler, { cookie, body: { units_per_pack: 12, pack_type: "case", ...body } });
const preview = (cookie: string, body: object) => call(previewRoute.POST as Handler, { cookie, body: { file_name: "Item.csv", items: ITEMS, ...body } });
const confirm = (cookie: string, body: object) => call(confirmRoute.POST as Handler, { cookie, body: { file_name: "Item.csv", items: ITEMS, ...body } });

describe("import through the API", () => {
  it("owner previews, matches by hand, confirms; a second run changes nothing; plant B untouched; audited", async () => {
    const a1 = (await add(A.adminCookie, { name: "Mr.Charge 1L", sku_code: "PV_DM_1", volume_ml: 1000 })).body;
    const b5 = (await add(A.adminCookie, { name: "Mr.Charge 5L", sku_code: "PV_DM_5L", volume_ml: 5000, units_per_pack: 4 })).body;
    const r2 = (await add(A.adminCookie, { name: "Round Empty Bottle 2L", sku_code: "PV_EM_2_R", volume_ml: 2000, units_per_pack: 1, pack_type: "bottle" })).body;
    await add(B.adminCookie, { name: "Mr.Charge 1L", sku_code: "PV_DM_1", volume_ml: 1000 });

    const first = await preview(A.adminCookie, {});
    expect(first.status).toBe(200);
    expect(first.body.to_choose).toHaveLength(4);
    // confirm while codes are unmatched: refused
    expect((await confirm(A.adminCookie, { fingerprint: first.body.fingerprint })).status).toBe(400);

    const choices = { match: { PV_DM_5: b5.id, PV_EM_2L: r2.id, PV_BM_20L: "new", PV_OLD: "new" }, specs: { PV_BM_20L: { volume_ml: 20000, units_per_pack: 1, pack_type: "jar" } } };
    const p = await preview(A.adminCookie, choices);
    expect(p.body.to_choose).toEqual([]);
    // a stale fingerprint is refused
    expect((await confirm(A.adminCookie, { ...choices, fingerprint: first.body.fingerprint })).status).toBe(409);
    const done = await confirm(A.adminCookie, { ...choices, fingerprint: p.body.fingerprint });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ updated: 3, added: 2 });

    const list = (await call(skusRoute.GET as Handler, { cookie: A.adminCookie })).body as { id: string; name: string; sku_code: string; volume_ml: number; units_per_pack: number; hsn: string | null; cost_rate: number | null; status: string }[];
    const byId = (id: string) => list.find((s) => s.id === id)!;
    expect(byId(a1.id)).toMatchObject({ name: "1 Litre Deionised Water", sku_code: "PV_DM_1", hsn: "285300", cost_rate: 105, volume_ml: 1000, units_per_pack: 12 });
    expect(byId(b5.id)).toMatchObject({ name: "5 Litre Deionised Water", sku_code: "PV_DM_5", volume_ml: 5000, units_per_pack: 4 });
    expect(byId(r2.id)).toMatchObject({ name: "2L PV Empty Bottle", sku_code: "PV_EM_2L", volume_ml: 2000 });
    expect(list.find((s) => s.sku_code === "PV_BM_20L")).toMatchObject({ volume_ml: 20000, pack_type: "jar", hsn: "002201" });
    expect(list.find((s) => s.sku_code === "PV_OLD")).toMatchObject({ status: "inactive" });

    // run again with the same file: everything is matched by code now and nothing changes
    const again = await preview(A.adminCookie, {});
    expect(again.body).toMatchObject({ updated: [], added: [], to_choose: [] });
    expect(again.body.unchanged).toHaveLength(5);

    const bList = (await call(skusRoute.GET as Handler, { cookie: B.adminCookie })).body;
    expect(bList).toEqual([expect.objectContaining({ name: "Mr.Charge 1L", hsn: null })]);

    const audit = await asOwner("select details from platform.audit_log where tenant_id = $1 and action = 'sku.zoho_import'", [A.tenantId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.details).toMatchObject({ file: "Item.csv", updated: 3, added: 2, skipped: 1 });
  });

  it("staff can't preview or import", async () => {
    const staff = await makeStaff(A, "zohostaff", ["store_keeper"]);
    expect((await preview(staff.cookie, {})).status).toBe(403);
    expect((await confirm(staff.cookie, { fingerprint: "0".repeat(64) })).status).toBe(403);
  });

  it("modules get HSN but never the purchase rate", async () => {
    const res = await call(moduleSkusRoute.GET as Handler, { headers: LAB, params: { tid: A.tenantId } });
    expect(res.status).toBe(200);
    const one = (res.body as Record<string, unknown>[]).find((s) => s.sku_code === "PV_DM_1")!;
    expect(one.hsn).toBe("285300");
    expect(one).not.toHaveProperty("cost_rate");
  });

  it("HSN and purchase rate on the product form; the database refuses a bad HSN or a negative rate", async () => {
    const s = (await add(A.adminCookie, { name: "Form test", volume_ml: 500, hsn: "22011010", cost_rate: 70.5 })).body;
    expect(s).toMatchObject({ hsn: "22011010", cost_rate: 70.5 });
    expect((await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", params: { id: s.id }, body: { hsn: "12" } })).status).toBe(400);
    const cleared = await call(skuRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", params: { id: s.id }, body: { hsn: "", cost_rate: null } });
    expect(cleared.body).toMatchObject({ hsn: null, cost_rate: null });
    await expect(withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenant_skus set hsn = 'abc' where id = ${s.id}`))).rejects.toThrow();
    await expect(withTenant(A.tenantId, (tx) => tx.execute(sql`update platform.tenant_skus set cost_rate = -1 where id = ${s.id}`))).rejects.toThrow();
  });
});

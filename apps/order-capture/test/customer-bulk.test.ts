// Change many customers at once (owner, 2026-11-20): owner only, brands add / replace, place, payment terms, Drop,
// skipped customers, another plant's ids, the 500 limit, and brand tags taken from bills (Zoho too).
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recentChanges } from "@/server/audit";
import { bulkChange, BulkInput, bulkSetup } from "@/server/customer-bulk";
import { brandsCard, customerBrandIndex, NO_BRAND } from "@/server/customer-brands";
import { createCustomer, updateCustomer } from "@/server/customers";
import { dropCard, setDrop } from "@/server/drop/manage";
import { createOrder, OrderInput } from "@/server/orders";
import { saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const [b1l, b500] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0]];
const plants: string[] = [];
const setApps = () => (process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`bulk-${i}`, { tenant_id: t, brand: "Bluemins" }]))));

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
});
afterAll(async () => {
  await platform.close();
  delete process.env.DROP_APPS;
  delete process.env.DROP_CODE_SECRET;
});
afterEach(() => setApps());

let n = 0;
async function bulkPlant() {
  const p = plant();
  plants.push(p.tenantId);
  setApps();
  await saveRates(p.owner, {
    rates: [
      { sku_id: b1l.id, unit: "box", default_rate: "90", brand: "Bluemins" },
      { sku_id: b500.id, unit: "box", default_rate: "110", brand: "Mr.Charge" },
    ],
  });
  const add = async (name: string, phone: string) => (await createCustomer(p.owner, { name, phone, place: "Bijepur" })).customer;
  const a = await add("Shree Stores", "9861000201");
  const b = await add("Maa Tarini", "9861000202");
  const c = await add("Jay Jagannath", "9861000203");
  return { ...p, a, b, c, marketing: ocUser(p.tenantId, ["marketing_staff"], "Rina") };
}
async function row(tenantId: string, id: string) {
  return (await asApp(tenantId, `select place, payment_terms from order_capture.customers where id = '${id}'`)).rows[0] as { place: string; payment_terms: string | null };
}
const run = (u: Parameters<typeof bulkChange>[0], raw: unknown) => bulkChange(u, BulkInput.parse(raw));

describe("Change many customers at once", () => {
  it("is the owner's only: Order desk, Marketing staff and support are refused", async () => {
    const p = await bulkPlant();
    for (const u of [p.desk, p.marketing, p.support, p.staff]) {
      expect((await refused(() => run(u, { ids: [p.a.id], change: { kind: "place", place: "Sohela" } }))).status).toBe(403);
      expect((await refused(() => bulkSetup(u))).status).toBe(403);
    }
  });

  it("adds a brand and keeps the brand a customer already buys (from orders); replace sets exactly the ticked ones", async () => {
    const p = await bulkPlant();
    await createOrder(p.owner, OrderInput.parse({ request_key: `bulk-${Date.now()}-${n++}`, customer: { phone: p.a.phone }, lines: [{ sku_id: b500.id, quantity: 2, rate: "110" }] }));
    let r = await run(p.owner, { ids: [p.a.id, p.b.id], change: { kind: "brands", mode: "add", brands: ["Bluemins"] } });
    expect(r).toEqual({ changed: 2, same: 0, skipped: [] });
    expect((await brandsCard(p.owner, p.a.id)).brands).toEqual(["Bluemins", "Mr.Charge"]);
    expect((await brandsCard(p.owner, p.b.id)).brands).toEqual(["Bluemins"]);
    // the same again changes nothing
    r = await run(p.owner, { ids: [p.a.id, p.b.id], change: { kind: "brands", mode: "add", brands: ["Bluemins"] } });
    expect(r).toEqual({ changed: 0, same: 2, skipped: [] });
    r = await run(p.owner, { ids: [p.a.id], change: { kind: "brands", mode: "replace", brands: ["mr.charge"] } });
    expect(r.changed).toBe(1);
    expect((await brandsCard(p.owner, p.a.id)).brands).toEqual(["Mr.Charge"]);
    // a brand not on Rates: each customer is skipped with the reason
    r = await run(p.owner, { ids: [p.b.id], change: { kind: "brands", mode: "add", brands: ["Hemex"] } });
    expect(r.skipped).toEqual([{ name: "Maa Tarini", reason: '"Hemex" is not a brand on Rates' }]);
    // one Recent changes line per customer, as on the one-customer screen
    const lines = (await recentChanges(p.owner)).map((c) => c.text).filter((t) => t.startsWith("Brands"));
    expect(lines).toHaveLength(3);
  });

  it("sets the place and the payment terms (and clears the terms)", async () => {
    const p = await bulkPlant();
    expect(await run(p.owner, { ids: [p.a.id, p.b.id, p.c.id], change: { kind: "place", place: "Sohela" } })).toEqual({ changed: 3, same: 0, skipped: [] });
    expect((await row(p.tenantId, p.c.id)).place).toBe("Sohela");
    expect(await run(p.owner, { ids: [p.a.id, p.b.id], change: { kind: "terms", terms: "net15" } })).toEqual({ changed: 2, same: 0, skipped: [] });
    expect((await row(p.tenantId, p.a.id)).payment_terms).toBe("net15");
    expect(await run(p.owner, { ids: [p.a.id, p.c.id], change: { kind: "terms", terms: null } })).toEqual({ changed: 1, same: 1, skipped: [] });
    expect((await row(p.tenantId, p.a.id)).payment_terms).toBeNull();
    expect((await bulkSetup(p.owner)).places).toEqual([{ place: "Sohela", count: 3 }]);
  });

  it("switches Drop on, skipping a switched-off customer, keeps each shop's Drop brands unless some are ticked", async () => {
    const p = await bulkPlant();
    await setDrop(p.owner, p.a.id, { enabled: false, brands: ["Mr.Charge"] });
    await updateCustomer(p.owner, p.c.id, { active: false });
    const r = await run(p.owner, { ids: [p.a.id, p.b.id, p.c.id], change: { kind: "drop", enabled: true } });
    expect(r.changed).toBe(2);
    expect(r.skipped).toEqual([{ name: "Jay Jagannath", reason: "This customer is switched off. Switch the customer on first." }]);
    expect(await dropCard(p.owner, p.a.id)).toMatchObject({ enabled: true, brands: ["Mr.Charge"] });
    expect(await dropCard(p.owner, p.b.id)).toMatchObject({ enabled: true, brands: [] });
    expect((await run(p.owner, { ids: [p.a.id, p.b.id], change: { kind: "drop", enabled: false } })).changed).toBe(2);
    expect((await dropCard(p.owner, p.a.id)).enabled).toBe(false);
  });

  it("refuses Drop when the plant has no Drop app", async () => {
    const p = await bulkPlant();
    plants.splice(plants.indexOf(p.tenantId), 1);
    setApps();
    expect((await bulkSetup(p.owner)).drop).toBeNull();
    expect((await refused(() => run(p.owner, { ids: [p.a.id], change: { kind: "drop", enabled: true } }))).status).toBe(400);
  });

  it("never touches another plant's customer and allows at most 500 at once", async () => {
    const p = await bulkPlant();
    const other = await bulkPlant();
    const r = await run(p.owner, { ids: [other.a.id], change: { kind: "place", place: "Sohela" } });
    expect(r).toEqual({ changed: 0, same: 0, skipped: [{ name: "(unknown customer)", reason: "Not found in this plant." }] });
    expect((await row(other.tenantId, other.a.id)).place).toBe("Bijepur");
    expect(BulkInput.safeParse({ ids: Array.from({ length: 501 }, () => randomUUID()), change: { kind: "place", place: "Sohela" } }).success).toBe(false);
  });

  it("brand tags also come from bills, Zoho-imported ones through the matched contact", async () => {
    const p = await bulkPlant();
    const who = p.owner.userId;
    const one = async (q: string) => ((await asApp(p.tenantId, q)).rows[0] as { id: string }).id;
    // a PlantOps bill for A (Mr.Charge) and a Zoho bill for B through its contact (Bluemins); a cancelled one for C
    const billA = await one(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, sub_total, total, created_by, created_by_name)
      values ('${p.tenantId}', 'plantops', 'B-0001', 1, '2026-11-06', '${p.a.id}', 'Shree Stores', 110, 110, '${who}', 'Sujata') returning id`);
    await asApp(p.tenantId, `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, line_total) values ('${p.tenantId}', '${billA}', 1, '${b500.id}', '500ml', 1, 110, 110)`);
    const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${p.tenantId}', '${who}', 'Sujata') returning id`);
    const contact = await one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, mobile_typed, mobile, customer_id, import_id)
      values ('${p.tenantId}', 'zc-${randomUUID()}', 'Maa Tarini', '${p.b.phone}', '${p.b.phone}', '${p.b.id}', '${imp}') returning id`);
    const billB = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
      values ('${p.tenantId}', 'zoho', 'INV-000001', 'zi-${randomUUID()}', '2026-10-01', '${contact}', 'Maa Tarini', 90, 90, '${imp}', '${who}', 'Sujata') returning id`);
    await asApp(p.tenantId, `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, line_total) values ('${p.tenantId}', '${billB}', 1, '${b1l.id}', '1L', 1, 90, 90)`);
    const billC = await one(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, sub_total, total, created_by, created_by_name, cancelled_at, cancelled_by, cancelled_by_name, cancel_reason)
      values ('${p.tenantId}', 'plantops', 'B-0002', 2, '2026-11-06', '${p.c.id}', 'Jay Jagannath', 90, 90, '${who}', 'Sujata', now(), '${who}', 'Sujata', 'wrong') returning id`);
    await asApp(p.tenantId, `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, line_total) values ('${p.tenantId}', '${billC}', 1, '${b1l.id}', '1L', 1, 90, 90)`);

    const index = await customerBrandIndex(p.owner);
    expect(index.labels[p.a.id]).toEqual(["Mr.Charge"]);
    expect(index.labels[p.b.id]).toEqual(["Bluemins"]);
    expect(index.ids[NO_BRAND]).toEqual([p.c.id]);
  });
});

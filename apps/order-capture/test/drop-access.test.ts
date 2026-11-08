// Drop Phase 1, staff side (docs/CUSTOMER_APP_PHASE_PLAN.md, mock-ups 1–4): the Drop card, Can use Drop + brands,
// extra phones (one shop per phone, also enforced by the database), Make main phone, the Drop shops list, who may do
// what, Recent changes, and an extra phone being the same shop everywhere (bot / Calls / New order / customer list /
// upload / mobile change).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recentChanges } from "@/server/audit";
import { createCustomer, findByPhone } from "@/server/customers";
import { updateCustomerDetails } from "@/server/customer-details";
import { addPhone, dropCard, dropShops, makeMain, removePhone, setDrop, SetDropInput } from "@/server/drop/manage";
import { dropSettingsProblem } from "@/server/drop/config";
import { withTenant } from "@/server/db";
import { createOrder, OrderInput } from "@/server/orders";
import { saveRates } from "@/server/rates";
import { previewUpload, UploadInput } from "@/server/upload";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, dbError, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const [b1l, , jar] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];
const SECRET = "s".repeat(40);
const plants: string[] = [];

function setApps() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
}

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = SECRET;
});
afterAll(async () => {
  await platform.close();
  delete process.env.DROP_APPS;
  delete process.env.DROP_CODE_SECRET;
});
afterEach(() => setApps());

/** A plant set up for Drop, with a second brand (Mr.Charge on the Jar product) and two customers. */
async function dropPlant() {
  const p = plant();
  plants.push(p.tenantId);
  setApps();
  await saveRates(p.owner, { rates: [{ sku_id: jar.id, unit: "jar", default_rate: "", brand: "Mr.Charge" }] });
  const shop = (await createCustomer(p.owner, { name: "Shree Stores", phone: "9861000001", place: "Bijepur" })).customer;
  const other = (await createCustomer(p.owner, { name: "Maa Tarini Traders", phone: "9437000002", place: "Bargarh" })).customer;
  const marketing = ocUser(p.tenantId, ["marketing_staff"], "Rina");
  const accounts = ocUser(p.tenantId, ["accounts"], "Asha");
  return { ...p, shop, other, marketing, accounts };
}

describe("Can use Drop and brands", () => {
  it("owner switches a shop on with Mr.Charge, then off; each change is one audit row in Recent changes", async () => {
    const p = await dropPlant();
    let card = await dropCard(p.owner, p.shop.id);
    expect(card).toMatchObject({ name: "Shree Stores", set_up: true, main_brand: "Bluemins", enabled: false, brands: [], brand_choices: ["Mr.Charge"], main: { phone: "9861000001", last_login: null }, extras: [] });
    expect(await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true }))).toEqual({ changed: true });
    expect(await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true }))).toEqual({ changed: false });
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["mr.charge"] }));
    card = await dropCard(p.owner, p.shop.id);
    expect(card).toMatchObject({ enabled: true, brands: ["Mr.Charge"], changed_by: "Sujata" });
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: false, brands: ["Mr.Charge"] }));
    expect((await dropCard(p.owner, p.shop.id)).enabled).toBe(false);
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toContain("Drop app switched on for Shree Stores");
    expect(texts).toContain("Drop app brands for Shree Stores: Mr.Charge");
    expect(texts).toContain("Drop app switched off for Shree Stores");
  });

  it("refuses a brand that is not on Rates, a switched-off customer, and a plant without a Drop app", async () => {
    const p = await dropPlant();
    expect((await refused(() => setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Pepsi"] })))).status).toBe(400);
    const { updateCustomer } = await import("@/server/customers");
    await updateCustomer(p.owner, p.other.id, { active: false });
    expect(await refused(() => setDrop(p.owner, p.other.id, SetDropInput.parse({ enabled: true })))).toMatchObject({ status: 409 });
    plants.splice(plants.indexOf(p.tenantId), 1);
    setApps();
    expect((await dropCard(p.owner, p.shop.id)).set_up).toBe(false);
    expect((await refused(() => setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true })))).status).toBe(409);
  });

  it("who may do what: owner all; Order desk sees and adds / removes phones; support reads; Accounts / Marketing / plant staff none", async () => {
    const p = await dropPlant();
    expect((await dropCard(p.desk, p.shop.id)).can).toEqual({ manage: false, phones: true });
    expect((await dropCard(p.support, p.shop.id)).can).toEqual({ manage: false, phones: false });
    expect((await refused(() => setDrop(p.desk, p.shop.id, SetDropInput.parse({ enabled: true })))).status).toBe(403);
    await addPhone(p.desk, p.shop.id, { phone: "+91 70080 99001" });
    expect((await refused(() => makeMain(p.desk, p.shop.id, { phone: "7008099001", reason: "new number" }))).status).toBe(403);
    await removePhone(p.desk, p.shop.id, { phone: "7008099001" });
    for (const u of [p.support]) expect((await refused(() => addPhone(u, p.shop.id, { phone: "7008099002" }))).status).toBe(403);
    for (const u of [p.marketing, p.accounts, p.staff, p.keeper]) {
      expect((await refused(() => dropCard(u, p.shop.id))).status).toBe(403);
      expect((await refused(() => dropShops(u))).status).toBe(403);
    }
    expect((await refused(() => dropShops(p.desk))).status).toBe(403);
  });
});

describe("extra phones", () => {
  it("added and removed with the clash messages of the mock-up; the database refuses a clash too", async () => {
    const p = await dropPlant();
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    expect((await dropCard(p.owner, p.shop.id)).extras).toMatchObject([{ phone: "7008099001", added_by: "Sujata", last_login: null }]);
    expect(await refused(() => addPhone(p.owner, p.shop.id, { phone: "9861000001" }))).toMatchObject({ status: 409, message: "98610 00001 is already this shop's main phone." });
    expect(await refused(() => addPhone(p.owner, p.shop.id, { phone: "7008099001" }))).toMatchObject({ status: 409, message: "70080 99001 is already an extra phone of this shop." });
    expect(await refused(() => addPhone(p.owner, p.shop.id, { phone: "9437000002" }))).toMatchObject({ status: 409, message: "94370 00002 is already the main phone of Maa Tarini Traders. A phone can belong to one shop only." });
    expect(await refused(() => addPhone(p.owner, p.other.id, { phone: "7008099001" }))).toMatchObject({ status: 409, message: "70080 99001 is already an extra phone of Shree Stores. A phone can belong to one shop only." });
    expect((await refused(() => addPhone(p.owner, p.shop.id, { phone: "12345" }))).status).toBe(400);
    // the database trigger, without the app's checks
    const raw = (customer: string, phone: string) =>
      asApp(p.tenantId, `insert into order_capture.app_phone_changes (tenant_id, customer_id, phone, action, changed_by, changed_by_name) values ('${p.tenantId}', '${customer}', '${phone}', 'add', gen_random_uuid(), 'X')`);
    expect(await dbError(raw(p.other.id, "7008099001"))).toMatch(/already belongs to another customer/);
    expect(await dbError(raw(p.other.id, "9861000001"))).toMatch(/already belongs to another customer/);
    expect(await dbError(asApp(p.tenantId, `update order_capture.customers set phone = '7008099001' where id = '${p.other.id}'`))).toMatch(/already belongs to another customer/);
    // removed: free again for another shop
    await removePhone(p.owner, p.shop.id, { phone: "7008099001" });
    expect((await refused(() => removePhone(p.owner, p.shop.id, { phone: "7008099001" }))).status).toBe(404);
    await addPhone(p.owner, p.other.id, { phone: "7008099001" });
    expect(await dbError(raw(p.shop.id, "7008099001"))).toMatch(/already belongs to another customer/);
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toContain("Drop app: extra phone 70080 99001 added for Shree Stores");
    expect(texts).toContain("Drop app: extra phone 70080 99001 removed from Shree Stores");
  });

  it("two people adding the same number to two shops at once: only one wins", async () => {
    const p = await dropPlant();
    const results = await Promise.allSettled([addPhone(p.owner, p.shop.id, { phone: "7008099009" }), addPhone(p.desk, p.other.id, { phone: "7008099009" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await withTenant(p.tenantId, (tx) => findByPhone(tx, p.tenantId, "7008099009"));
    expect([p.shop.id, p.other.id]).toContain(owners!.id);
  });

  it("is the same shop everywhere: lookup, customer list, New order, upload, mobile change", async () => {
    const p = await dropPlant();
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    expect((await withTenant(p.tenantId, (tx) => findByPhone(tx, p.tenantId, "7008099001")))!.id).toBe(p.shop.id);
    expect(await createCustomer(p.desk, { name: "Someone", phone: "70080 99001", place: "Sohela" })).toMatchObject({ created: false, customer: { id: p.shop.id } });
    const order = await createOrder(p.desk, OrderInput.parse({ request_key: `drop-${Date.now()}`, customer: { phone: "7008099001", name: "X", place: "Y" }, lines: [{ sku_id: b1l.id, quantity: 2, rate: "140" }] }));
    expect(order.customer).toMatchObject({ name: "Shree Stores", phone: "9861000001" });
    const preview = await previewUpload(p.owner, UploadInput.parse({ rows: [{ line: 2, name: "New Shop", phone: "7008099001", place: "Sohela" }] }));
    expect(preview.added).toEqual([]);
    expect(preview.rejected).toEqual([{ lines: [2], phone: "7008099001", reason: "This number is an extra Drop phone of Shree Stores" }]);
    expect(await refused(() => updateCustomerDetails(p.owner, p.other.id, { phone: "7008099001", phone_reason: "new number" }))).toMatchObject({ status: 409, message: "Shree Stores has this number as an extra Drop phone. A number belongs to one customer." });
    expect((await refused(() => updateCustomerDetails(p.owner, p.shop.id, { phone: "7008099001", phone_reason: "new number" }))).message).toMatch(/Make main phone/);
  });
});

describe("Make main phone", () => {
  it("swaps the main and the extra phone, needs a reason, and is audited like a mobile change", async () => {
    const p = await dropPlant();
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    expect((await refused(() => makeMain(p.owner, p.shop.id, { phone: "7008099001", reason: "x" }))).status).toBe(400);
    expect((await refused(() => makeMain(p.owner, p.shop.id, { phone: "9437000002", reason: "new number" }))).status).toBe(404);
    expect(await makeMain(p.owner, p.shop.id, { phone: "7008099001", reason: "Owner changed his number" })).toEqual({ phone: "7008099001", extra: "9861000001" });
    const card = await dropCard(p.owner, p.shop.id);
    expect(card.main.phone).toBe("7008099001");
    expect(card.extras.map((e) => e.phone)).toEqual(["9861000001"]);
    expect((await withTenant(p.tenantId, (tx) => findByPhone(tx, p.tenantId, "9861000001")))!.id).toBe(p.shop.id);
    const texts = (await recentChanges(p.owner)).map((c) => c.text);
    expect(texts).toContain("Drop app: 70080 99001 is now the main phone of Shree Stores (was 98610 00001): Owner changed his number");
  });
});

describe("Drop shops list", () => {
  it("lists switched-on shops with phones and brands, and the three pilot numbers", async () => {
    const p = await dropPlant();
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Mr.Charge"] }));
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    await setDrop(p.owner, p.other.id, SetDropInput.parse({ enabled: true }));
    await setDrop(p.owner, p.other.id, SetDropInput.parse({ enabled: false }));
    const list = await dropShops(p.support);
    expect(list.counts).toEqual({ on: 1, logged_in: 0, used_week: 0 });
    expect(list.shops).toEqual([{ id: p.shop.id, name: "Shree Stores", place: "Bijepur", phones: 2, brands: ["Bluemins", "Mr.Charge"], last_login: null }]);
  });
});

describe("settings", () => {
  it("a broken DROP_APPS or a short secret is named for /health and switches Drop off", async () => {
    const p = await dropPlant();
    process.env.DROP_APPS = '{"drop": {"tenant_id": "nope"}}';
    expect(dropSettingsProblem()).toMatch(/DROP_APPS is not valid/);
    expect((await dropCard(p.owner, p.shop.id)).set_up).toBe(false);
    setApps();
    process.env.DROP_CODE_SECRET = "short";
    expect(dropSettingsProblem()).toMatch(/DROP_CODE_SECRET/);
    expect((await dropCard(p.owner, p.shop.id)).set_up).toBe(false);
    process.env.DROP_CODE_SECRET = SECRET;
    expect(dropSettingsProblem()).toBeNull();
  });
});

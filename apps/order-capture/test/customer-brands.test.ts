// Brands a customer buys (owner, 2026-11-15; Sales migration 0024): the card, who may change it, the history and
// Recent changes, what New order / Change order get, tenant isolation, and the picker's grouping and short names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recentChanges } from "@/server/audit";
import { createCustomer } from "@/server/customers";
import { brandsCard, changePicker, listBrandLabels, setBrands, SetBrandsInput } from "@/server/customer-brands";
import { createOrder, lookupCustomer, OrderInput } from "@/server/orders";
import { saveRates } from "@/server/rates";
import { brandGroups, shortName } from "@/lib/product-picker";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const [b1l, b500, jar] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

let n = 0;
const key = () => `brands-test-${Date.now()}-${n++}`;

/** A plant with Bluemins 1L, Mr.Charge 500ml (re-branded on Rates) and the Jar with no brand; one customer who bought 1L. */
async function brandPlant() {
  const p = plant();
  await saveRates(p.owner, {
    rates: [
      { sku_id: b1l.id, unit: "box", default_rate: "90", brand: "Bluemins" },
      { sku_id: b500.id, unit: "box", default_rate: "110", brand: "Mr.Charge" },
      { sku_id: jar.id, unit: "jar", default_rate: "", brand: "" },
    ],
  });
  const order = await createOrder(p.desk, OrderInput.parse({ request_key: key(), customer: { phone: "9861000101", name: "Shree Stores", place: "Bijepur" }, lines: [{ sku_id: b1l.id, quantity: 5, rate: "92" }] }));
  const shop = (await lookupCustomer(p.desk, "9861000101")).customer!;
  return { ...p, shop, order };
}

describe("Brands they buy", () => {
  it("starts empty (every brand), offers the Rates brands with Other last, and names the brands of past orders", async () => {
    const p = await brandPlant();
    const card = await brandsCard(p.owner, p.shop.id);
    expect(card).toMatchObject({ name: "Shree Stores", brands: [], choices: ["Bluemins", "Mr.Charge", ""], from_orders: ["Bluemins"], changed_by: null, can_set: true });
    expect((await lookupCustomer(p.desk, "9861000101")).brands).toEqual([]);
  });

  it("Order desk saves brands (any letter case), the same again changes nothing, and each change is one Recent changes line", async () => {
    const p = await brandPlant();
    expect(await setBrands(p.desk, p.shop.id, SetBrandsInput.parse({ brands: ["mr.charge", "BLUEMINS", "Bluemins"] }))).toEqual({ changed: true });
    expect(await setBrands(p.desk, p.shop.id, SetBrandsInput.parse({ brands: ["Mr.Charge", "Bluemins"] }))).toEqual({ changed: false });
    let card = await brandsCard(p.owner, p.shop.id);
    expect(card).toMatchObject({ brands: ["Bluemins", "Mr.Charge"], changed_by: p.desk.name });
    expect((await lookupCustomer(p.owner, "9861000101")).brands).toEqual(["Bluemins", "Mr.Charge"]);

    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: [""] }));
    expect((await brandsCard(p.owner, p.shop.id)).brands).toEqual([""]);
    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: [] }));
    card = await brandsCard(p.owner, p.shop.id);
    expect(card.brands).toEqual([]);

    const lines = (await recentChanges(p.owner)).map((c) => c.text).filter((t) => t.startsWith("Brands"));
    expect(lines).toEqual(["Brands Shree Stores buys: every brand", "Brands Shree Stores buys: Other (no brand)", "Brands Shree Stores buys: Bluemins, Mr.Charge"]);
    // kept as a history: three rows, none changed or deleted
    expect((await asApp(p.tenantId, `select count(*)::int as n from order_capture.customer_brand_changes where customer_id = '${p.shop.id}'`)).rows[0]).toEqual({ n: 3 });
  });

  it("refuses a brand that is not on Rates", async () => {
    const p = await brandPlant();
    await expect(setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: ["Hemex"] }))).rejects.toMatchObject({ status: 400 });
  });

  it("a saved brand renamed away on Rates stays tickable until removed", async () => {
    const p = await brandPlant();
    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: ["Mr.Charge"] }));
    await saveRates(p.owner, { rates: [{ sku_id: b500.id, unit: "box", default_rate: "110", brand: "MrCharge" }] });
    const card = await brandsCard(p.owner, p.shop.id);
    expect(card.choices).toEqual(["Bluemins", "Mr.Charge", "MrCharge", ""]);
    expect(await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: ["Mr.Charge", "MrCharge"] }))).toEqual({ changed: true });
  });

  it("who may: owner and Order desk change; Accounts, Marketing staff and support read; plant staff and store keepers neither", async () => {
    const p = await brandPlant();
    const accounts = ocUser(p.tenantId, ["accounts"], "Asha");
    const marketing = ocUser(p.tenantId, ["marketing_staff"], "Rina");
    for (const u of [accounts, marketing, p.support]) {
      expect((await brandsCard(u, p.shop.id)).can_set).toBe(false);
      await refused(() => setBrands(u, p.shop.id, { brands: ["Bluemins"] }));
    }
    for (const u of [p.staff, p.keeper]) await refused(() => brandsCard(u, p.shop.id));
    expect((await brandsCard(p.desk, p.shop.id)).can_set).toBe(true);
  });

  it("another plant sees and changes nothing", async () => {
    const p = await brandPlant();
    const other = plant();
    await expect(brandsCard(other.owner, p.shop.id)).rejects.toMatchObject({ status: 404 });
    await expect(setBrands(other.owner, p.shop.id, { brands: [] })).rejects.toMatchObject({ status: 404 });
    await expect(changePicker(other.owner, p.order.id)).rejects.toMatchObject({ status: 404 });
  });

  it("Change order gets the customer's brands and last rates", async () => {
    const p = await brandPlant();
    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: ["Bluemins"] }));
    expect(await changePicker(p.desk, p.order.id)).toEqual({ brands: ["Bluemins"], lastRates: { [b1l.id]: "92.00" } });
    await refused(() => changePicker(p.staff, p.order.id));
  });

  it("a new customer has no brands", async () => {
    const p = await brandPlant();
    await createCustomer(p.owner, { name: "New Shop", phone: "9437000202", place: "Bargarh" });
    expect((await lookupCustomer(p.desk, "9437000202")).brands).toEqual([]);
  });
});

describe("the picker", () => {
  it("short names drop the brand in front and the pack note, and keep a name that doesn't start with its brand", () => {
    expect(shortName({ product: "Bluemins 1L Water Bottle (1 L × 12)", brand: "Bluemins" })).toBe("1L Water Bottle");
    expect(shortName({ product: "Mr.Charge 1 Litre Deionised Water (1 L × 12)", brand: "Mr.Charge" })).toBe("1 Litre Deionised Water");
    expect(shortName({ product: "Bluemins Water - 20 Litre (20 L)", brand: "Bluemins 20L" })).toBe("Bluemins Water - 20 Litre");
    expect(shortName({ product: "Hemex (1 L × 12)", brand: "Hemex" })).toBe("Hemex");
    expect(shortName({ product: "Empty Bottle 5L (5 L)", brand: "" })).toBe("Empty Bottle 5L");
  });

  it("groups by brand A–Z, any letter case together, with no brand last", () => {
    const groups = brandGroups([
      { id: 1, brand: "" },
      { id: 2, brand: "Mr.Charge" },
      { id: 3, brand: "Bluemins" },
      { id: 4, brand: "bluemins" },
      { id: 5, brand: "Hemex" },
    ]);
    expect(groups.map(([b, ps]) => [b, ps.map((p) => p.id)])).toEqual([
      ["Bluemins", [3, 4]],
      ["Hemex", [5]],
      ["Mr.Charge", [2]],
      ["", [1]],
    ]);
  });
});

describe("brand labels on the customer list", () => {
  it("ticked brands win, else the brands of past orders, else none; 'Other' is never a label", async () => {
    const p = await brandPlant();
    const fresh = await createCustomer(p.owner, { name: "New Shop", phone: "9861000102", place: "Attabira" });
    const ids = [p.shop.id, fresh.customer.id];
    let r = await listBrandLabels(p.desk, ids);
    expect(r.labels).toEqual({ [p.shop.id]: ["Bluemins"] });
    expect(r.palette.bluemins).not.toBe(r.palette["mr.charge"]);

    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: ["Mr.Charge", ""] }));
    r = await listBrandLabels(p.support, ids);
    expect(r.labels).toEqual({ [p.shop.id]: ["Mr.Charge"] });

    await setBrands(p.owner, p.shop.id, SetBrandsInput.parse({ brands: [] }));
    expect((await listBrandLabels(p.owner, ids)).labels).toEqual({ [p.shop.id]: ["Bluemins"] });
  });

  it("never reads another plant's customers, and a store keeper is refused", async () => {
    const a = await brandPlant();
    const b = plant();
    expect((await listBrandLabels(b.owner, [a.shop.id])).labels).toEqual({});
    expect((await refused(() => listBrandLabels(a.keeper, [a.shop.id]))).status).toBe(403);
  });
});

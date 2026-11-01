// Brand tags (owner, 2026-11-01): one brand per product, set on Rates or guessed from the name; tags on order cards,
// the ?brand= filter with its chips, brand totals in the owner's pending summary, the CSV's Brand column.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brandColour, guessBrand } from "@/lib/brand";
import { recentChanges } from "@/server/audit";
import { cancelOrder } from "@/server/handling";
import { exportCsv, listOrders, pendingSummary } from "@/server/list";
import { createOrder, OrderInput } from "@/server/orders";
import { listRates, RatesInput, saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const [b1l, b500, jar] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];
type P = ReturnType<typeof plant>;
let k = 0;
const add = (p: P, phone: string, name: string, lines: { sku_id: string; quantity: number }[]) =>
  createOrder(p.desk, OrderInput.parse({ request_key: `brand-${Date.now()}-${++k}`, customer: { phone, name, place: "Bargarh" }, lines: lines.map((l) => ({ ...l, rate: "100" })) }));
const brandOf = (p: P, sku_id: string, unit: string, brand?: string) => saveRates(p.owner, RatesInput.parse({ rates: [{ sku_id, unit, default_rate: "", ...(brand === undefined ? {} : { brand }) }] }));

describe("the guess from the product name", () => {
  it.each([
    ["Mr.Charge 5L", "Mr.Charge"],
    ["Bluemins (1 L × 12)", "Bluemins"],
    ["Bluemins 500ml (500 ml × 24)", "Bluemins"],
    ["Hemex", "Hemex"],
    ["Mr. Charge 2L", "Mr. Charge"],
    ["20L Jar", null],
  ])("%s → %s", (name, brand) => expect(guessBrand(name)).toBe(brand));

  it("a brand keeps its colour in any case", () => expect(brandColour("bluemins")).toBe(brandColour("Bluemins")));
});

describe("brand on Rates (owner)", () => {
  it("shows the guess; the same text back saves nothing; a typed brand and '' (no brand) are saved and audited", async () => {
    const p = plant();
    expect((await listRates(p.owner)).map((r) => r.brand)).toEqual(["Bluemins", "Bluemins", "Jar"]);
    expect(await brandOf(p, b1l.id, "box", "Bluemins")).toEqual({ changed: 0 });
    expect(await brandOf(p, jar.id, "jar", "Mr.Charge")).toEqual({ changed: 1 });
    expect(await brandOf(p, b500.id, "box", "")).toEqual({ changed: 1 });
    expect(await brandOf(p, b500.id, "box")).toEqual({ changed: 0 }); // left out = unchanged
    expect((await listRates(p.owner)).map((r) => r.brand)).toEqual(["Bluemins", "", "Mr.Charge"]);
    expect((await recentChanges(p.owner)).map((c) => c.text)).toEqual(["Rates changed. Bluemins (500 ml × 24): brand Bluemins → none", "Rates changed. Jar (20 L): brand Jar → Mr.Charge"]);
  });

  it("a brand over 30 characters is refused", () => {
    expect(RatesInput.safeParse({ rates: [{ sku_id: jar.id, unit: "jar", default_rate: "", brand: "x".repeat(31) }] }).success).toBe(false);
  });
});

describe("brands in the order list", () => {
  it("tags per order, the brand list for the chips, and ?brand= shows the orders with any product of that brand", async () => {
    const p = plant();
    await brandOf(p, jar.id, "jar", "Mr.Charge");
    const a = await add(p, "9000000001", "Kings Auto", [{ sku_id: jar.id, quantity: 2 }]);
    const b = await add(p, "9000000002", "Binaya Dhaba", [{ sku_id: b1l.id, quantity: 1 }, { sku_id: jar.id, quantity: 1 }]);
    const c = await add(p, "9000000003", "Mahapatra", [{ sku_id: b500.id, quantity: 4 }]);
    const all = await listOrders(p.owner);
    expect(all.brands).toEqual(["Bluemins", "Mr.Charge"]);
    expect(all.orders.map((o) => [o.customer, o.brands])).toEqual([
      ["Kings Auto", ["Mr.Charge"]],
      ["Binaya Dhaba", ["Bluemins", "Mr.Charge"]],
      ["Mahapatra", ["Bluemins"]],
    ]);
    expect((await listOrders(p.owner, { brand: "Mr.Charge" })).orders.map((o) => o.id)).toEqual([a.id, b.id]);
    expect((await listOrders(p.owner, { brand: "Bluemins" })).orders.map((o) => o.id)).toEqual([b.id, c.id]);
    expect((await listOrders(p.owner, { brand: "Hemex" })).orders).toEqual([]);
    // plant staff see the tags too (a brand is not an amount)
    expect((await listOrders(p.staff, { brand: "Mr.Charge" })).orders.map((o) => o.brands)).toEqual([["Mr.Charge"], ["Bluemins", "Mr.Charge"]]);
    // a changed brand applies to old orders too (it belongs to the product, not the order)
    await brandOf(p, jar.id, "jar", "");
    expect((await listOrders(p.owner)).orders.map((o) => o.brands)).toEqual([[], ["Bluemins"], ["Bluemins"]]);
  });

  it("another plant's brands never show", async () => {
    const a = plant();
    const b = plant();
    await brandOf(a, jar.id, "jar", "Mr.Charge");
    await add(a, "9000000001", "Kings Auto", [{ sku_id: jar.id, quantity: 2 }]);
    await add(b, "9000000001", "Kings Auto", [{ sku_id: jar.id, quantity: 2 }]);
    expect((await listOrders(b.owner)).brands).toEqual(["Jar"]);
    expect((await listOrders(b.owner, { brand: "Mr.Charge" })).orders).toEqual([]);
  });
});

describe("brand totals in the owner's pending summary and the CSV", () => {
  it("one row per brand, biggest amount first, pending orders only; 'No brand' for products without one", async () => {
    const p = plant();
    await brandOf(p, jar.id, "jar", "Mr.Charge");
    await add(p, "9000000001", "Kings Auto", [{ sku_id: jar.id, quantity: 30 }]); // 3,000
    await add(p, "9000000002", "Binaya Dhaba", [{ sku_id: b1l.id, quantity: 1 }, { sku_id: jar.id, quantity: 1 }]); // 100 + 100
    const gone = await add(p, "9000000003", "Mahapatra", [{ sku_id: b500.id, quantity: 4 }]);
    await cancelOrder(p.desk, gone.id, { expected: { status: "pending", version: 1 }, reason: "customer changed mind" });
    expect((await pendingSummary(p.owner)).brands).toEqual([
      { brand: "Mr.Charge", orders: 2, units: "31 jar", amount: "3100.00" },
      { brand: "Bluemins", orders: 1, units: "1 box", amount: "100.00" },
    ]);
    await brandOf(p, b1l.id, "box", "");
    expect((await pendingSummary(p.owner)).brands.map((b) => b.brand)).toEqual(["Mr.Charge", ""]);
    const csv = (await exportCsv(p.owner)).trim().split("\r\n");
    expect(csv.slice(1).map((l) => l.split(",").at(-1))).toEqual(["Mr.Charge", "", "Mr.Charge", "Bluemins"]);
  });
});

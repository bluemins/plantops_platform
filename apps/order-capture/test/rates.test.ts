// Rates (docs/ORDER_CAPTURE_PHASE_PLAN.md "Products and rates"): the plant's ACTIVE PlantOps products, a unit (default
// "box" for a case, else the pack type) and a default rate; only the owner changes them; support reads; audited.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/rates/route";
import { defaultUnit, packText, rateText, toRate } from "@/lib/rates";
import { listRates, RatesInput, saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { auditRows, jsonReq, plant, refused, signInAs } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.skus = SKUS;
});

const [b1l, b500, jar, old] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];
const row = (sku_id: string, unit: string, default_rate: string) => ({ sku_id, unit, default_rate });

describe("unit default and rate text", () => {
  it("'box' when one pack holds several bottles, else the pack type", () => {
    expect(defaultUnit({ units_per_pack: 24, pack_type: "case" })).toBe("box");
    expect(defaultUnit({ units_per_pack: 1, pack_type: "Jar" })).toBe("jar");
    expect(defaultUnit({ units_per_pack: 1, pack_type: " " })).toBe("unit");
    expect(packText({ units_per_pack: 24, pack_type: "case" })).toBe("24 per box");
    expect(packText({ units_per_pack: 1, pack_type: "jar" })).toBe("jar");
  });

  it("rates are stored with 2 decimals and shown in rupees", () => {
    expect([toRate("90"), toRate(" 92.5 "), toRate("")]).toEqual(["90.00", "92.50", null]);
    expect([rateText("90.00"), rateText("92.50"), rateText(null), rateText("1250.00")]).toEqual(["₹90", "₹92.50", "not set", "₹1,250"]);
  });

  it.each([
    ["a negative rate", row(b500.id, "box", "-1")],
    ["3 decimals", row(b500.id, "box", "1.234")],
    ["letters", row(b500.id, "box", "ninety")],
    ["a blank unit", row(b500.id, "  ", "90")],
    ["a unit over 20 characters", row(b500.id, "x".repeat(21), "90")],
  ])("refuses %s", (_, r) => {
    expect(RatesInput.safeParse({ rates: [r] }).success).toBe(false);
  });
});

describe("the Rates list", () => {
  it("lists the active products with their default unit and no rate; the inactive product is left out", async () => {
    const p = plant();
    const rates = await listRates(p.owner);
    expect(rates.map((r) => [r.sku_id, r.unit, r.pack, r.default_rate])).toEqual([
      [b1l.id, "box", "12 per box", null],
      [b500.id, "box", "24 per box", null],
      [jar.id, "jar", "jar", null],
    ]);
    expect(rates.some((r) => r.sku_id === old.id)).toBe(false);
    expect(rates[0]!.product).toBe("Bluemins (1 L × 12)");
  });

  it("PlantOps support can read it; Order desk, plant staff and a store keeper can't", async () => {
    const p = plant();
    expect(await listRates(p.support)).toHaveLength(3);
    for (const u of [p.desk, p.staff, p.keeper]) expect((await refused(() => listRates(u))).status).toBe(403);
  });

  it("platform unreachable: no products, nothing can be saved", async () => {
    platform.skus = null;
    const p = plant(); // a new plant, so nothing is cached for it
    expect(await listRates(p.owner)).toEqual([]);
    expect(await refused(() => saveRates(p.owner, { rates: [row(b500.id, "box", "90")] }))).toMatchObject({ status: 400 });
  });
});

describe("saving rates (owner only)", () => {
  it("writes only what changed, as one audit row; saving the same again writes nothing", async () => {
    const p = plant();
    const res = await saveRates(p.owner, { rates: [row(b1l.id, "box", ""), row(b500.id, "box", "90"), row(jar.id, "jar", "50")] });
    expect(res).toEqual({ changed: 2 });
    expect((await listRates(p.owner)).map((r) => r.default_rate)).toEqual([null, "90.00", "50.00"]);
    const audit = await auditRows(p.tenantId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "rates.set", details: { by: "Sujata" } });
    expect((audit[0]!.details.rates as unknown[]).length).toBe(2);
    expect(await saveRates(p.owner, { rates: [row(b500.id, "box", "90.00"), row(jar.id, "jar", "50")] })).toEqual({ changed: 0 });
    expect(await auditRows(p.tenantId)).toHaveLength(1);
  });

  it("a saved unit wins over the default; a rate can be cleared again", async () => {
    const p = plant();
    await saveRates(p.owner, { rates: [row(jar.id, "can", "50")] });
    await saveRates(p.owner, { rates: [row(jar.id, "can", "")] });
    expect((await listRates(p.owner)).find((r) => r.sku_id === jar.id)).toMatchObject({ unit: "can", default_rate: null });
    const [, second] = await auditRows(p.tenantId);
    expect(second!.details.rates).toEqual([{ product: "Jar (20 L)", rate: { from: "50.00", to: null } }]);
  });

  it("an inactive, unknown or repeated product is refused", async () => {
    const p = plant();
    expect((await refused(() => saveRates(p.owner, { rates: [row(old.id, "box", "1")] }))).status).toBe(400);
    expect((await refused(() => saveRates(p.owner, { rates: [row(crypto.randomUUID(), "box", "1")] }))).status).toBe(400);
    expect((await refused(() => saveRates(p.owner, { rates: [row(jar.id, "jar", "1"), row(jar.id, "jar", "2")] }))).status).toBe(400);
  });

  it("Order desk, plant staff, a store keeper and PlantOps support are refused", async () => {
    const p = plant();
    expect(await refused(() => saveRates(p.desk, { rates: [] }))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    expect(await refused(() => saveRates(p.support, { rates: [] }))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    for (const u of [p.staff, p.keeper]) expect((await refused(() => saveRates(u, { rates: [] }))).status).toBe(403);
  });

  it("through the API: owner 200, Order desk 403, a bad rate 400", async () => {
    const p = plant();
    signInAs(p.owner);
    const ok = await PUT(jsonReq("PUT", "/api/rates", { rates: [row(b500.id, "box", "95.50")] }), undefined as never);
    expect([ok.status, await ok.json()]).toEqual([200, { changed: 1 }]);
    expect((await PUT(jsonReq("PUT", "/api/rates", { rates: [row(b500.id, "box", "9.999")] }), undefined as never)).status).toBe(400);
    vi.restoreAllMocks();
    signInAs(p.desk);
    expect((await PUT(jsonReq("PUT", "/api/rates", { rates: [row(b500.id, "box", "1")] }), undefined as never)).status).toBe(403);
  });

  it("each plant has its own rates", async () => {
    const a = plant();
    const b = plant();
    await saveRates(a.owner, { rates: [row(b500.id, "case", "90")] });
    expect((await listRates(b.owner)).find((r) => r.sku_id === b500.id)).toMatchObject({ unit: "box", default_rate: null });
    expect(await auditRows(b.tenantId)).toEqual([]);
  });
});

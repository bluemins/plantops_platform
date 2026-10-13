// Recent changes: every audit row in plain words, newest first; owner and PlantOps support only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeChange } from "@/lib/changes";
import { recentChanges } from "@/server/audit";
import { createCustomer, CustomerInput, updateCustomer } from "@/server/customers";
import { saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant, refused } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

describe("in words", () => {
  it.each([
    [
      "rates.set",
      { rates: [{ product: "Bluemins (500 ml × 24)", unit: { from: "box", to: "case" }, rate: { from: "90.00", to: "95.50" } }, { product: "Jar (20 L)", rate: { from: null, to: "50.00" } }] },
      "Rates changed. Bluemins (500 ml × 24): unit box → case, rate ₹90 → ₹95.50; Jar (20 L): rate not set → ₹50",
    ],
    ["customer.add", { name: "Sri ram hotel", place: "bijepur", phone: "9692905402" }, "Added customer Sri ram hotel, bijepur (96929 05402)"],
    [
      "customer.update",
      { name: "Sri Ram Hotel", phone: "9692905402", changes: { name: { from: "Sri ram hotel", to: "Sri Ram Hotel" }, place: { from: "bijepur", to: "Bijepur" } } },
      "Customer Sri Ram Hotel (96929 05402): name Sri ram hotel → Sri Ram Hotel, place bijepur → Bijepur",
    ],
    ["customer.update", { name: "Raju Store", phone: "9700000455", changes: { active: { from: true, to: false } } }, "Customer Raju Store (97000 00455): switched off"],
    ["customers.upload", { file: "customers.csv", added: 180, updated: 7, unchanged: 22, rejected: 5 }, "Uploaded customers from customers.csv: 180 new, 7 updated, 22 unchanged, 5 rows rejected"],
    ["customers.upload", { file: null, added: 1, updated: 0, unchanged: 0, rejected: 1 }, "Uploaded customers: 1 new, 0 updated, 0 unchanged, 1 row rejected"],
  ])("%s", (action, details, text) => {
    expect(describeChange(action, details)).toBe(text);
  });
});

describe("the Recent changes list", () => {
  it("newest first, with who did it; owner and support only", async () => {
    const p = plant();
    const { customer } = await createCustomer(p.desk, CustomerInput.parse({ name: "Sri ram hotel", phone: "9692905402", place: "bijepur" }));
    await updateCustomer(p.owner, customer.id, { active: false });
    await saveRates(p.owner, { rates: [{ sku_id: SKUS[2]!.id, unit: "jar", default_rate: "50" }] });
    const list = await recentChanges(p.owner);
    expect(list.map((c) => [c.by, c.text])).toEqual([
      ["Sujata", "Rates changed. Jar (20 L): rate not set → ₹50"],
      ["Sujata", "Customer Sri ram hotel (96929 05402): switched off"],
      ["Atharv", "Added customer Sri ram hotel, bijepur (96929 05402)"],
    ]);
    expect(await recentChanges(p.support)).toHaveLength(3);
    for (const u of [p.desk, p.staff, p.keeper]) expect((await refused(() => recentChanges(u))).status).toBe(403);
    expect(await recentChanges(plant().owner)).toEqual([]);
  });
});

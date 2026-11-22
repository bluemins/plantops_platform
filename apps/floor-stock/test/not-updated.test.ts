// "Consumable not updated correctly" (owner, 2026-11-22): a material used by today's production still at the last
// count's number is flagged on the count screen, the day page, the home page, the tile, the notification and the
// WhatsApp copy. Warn only: the count is still saved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { notUpdated, totalsOf, usedMaterials, type MaterialSetup } from "@/lib/not-updated";
import { whatsappText } from "@/lib/whatsapp";
import { countForm, submitCount } from "@/server/counts";
import { countNotification } from "@/server/notify";
import { setContent, setRecipe } from "@/server/recipes";
import { summaryFor } from "@/server/summary";
import { dayView } from "@/server/views";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

const YESTERDAY = addDays(TODAY, -1);

// ---------- the rule (pure) ----------
const pcs = (qty: number) => ({ qty, measure: "pcs" as const, second_is_pieces: false, damage_pct: 0 });
const setup: MaterialSetup = {
  previous_date: "2026-11-21",
  products: [{ item_id: "bm", name: "BM 1L", unit: "box", per_box: 12, lines: [{ material_item_id: "cap", qty: 1, measure: "pcs" }, { material_item_id: "bottle", qty: 1, measure: "pcs" }] }],
  materials: [
    { item_id: "cap", name: "Cap D Blue", unit: "box", content: pcs(8000), made_from: null, previous: { qty: 3, second: null, unit: "box" } },
    { item_id: "bottle", name: "BM 1L Empty Bottle", unit: "pkt", content: pcs(500), made_from: [{ material_item_id: "preform", qty: 18.5, measure: "g" }], previous: { qty: 2, second: null, unit: "pkt" } },
    { item_id: "preform", name: "Preform 18.5", unit: "pkt", content: { qty: 25000, measure: "g", second_is_pieces: false, damage_pct: 0 }, made_from: null, previous: { qty: 12, second: null, unit: "pkt" } },
    { item_id: "filter", name: "Filter", unit: "pcs", content: null, made_from: null, previous: { qty: 6, second: null, unit: "pcs" } },
  ],
};
const closing = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, qty]) => [k, { qty, second: null }]));

describe("the rule", () => {
  it("40 box made, cap and bottle + preform unchanged: both flagged, cap with its expected number", () => {
    const got = notUpdated(setup, new Map([["bm", 40]]), closing({ cap: 3, bottle: 2, preform: 12, filter: 6 }));
    expect(got.map((m) => m.name)).toEqual(["Cap D Blue", "BM 1L Empty Bottle"]);
    expect(got[0]).toMatchObject({ expected: 2.94, also: [] });
    expect(got[1]).toMatchObject({ expected: null, also: ["Preform 18.5"] });
  });
  it("nothing made: nothing flagged; a material not in a recipe is never flagged", () => {
    expect(notUpdated(setup, new Map(), closing({ cap: 3, bottle: 2, preform: 12, filter: 6 }))).toEqual([]);
  });
  it("a made-from bottle is fine when its preform went down (bottles were blown)", () => {
    const got = usedMaterials(setup, new Map([["bm", 40]]), closing({ cap: 2.9, bottle: 2, preform: 11.5 }));
    expect(got.filter((m) => m.not_updated)).toEqual([]);
    expect(got.find((m) => m.item_id === "cap")).toMatchObject({ not_updated: false, expected: 2.94 });
  });
  it("no earlier count, or products not known: nothing flagged / no expected number", () => {
    expect(notUpdated({ ...setup, previous_date: null }, new Map([["bm", 40]]), closing({ cap: 3 }))).toEqual([]);
    const noBox = { ...setup, products: setup.products.map((p) => ({ ...p, per_box: null })) };
    expect(notUpdated(noBox, new Map([["bm", 40]]), closing({ cap: 3, bottle: 2, preform: 12 }))[0]).toMatchObject({ name: "Cap D Blue", expected: null });
  });
  it("the second number counts too (loose labels changed = updated)", () => {
    const s: MaterialSetup = { ...setup, materials: [{ ...setup.materials[0]!, previous: { qty: 3, second: 100, unit: "box" } }] };
    expect(notUpdated(s, new Map([["bm", 1]]), new Map([["cap", { qty: 3, second: 88 }]]))).toEqual([]);
    expect(notUpdated(s, new Map([["bm", 1]]), new Map([["cap", { qty: 3, second: 100 }]]))).toHaveLength(1);
  });
  it("totals add lines in hundredths", () => {
    const t = totalsOf([
      { item_id: "a", kind: "stock", qty: 0.1, second_qty: null },
      { item_id: "a", kind: "stock", qty: 0.2, second_qty: 3 },
      { item_id: "b", kind: "production", qty: 5, second_qty: null },
    ]);
    expect(t.closing.get("a")).toEqual({ qty: 0.3, second: 3 });
    expect(t.production.get("b")).toBe(5);
  });
});

// ---------- end to end ----------
let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

/** The test plant with a recipe: 1 box = 12 bottles, each 1 label and 1 piece of roll. */
async function withRecipe() {
  const p = await stockPlant();
  await setContent(p.owner, p.label, { content_qty: 1000, content_measure: "pcs", second_is_pieces: false, damage_pct: 0 });
  await setContent(p.owner, p.roll, { content_qty: 2000, content_measure: "pcs", second_is_pieces: false, damage_pct: 0 });
  await setRecipe(p.owner, p.box, { case_size: 12, lines: [{ material_item_id: p.label, qty: 1, measure: "pcs" }, { material_item_id: p.roll, qty: 1, measure: "pcs" }] });
  await submitCount(p.keeper, fullCount(p, YESTERDAY, { box: 10, label: 3, roll: 4 }), at(YESTERDAY));
  return p;
}

describe("everyone sees it", () => {
  it("saved anyway: the notification, day page, tile and WhatsApp copy say so", async () => {
    const p = await withRecipe();
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 12, label: 3, roll: 4 }), at(TODAY));
    expect(saved.not_updated.map((m) => m.name)).toEqual(["Label 1 L", "Roll"]);

    const n = countNotification(p.keeper, saved);
    expect(n.title).toBe("Stock count saved: consumable not updated correctly (2)");
    expect(n.body).toContain("Not updated: Label 1 L, Roll still show the last count's number.");

    const day = (await dayView(p.owner, TODAY))!;
    expect(day.not_updated.map((m) => [m.name, m.expected])).toEqual([
      ["Label 1 L", 2.94],
      ["Roll", 3.97],
    ]);
    // a store keeper sees it too
    expect((await dayView(p.keeper, TODAY))!.not_updated).toHaveLength(2);

    expect((await summaryFor(p.tenantId, "owner", at(TODAY))).badges).toContainEqual({ text: "2 consumables not updated correctly", tone: "warn" });
    expect(whatsappText("Plant", TODAY, day.sections, day.not_updated.map((m) => m.name))).toMatch(/\*Consumable not updated correctly\*: Label 1 L, Roll$/);
  });

  it("a correction that changes the number removes the note", async () => {
    const p = await withRecipe();
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 12, label: 3, roll: 4 }), at(TODAY));
    const fixed = await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 12, label: 2.9, roll: 3.9 }, { expected_version: 1, reason: "updated consumables" }), at(TODAY));
    expect(fixed.not_updated).toEqual([]);
    expect(countNotification(p.keeper, fixed).title).toBe("Count corrected (v2)");
    expect((await dayView(p.owner, TODAY))!.not_updated).toEqual([]);
  });

  it("the count screen gets the recipes and the last count's closing", async () => {
    const p = await withRecipe();
    const form = await countForm(p.keeper, TODAY);
    expect(form.materials?.previous_date).toBe(YESTERDAY);
    expect(form.materials?.products.map((x) => x.per_box)).toEqual([12]);
  });

  it("a plant without recipes: nothing is checked", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, YESTERDAY, { box: 10, label: 3, roll: 4 }), at(YESTERDAY));
    const saved = await submitCount(p.keeper, fullCount(p, TODAY, { made: 5, box: 12, label: 3, roll: 4 }), at(TODAY));
    expect(saved.not_updated).toEqual([]);
    expect((await countForm(p.keeper, TODAY)).materials).toBeNull();
  });
});

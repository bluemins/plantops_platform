// The arithmetic behind "Can make" (pure functions, no database), with the owner's own example
// (docs/FLOOR_STOCK_CAN_MAKE_PLAN.md): 1 packet of preform = 25 kg, damage 0.01 %, BM 1L / DM 1L share the 18.5 g preform.
import { describe, expect, it } from "vitest";
import { canMake, contentText, onHand, type Content, type MaterialStock, type Product, type RecipeLine } from "@/lib/recipe";

const preformPacket = (grams: number): Content => ({ qty: 25000, measure: "g", second_is_pieces: false, damage_pct: grams });
const mat = (item_id: string, closing: number, content: Content | null, second_total: number | null = null): MaterialStock => ({ item_id, name: item_id, counted: true, closing, second_total, content });
const line = (material_item_id: string, qty: number, measure: RecipeLine["measure"] = "pcs"): RecipeLine => ({ material_item_id, qty, measure });
const product = (name: string, per_box: number | null, lines: RecipeLine[] | null): Product => ({ item_id: name, name, unit: "box", per_box, lines });

// tonight's example count
const materials = [
  mat("Preform 18.5 g", 3, preformPacket(0.01)),
  mat("Preform 12.5 g", 2, preformPacket(0.01)),
  mat("Preform 32 g", 1, preformPacket(0.01)),
  mat("Blue cap", 6, { qty: 500, measure: "pcs", second_is_pieces: false, damage_pct: 0 }),
  mat("Label 1L", 2, { qty: 1000, measure: "pcs", second_is_pieces: true, damage_pct: 0 }, 300),
  mat("Label DM 1L", 1, { qty: 1000, measure: "pcs", second_is_pieces: true, damage_pct: 0 }, 150),
  mat("Cap", 10_000, null),
  mat("Label", 10_000, null),
];
const BM1L = product("BM 1L", 12, [line("Preform 18.5 g", 18.5, "g"), line("Blue cap", 1), line("Label 1L", 1)]);
const DM1L = product("DM 1L", 12, [line("Preform 18.5 g", 18.5, "g"), line("Blue cap", 1), line("Label DM 1L", 1)]);
const BM500 = product("BM 500ml", 24, [line("Preform 12.5 g", 12.5, "g"), line("Cap", 1), line("Label", 1)]);
const DM2L = product("DM 2L", 9, [line("Preform 32 g", 32, "g")]);
const BM250 = product("BM 250ml", 35, null);

describe("material on hand", () => {
  it("3 packets of 25 kg less 0.01 % damage = 74,992.5 g", () => {
    expect(onHand(materials[0]!)).toEqual({ qty: 74992.5, kind: "weight" });
  });
  it("bundles × pieces + loose count", () => {
    expect(onHand(materials[4]!)).toEqual({ qty: 2300, kind: "pieces" });
  });
  it("no contents set: the unit is single pieces", () => {
    expect(onHand(mat("x", 42.5, null))).toEqual({ qty: 42.5, kind: "pieces" });
  });
  it("kg and g are the same thing", () => {
    expect(onHand(mat("x", 3, { qty: 25, measure: "kg", second_is_pieces: false, damage_pct: 0 })).qty).toBe(75000);
  });
  it("loose pieces count only for a pieces content", () => {
    expect(onHand(mat("x", 1, { qty: 25, measure: "kg", second_is_pieces: true, damage_pct: 0 }, 500)).qty).toBe(25000);
  });
});

describe("can make", () => {
  const groups = canMake([BM1L, DM1L, BM500, DM2L, BM250], materials);

  it("BM 1L: labels run out first, 2,300 bottles = 191 box", () => {
    expect(groups[0]!.products[0]).toMatchObject({ name: "BM 1L", status: "ok", bottles: 2300, boxes: 191, limiting: ["Label 1L"] });
  });

  it("BM 1L and DM 1L share Preform 18.5 g and blue caps: one OR group with the preform total", () => {
    const g = groups[0]!;
    expect(g.products.map((p) => p.name)).toEqual(["BM 1L", "DM 1L"]);
    expect(g.products[1]).toMatchObject({ bottles: 1150, boxes: 95, limiting: ["Label DM 1L"] });
    const preform = g.shared.find((s) => s.material === "Preform 18.5 g")!;
    expect(preform.total_bottles).toBe(4053);
    expect(g.shared.find((s) => s.material === "Blue cap")!.total_bottles).toBe(3000);
  });

  it("products sharing nothing stand alone", () => {
    expect(groups.slice(1).map((g) => [g.products.map((p) => p.name), g.shared.length])).toEqual([
      [["BM 500ml"], 0],
      [["DM 2L"], 0],
      [["BM 250ml"], 0],
    ]);
  });

  it("BM 500ml 166 box (3,999 bottles), DM 2L 86 box (781 bottles), BM 250ml no recipe", () => {
    expect(groups[1]!.products[0]).toMatchObject({ bottles: 3999, boxes: 166, limiting: ["Preform 12.5 g"] });
    expect(groups[2]!.products[0]).toMatchObject({ bottles: 781, boxes: 86 });
    expect(groups[3]!.products[0]).toMatchObject({ status: "no_recipe" });
  });

  it("without damage allowance the preform makes 4,054 bottles", () => {
    const [g] = canMake([product("BM 1L", 12, [line("P", 18.5, "g")])], [mat("P", 3, preformPacket(0))]);
    expect(g!.products[0]).toMatchObject({ bottles: 4054, boxes: 337 });
  });

  it("boxes of 35 and a recipe in kg", () => {
    const [g] = canMake([product("BM 250ml", 35, [line("P", 0.0094, "kg")])], [mat("P", 1, preformPacket(0))]);
    expect(g!.products[0]).toMatchObject({ bottles: 2659, boxes: 75 });
  });

  it("a tie names every material that runs out first", () => {
    const [g] = canMake([product("A", 12, [line("cap", 1), line("label", 1)])], [mat("cap", 100, null), mat("label", 100, null)]);
    expect(g!.products[0]).toMatchObject({ bottles: 100, limiting: ["cap", "label"] });
  });

  it("nothing left → 0 box", () => {
    const [g] = canMake([product("A", 12, [line("cap", 1)])], [mat("cap", 0, null)]);
    expect(g!.products[0]).toMatchObject({ bottles: 0, boxes: 0 });
  });

  it("a material not in the count: can't work it out, and says which", () => {
    const [g] = canMake([product("A", 12, [line("cap", 1), line("label", 1)])], [mat("cap", 100, null), { ...mat("label", 0, null), counted: false }]);
    expect(g!.products[0]).toMatchObject({ status: "problem", problems: [{ kind: "not_counted", material: "label" }] });
  });

  it("weight needed but the material is counted in pieces: refused as a mismatch, not guessed", () => {
    const [g] = canMake([product("A", 12, [line("P", 18.5, "g")])], [mat("P", 3, null)]);
    expect(g!.products[0]).toMatchObject({ status: "problem", problems: [{ kind: "measure_mismatch", material: "P" }] });
  });

  it("box size unknown (products not loaded): bottles still shown", () => {
    const [g] = canMake([product("A", null, [line("cap", 1)])], [mat("cap", 30, null)]);
    expect(g!.products[0]).toMatchObject({ bottles: 30, boxes: null });
  });

  it("different amounts of a shared material: no single total, per-product numbers instead", () => {
    const [g] = canMake(
      [product("A", 1, [line("P", 10, "g")]), product("B", 1, [line("P", 20, "g")])],
      [mat("P", 1, { qty: 1000, measure: "g", second_is_pieces: false, damage_pct: 0 })],
    );
    expect(g!.shared).toEqual([{ material: "P", total_bottles: null, per_product: [{ name: "A", bottles: 100 }, { name: "B", bottles: 50 }] }]);
  });

  it("decimals add up exactly (0.1 + 0.2 style)", () => {
    const [g] = canMake([product("A", 1, [line("P", 0.3, "g")])], [mat("P", 0.1, { qty: 3, measure: "g", second_is_pieces: false, damage_pct: 0 })]);
    expect(g!.products[0]).toMatchObject({ bottles: 1 });
  });
});

describe("summary text", () => {
  it("reads like the owner would say it", () => {
    expect(contentText("packet", preformPacket(0.01))).toBe("1 packet = 25,000 g · damage 0.01%");
    expect(contentText("bundle", { qty: 1000, measure: "pcs", second_is_pieces: true, damage_pct: 0 })).toBe("1 bundle = 1,000 pcs · count = loose pieces");
  });
});

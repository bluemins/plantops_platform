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

// Plant 001's count of 16 Oct 2026 (owner, 2026-10-16): empty bottles are blown from preform, so they are
// "made from" it; BM 1L / DM 1L share Preform 18.5, the BM products share D Blue caps, the DM products yellow caps.
describe("made from (one step: preform → empty bottle → product)", () => {
  const pcs = (n: number, damage = 0.01): Content => ({ qty: n, measure: "pcs", second_is_pieces: false, damage_pct: damage });
  const bottle = (id: string, closing: number, per: number, preform: string, grams: number): MaterialStock => ({ ...mat(id, closing, pcs(per)), made_from: [line(preform, grams, "g")] });
  const stock = [
    mat("Preform 18.5", 12, preformPacket(0.01)),
    mat("Preform 12.5", 7, preformPacket(0.01)),
    mat("Preform 9.4", 1, preformPacket(0.01)),
    mat("Preform 32", 2, preformPacket(0.01)),
    bottle("BM 1L Empty Bottle", 2, 400, "Preform 18.5", 18.5),
    bottle("DM 1L Empty Bottle", 3.5, 400, "Preform 18.5", 18.5),
    bottle("BM 500ml Empty Bottle", 4, 800, "Preform 12.5", 12.5),
    bottle("BM 250ml Empty Bottle", 1, 1200, "Preform 9.4", 9.4),
    bottle("DM 2L Empty Bottle", 0.5, 200, "Preform 32", 32),
    mat("Screw cap D Blue", 2, pcs(8000)),
    mat("Screw cap yellow", 2, pcs(8000, 0.001)),
    mat("BM 1L label", 8.8, pcs(5000)),
  ];
  const groups = canMake(
    [
      product("BM 1L", 12, [line("BM 1L Empty Bottle", 1), line("BM 1L label", 1), line("Screw cap D Blue", 1)]),
      product("BM 500ml", 24, [line("BM 500ml Empty Bottle", 1), line("Screw cap D Blue", 1)]),
      product("BM 250ml", 35, [line("BM 250ml Empty Bottle", 1), line("Screw cap D Blue", 1)]),
      product("DM 1L", 12, [line("DM 1L Empty Bottle", 1), line("Screw cap yellow", 1)]),
      product("DM 2L", 9, [line("DM 2L Empty Bottle", 1), line("Screw cap yellow", 1)]),
    ],
    stock,
  );
  const [g] = groups;

  it("all five share something: one OR group", () => {
    expect(groups).toHaveLength(1);
    expect(g!.products.map((p) => p.name)).toEqual(["BM 1L", "BM 500ml", "BM 250ml", "DM 1L", "DM 2L"]);
  });

  it("BM 1L: 799 ready + 16,214 from Preform 18.5; the cap runs out first at 15,998 bottles = 1,333 box", () => {
    expect(g!.products[0]).toMatchObject({ status: "ok", bottles: 15998, boxes: 1333, limiting: ["Screw cap D Blue"], made: [{ material: "BM 1L Empty Bottle", ready: 799, made: 16214, from: ["Preform 18.5"] }] });
  });

  it("the other products", () => {
    expect(g!.products.slice(1)).toMatchObject([
      { name: "BM 500ml", bottles: 15998, boxes: 666, limiting: ["Screw cap D Blue"], made: [{ ready: 3199, made: 13998 }] },
      { name: "BM 250ml", bottles: 3858, boxes: 110, limiting: ["BM 250ml Empty Bottle"], made: [{ ready: 1199, made: 2659 }] },
      { name: "DM 1L", bottles: 15999, boxes: 1333, limiting: ["Screw cap yellow"], made: [{ ready: 1399, made: 16214 }] },
      { name: "DM 2L", bottles: 1661, boxes: 184, limiting: ["DM 2L Empty Bottle"], made: [{ ready: 99, made: 1562 }] },
    ]);
  });

  it("Preform 18.5 is shared by BM 1L and DM 1L: enough for 16,214 bottles in total", () => {
    expect(g!.shared.find((s) => s.material === "Preform 18.5")).toEqual({ material: "Preform 18.5", total_bottles: 16214, per_product: [{ name: "BM 1L", bottles: 16214 }, { name: "DM 1L", bottles: 16214 }] });
  });

  it("without a Made from, only the counted bottles count (66 box, as before)", () => {
    const [x] = canMake([product("BM 1L", 12, [line("B", 1), line("Screw cap D Blue", 1)])], [mat("B", 2, pcs(400)), mat("Screw cap D Blue", 2, pcs(8000))]);
    expect(x!.products[0]).toMatchObject({ bottles: 799, boxes: 66, limiting: ["B"], made: [] });
  });

  it("the preform not counted: can't work it out, and says which", () => {
    const [x] = canMake([product("A", 1, [line("B", 1)])], [bottle("B", 1, 400, "P", 18.5), { ...mat("P", 0, preformPacket(0)), counted: false }]);
    expect(x!.products[0]).toMatchObject({ status: "problem", problems: [{ kind: "not_counted", material: "P" }] });
  });

  it("2 empty bottles per product: the preform's share is halved", () => {
    const [x] = canMake([product("A", 1, [line("B", 2)])], [bottle("B", 0, 400, "P", 10), mat("P", 1, { qty: 1000, measure: "g", second_is_pieces: false, damage_pct: 0 })]);
    expect(x!.products[0]).toMatchObject({ bottles: 50, made: [{ ready: 0, made: 100 }] });
  });
});

describe("summary text", () => {
  it("reads like the owner would say it", () => {
    expect(contentText("packet", preformPacket(0.01))).toBe("1 packet = 25,000 g · damage 0.01%");
    expect(contentText("bundle", { qty: 1000, measure: "pcs", second_is_pieces: true, damage_pct: 0 })).toBe("1 bundle = 1,000 pcs · count = loose pieces");
  });
});

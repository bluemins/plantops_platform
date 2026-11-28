// Days of stock (owner 2026-11-28, P4-b / P4-c): materials at production × recipe, finished goods at the day page's Sold.
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { runway, type RunwayDay } from "@/lib/runway";

const P = "00000000-0000-4000-8000-000000000001"; // 1 L box, 12 bottles
const CAP = "00000000-0000-4000-8000-000000000002"; // 1 cap per bottle, counted in pcs
const LABEL = "00000000-0000-4000-8000-000000000003"; // in no recipe
const products = [{ item_id: P, unit: "box", per_box: 12, lines: [{ material_item_id: CAP, qty: 1, measure: "pcs" as const }] }];
const materials = [
  { item_id: CAP, unit: "pcs", content: null, made_from: null },
  { item_id: LABEL, unit: "bundle", content: null, made_from: null },
];

/** n days to 2026-11-28, 10 box made a day, 50 box left each evening; caps go down by 120 a day, +5,000 delivered on day `receipt`. */
function days(n: number, receipt?: number): RunwayDay[] {
  let caps = 10_000;
  return Array.from({ length: n }, (_, i) => {
    caps -= 120;
    if (i === receipt) caps += 5_000;
    return {
      date: addDays("2026-11-28", i - n + 1),
      production: new Map([[P, 10]]),
      closing: new Map([
        [P, { qty: 50, second: null, unit: "box" }],
        [CAP, { qty: caps, second: null, unit: "pcs" }],
        [LABEL, { qty: 4, second: null, unit: "bundle" }],
      ]),
    };
  });
}

describe("runway", () => {
  it("material: on hand ÷ (boxes made × per box × recipe ÷ days); a delivery day doesn't change the rate", () => {
    const plain = runway(days(10), products, materials);
    const withDelivery = runway(days(10, 4), products, materials);
    const cap = (r: typeof plain) => r.materials.find((m) => m.item_id === CAP)!;
    expect(cap(plain)).toEqual({ item_id: CAP, per_day: 120, days_left: Math.round(((10_000 - 1_200) / 120) * 10) / 10, why: "ok" });
    expect(cap(withDelivery).per_day).toBe(120);
    expect(cap(withDelivery).days_left).toBe(Math.round(((10_000 - 1_200 + 5_000) / 120) * 10) / 10);
    expect(plain.materials.find((m) => m.item_id === LABEL)!.why).toBe("no_recipe");
  });

  it("finished product: closing ÷ average Sold (prev + made − closing)", () => {
    const r = runway(days(10), products, materials);
    expect(r.products).toEqual([{ item_id: P, sold_per_day: 10, days_of_stock: 5, why: "ok" }]);
    expect(r).toMatchObject({ counted_days: 10, from: "2026-11-19", to: "2026-11-28", enough: true });
  });

  it("fewer than 7 counts: not enough history, no numbers", () => {
    const r = runway(days(6), products, materials);
    expect(r.enough).toBe(false);
    expect(r.materials.find((m) => m.item_id === CAP)).toMatchObject({ days_left: null, why: "not_enough_history" });
    expect(r.products[0]).toMatchObject({ days_of_stock: null, why: "not_enough_history" });
  });

  it("days without the day before counted are left out of Sold; nothing made = not used", () => {
    const d = days(10).filter((_, i) => i % 2 === 0); // every other day: no Sold pair
    expect(runway(d, products, materials).products[0]!.why).toBe("not_enough_history");
    const idle = days(8).map((x) => ({ ...x, production: new Map<string, number>() }));
    expect(runway(idle, products, materials).materials.find((m) => m.item_id === CAP)!.why).toBe("not_used");
  });
});

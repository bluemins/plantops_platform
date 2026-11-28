// Plant answers Phase 4 (owner 2026-11-28): S1–S4 from Floor Stock's own facts (scope stock_answers). Pure: no database.
import { describe, expect, it } from "vitest";
import type { StockAnswers } from "@plantops/types";
import { cardById } from "@/lib/answers/cards";
import { copyText } from "@/lib/answers/copy";
import type { O1Order } from "@/lib/answers/order-cards";
import { s1Facts, s2Facts, s3Facts, s4Facts, stockMissing, type StockFacts } from "@/lib/answers/stock-cards";
import { word } from "@/lib/answers/word";

const SKU_1L = "11111111-1111-4111-8111-111111111111";
const SKU_2L = "22222222-2222-4222-8222-222222222222";
const SKU_20 = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const answers: StockAnswers = {
  count_day: "2026-11-29",
  days: [
    { date: "2026-11-28", done: true, counted_at: "2026-11-28T14:12:00.000Z", by: "Bindu", corrections: 0, not_updated: [{ name: "D Blue cap", unit: "pcs", closing: 12_500, expected: 8_400, also: [] }] },
    { date: "2026-11-29", done: false, counted_at: null, by: null, corrections: 0, not_updated: [] },
  ],
  last_counted_on: "2026-11-28",
  history: { counted_days: 20, from: "2026-11-01", to: "2026-11-28", enough: true },
  products: [
    { sku_id: SKU_1L, item_id: id(1), name: "BM 1L", unit: "box", closing: 25, can_make: { state: "ok", boxes: 116, bottles: 1392, limiting: ["Preform 18.5"], problems: [] }, sold_per_day: 30, days_of_stock: 0.8, why: "ok" },
    { sku_id: SKU_2L, item_id: id(2), name: "Mr.Charge 2L", unit: "box", closing: 12, can_make: { state: "ok", boxes: 14, bottles: 126, limiting: ["2L cap"], problems: [] }, sold_per_day: 1, days_of_stock: 70, why: "ok" },
  ],
  materials: [
    { item_id: id(3), name: "D Blue cap", unit: "pcs", closing: 8_400, per_day: 4_100, days_left: 2.05, why: "ok" },
    { item_id: id(4), name: "BM 1L label", unit: "pcs", closing: 13_200, per_day: 2_200, days_left: 6, why: "ok" },
    { item_id: id(5), name: "Hemex 5L label", unit: "pcs", closing: 9_000, per_day: 42, days_left: 214.3, why: "ok" },
    { item_id: id(6), name: "Inkjet ink", unit: "bottle", closing: 3, per_day: null, days_left: null, why: "no_recipe" },
  ],
};
const IN: StockFacts = { state: "in", s: answers };
const order = (ref: string, lines: O1Order["lines"]): O1Order => ({ id: ref, ref, customer: "Sahoo Stores 9876543210", customer_href: "/customers/x", place: "Khurda", phone: "9876543210", created_at: "2026-11-26T05:00:00Z", lines });
const orders = [
  order("O-0412", [{ sku_id: SKU_1L, name: "BM 1L", unit: "box", quantity: 40 }, { sku_id: SKU_2L, name: "Mr.Charge 2L", unit: "box", quantity: 30 }]),
  order("O-0415", [{ sku_id: SKU_1L, name: "BM 1L", unit: "box", quantity: 25 }, { sku_id: SKU_20, name: "Bluemins 20L", unit: "jar", quantity: 14 }]),
];

describe("S1 what to make", () => {
  it("pending − stock, capped by Can make; not counted said", () => {
    const f = s1Facts(orders, IN);
    expect(f.totals).toMatchObject({ make: 2, pending: 2, stock_on: "2026-11-28" });
    expect(f.rows.map((r) => [r.product, r.needed, r.in_stock, r.make])).toEqual([
      ["BM 1L", 65, 25, 40],
      ["Mr.Charge 2L", 30, 12, 18],
      ["Bluemins 20L", 14, null, null],
    ]);
    expect(f.rows[1]!.limit).toBe("Material for only 14 box: 2L cap runs out first");
    expect(f.rows[2]!.limit).toBe("Not counted in Floor Stock");
    expect(word("S1", f)).toBe("Make 2 products today: BM 1L 40 box, Mr.Charge 2L 18 box. Not enough material for Mr.Charge 2L (2L cap runs out first).");
  });
  it("Floor Stock off or not answering: said, never zero", () => {
    expect(stockMissing({ state: "unreachable" })).toEqual(["Floor Stock did not answer just now, so stock is not checked. Try again in a minute."]);
    expect(word("S1", s1Facts(orders, { state: "off" }))).toBe("Stock is not checked, so what to make can't be worked out.");
  });
});

describe("S2 run out", () => {
  it("fewest days first, rounded down, 'about'; no-recipe materials listed apart", () => {
    const f = s2Facts(IN);
    expect(f.rows.map((r) => [r.material, r.days_left])).toEqual([["D Blue cap", 2], ["BM 1L label", 6], ["Hemex 5L label", 214]]);
    expect(f.totals.soon).toBe(2);
    expect(f.lists!.not_worked).toEqual([{ key: id(6), material: "Inkjet ink", why: "No recipe uses it" }]);
    expect(word("S2", f)).toBe("At this rate, D Blue cap runs out first: in about 2 days. 2 materials run out within 7 days.");
  });
  it("not enough history: said", () => {
    expect(stockMissing({ state: "in", s: { ...answers, history: { ...answers.history, counted_days: 4, enough: false } } }, true)[0]).toMatch(/Fewer than 7 stock counts/);
  });
});

describe("S3 last night's count", () => {
  it("done, who, not updated, today's status", () => {
    const f = s3Facts(IN);
    expect(f.totals).toMatchObject({ day: "2026-11-28", done: "Done", by: "Bindu", not_updated: 1, today: "Not done yet" });
    expect(f.rows).toEqual([{ key: "D Blue cap", material: "D Blue cap", counted: "12,500 pcs", expected: "about 8,400 pcs" }]);
    expect(word("S3", f)).toMatch(/^The count for .* was done by Bindu at 7:42 pm\. 1 material was not updated: D Blue cap\. Ask for a correction\.$/);
  });
  it("the copy leaves out who counted (a person's name: screen only)", () => {
    const text = copyText(cardById("S3")!, s3Facts(IN), "2026-11-29");
    expect(text).not.toMatch(/Bindu/);
    expect(text).toMatch(/D Blue cap/);
  });
});

describe("S4 too much on the shelf", () => {
  it("over 60 days, materials and products, most first", () => {
    const f = s4Facts(IN);
    expect(f.rows.map((r) => [r.item, r.kind, r.days])).toEqual([["Hemex 5L label", "Material", 214], ["Mr.Charge 2L", "Product", 70]]);
    expect(word("S4", f)).toBe("2 items have more than 60 days of stock at this rate. Most: Hemex 5L label, about 214 days.");
  });
});

describe("copy guard on every stock card", () => {
  it("no ₹ and no phone numbers", () => {
    for (const [cid, f] of [["S1", s1Facts(orders, IN)], ["S2", s2Facts(IN)], ["S3", s3Facts(IN)], ["S4", s4Facts(IN)]] as const) {
      const t = copyText(cardById(cid)!, f, "2026-11-29");
      expect(t).not.toMatch(/₹|\d{10}/);
    }
  });
});

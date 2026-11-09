// Due per brand (Drop Home, decision D3) and which product a line is (src/lib/brand.ts lineMatcher).
import { describe, expect, it } from "vitest";
import { brandDues } from "@/lib/brand-due";
import { lineMatcher, sizeLabel, type BrandProduct } from "@/lib/brand";

const P: BrandProduct[] = [
  { id: "b1", name: "Bluemins 1L Water Bottle", sku_code: "PV_BM_1L", volume_ml: 1000, brand: "Bluemins" },
  { id: "b5", name: "Bluemins 500ml Water Bottle", sku_code: null, volume_ml: 500, brand: "Bluemins" },
  { id: "m1", name: "Mr.Charge 1 Litre Deionised Water", sku_code: null, volume_ml: 1000, brand: "Mr.Charge" },
  { id: "jar", name: "Bluemins Water - 20 Litre", sku_code: null, volume_ml: 20000, brand: "Bluemins 20L" },
  // two products that both lose their brand to the same name: never a guess
  { id: "x1", name: "Hemex Pack", sku_code: null, volume_ml: 1000, brand: "Hemex" },
  { id: "x2", name: "Acme Pack", sku_code: null, volume_ml: 1000, brand: "Acme" },
];

describe("which product a line is", () => {
  const of = lineMatcher(P);
  it("by its product link, its SKU code, its name, or its name without the brand in front", () => {
    expect(of({ sku_id: "m1", name: "anything" })?.id).toBe("m1");
    expect(of({ sku_id: null, sku_code: "pv_bm_1l", name: "Old name" })?.id).toBe("b1");
    expect(of({ sku_id: null, name: "Bluemins Water - 20 Litre" })?.id).toBe("jar");
    expect(of({ sku_id: null, name: "1L  water bottle" })?.id).toBe("b1");
    expect(of({ sku_id: null, name: "500ml Water Bottle" })?.id).toBe("b5");
    expect(of({ sku_id: null, name: "1 Litre Deionised Water" })?.id).toBe("m1");
  });
  it("nothing for an unknown name, an unknown link, or a name two products fit", () => {
    expect(of({ sku_id: null, name: "2L PV Empty Bottle" })).toBeNull();
    expect(of({ sku_id: "gone", name: "Bluemins 1L Water Bottle" })).toBeNull();
    expect(of({ sku_id: null, name: "Pack" })).toBeNull();
  });
  it("size labels", () => {
    expect([1000, 500, 250, 1500, 20000].map(sizeLabel)).toEqual(["1L", "500ml", "250ml", "1.5L", "20L"]);
  });
});

const R = (rupees: number) => BigInt(Math.round(rupees * 100));

describe("due per brand", () => {
  it("a bill with only one brand's lines is all that brand; paid bills count nothing", () => {
    const d = brandDues(
      [
        { due: R(1200), lines: [{ brand: "Bluemins", value: R(1000) }, { brand: "Bluemins", value: R(200) }] },
        { due: 0n, lines: [{ brand: "Mr.Charge", value: R(500) }] },
        { due: R(-5), lines: [{ brand: "Mr.Charge", value: R(500) }] },
      ],
      "Bluemins",
    );
    expect([...d]).toEqual([["bluemins", R(1200)]]);
  });

  it("a two-brand bill part-paid is split by the brands' line values; 20 L (own brand) and no brand apart", () => {
    // ₹1,100 billed: Bluemins 500, Mr.Charge 300, Bluemins 20L 200, empties (no brand) 100; ₹550 still due
    const d = brandDues(
      [
        {
          due: R(550),
          lines: [
            { brand: "Bluemins", value: R(500) },
            { brand: "Bluemins", value: 0n }, // a free line
            { brand: "Mr.Charge", value: R(300) },
            { brand: "Bluemins 20L", value: R(200) },
            { brand: "", value: R(100) },
          ],
        },
      ],
      "Bluemins",
    );
    expect(d.get("bluemins")).toBe(R(250));
    expect(d.get("mr.charge")).toBe(R(150));
    expect(d.get("bluemins 20l")).toBe(R(100));
    expect(d.get("")).toBe(R(50));
  });

  it("exact paise: the leftover goes to the largest share, so the parts add up to the bill's due", () => {
    const d = brandDues([{ due: 100n, lines: [{ brand: "A", value: 1n }, { brand: "B", value: 1n }, { brand: "C", value: 1n }] }], "A");
    expect([d.get("a"), d.get("b"), d.get("c")]).toEqual([34n, 33n, 33n]);
    const e = brandDues([{ due: 1001n, lines: [{ brand: "A", value: 1n }, { brand: "B", value: 2n }] }], "A");
    expect([e.get("a"), e.get("b")]).toEqual([333n, 668n]);
  });

  it("a bill without lines (a Zoho opening balance) counts to the main brand", () => {
    const d = brandDues([{ due: R(200), lines: [] }, { due: R(10), lines: [{ brand: "Bluemins", value: 0n }] }], "Bluemins");
    expect(d.get("bluemins")).toBe(R(210));
  });

  it("all brands together = the sum of the bills' dues", () => {
    const bills = [
      { due: 33_333n, lines: [{ brand: "Bluemins", value: 7n }, { brand: "Mr.Charge", value: 5n }, { brand: "", value: 3n }] },
      { due: 999n, lines: [{ brand: "Hemex", value: 2n }, { brand: "Mr.Charge", value: 9n }] },
      { due: 12_345n, lines: [] },
    ];
    const d = brandDues(bills, "Bluemins");
    expect([...d.values()].reduce((a, b) => a + b, 0n)).toBe(33_333n + 999n + 12_345n);
  });
});

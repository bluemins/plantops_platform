// Money in whole paise: exact totals with decimals, and how amounts are shown.
import { describe, expect, it } from "vitest";
import { fromPaise, isRate, lineTotal, money, toPaise, unitsText } from "@/lib/money";
import { formatRef } from "@/lib/ref";

describe("paise", () => {
  it("reads rupee text exactly", () => {
    expect([toPaise("90"), toPaise("92.5"), toPaise("92.50"), toPaise("0.05"), toPaise(" 140 ")]).toEqual([9000n, 9250n, 9250n, 5n, 14000n]);
    expect([fromPaise(51000n), fromPaise(9999n), fromPaise(5n), fromPaise(0n)]).toEqual(["510.00", "99.99", "0.05", "0.00"]);
  });

  it("totals with decimals come out exact", () => {
    expect(fromPaise(lineTotal(3, "33.33"))).toBe("99.99");
    expect(fromPaise(lineTotal(1, "90") + lineTotal(3, "140"))).toBe("510.00");
    expect(fromPaise(lineTotal(7, "0.1"))).toBe("0.70");
    // the largest line still fits the database (numeric(18, 2)) and stays exact
    expect(fromPaise(lineTotal(100_000, "99999999.99"))).toBe("9999999999000.00");
  });

  it("only rates of rupees with up to 2 decimals are usable", () => {
    expect(["90", "92.5", "0", "99999999.99"].map(isRate)).toEqual([true, true, true, true]);
    expect(["", "-1", "1.234", "abc", "1,000", "100000000"].map(isRate)).toEqual([false, false, false, false, false, false]);
  });
});

describe("shown to people", () => {
  it("₹ with Indian grouping, paise only when there are some", () => {
    expect([money("510.00"), money("99.99"), money(12500000n), money("1250.50")]).toEqual(["₹510", "₹99.99", "₹1,25,000", "₹1,250.50"]);
  });

  it("quantities added up per unit", () => {
    expect(unitsText([{ quantity: 1, unit: "box" }, { quantity: 3, unit: "box" }])).toBe("4 box");
    expect(unitsText([{ quantity: 3, unit: "box" }, { quantity: 6, unit: "jar" }, { quantity: 0, unit: "can" }])).toBe("3 box + 6 jar");
  });

  it("references are O-0001 …", () => {
    expect([formatRef(1), formatRef(42), formatRef(10000)]).toEqual(["O-0001", "O-0042", "O-10000"]);
  });
});

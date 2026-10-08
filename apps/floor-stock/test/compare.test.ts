// The arithmetic behind Sold / Used / received and "below the limit" (pure functions, no database).
import { describe, expect, it } from "vitest";
import { compare, comparisonText, isLow, sum } from "@/lib/compare";
import { addDays, istDay } from "@/lib/days";

const base = { previousCounted: true, previous: { qty: 100, unit: "box" }, production: 0, closing: 100, unit: "box" };

describe("Sold (finished goods) = previous closing + production − closing", () => {
  it("works it out", () => {
    expect(compare({ ...base, finished: true, production: 50, closing: 120 })).toEqual({ kind: "sold", value: 30 });
    expect(compare({ ...base, finished: true, production: 0, closing: 100 })).toEqual({ kind: "sold", value: 0 });
  });
  it("a negative result says 'check the count'", () => {
    expect(compare({ ...base, finished: true, production: 10, closing: 115 })).toEqual({ kind: "check", value: 5 });
  });
  it("is exact with decimals", () => {
    expect(compare({ ...base, finished: true, previous: { qty: 0.3, unit: "box" }, production: 0.1, closing: 0.2 })).toEqual({ kind: "sold", value: 0.2 });
    expect(sum([0.1, 0.2])).toBe(0.3);
  });
});

describe("Used (everything else) = previous − closing; a rise is 'received'", () => {
  it("works it out", () => {
    expect(compare({ ...base, finished: false, closing: 60 })).toEqual({ kind: "used", value: 40 });
    expect(compare({ ...base, finished: false, closing: 130.5 })).toEqual({ kind: "received", value: 30.5 });
  });
});

describe("when nothing can be compared", () => {
  it("no count the day before / item not in it / unit changed", () => {
    expect(compare({ ...base, finished: true, previousCounted: false })).toEqual({ kind: "no_previous_count" });
    expect(compare({ ...base, finished: false, previous: null })).toEqual({ kind: "new_item" });
    expect(compare({ ...base, finished: false, previous: { qty: 5, unit: "packet" } })).toEqual({ kind: "unit_changed", from: "packet", to: "box" });
    expect(compare({ ...base, finished: false, closing: 3, previous: { qty: 5, unit: " Box" } }).kind).toBe("used"); // same unit, other spelling
  });
  it("in plain words", () => {
    expect(comparisonText({ kind: "no_previous_count" }, "box", "7 Oct 2026")).toBe("—, no count on 7 Oct 2026");
    expect(comparisonText({ kind: "received", value: 2 }, "roll")).toBe("Received 2 roll (calculated)");
    expect(comparisonText({ kind: "unit_changed", from: "pcs", to: "box" }, "box")).toBe("Unit changed (pcs → box): not compared");
  });
});

describe("below the limit", () => {
  it("only strictly below; a blank limit never alerts", () => {
    expect(isLow(1.99, 2)).toBe(true);
    expect(isLow(2, 2)).toBe(false);
    expect(isLow(0, null)).toBe(false);
  });
});

describe("plant days are India days", () => {
  it("23:30 UTC is already the next day in India", () => {
    expect(istDay(new Date("2026-10-07T19:00:00Z"))).toBe("2026-10-08"); // 00:30 IST
    expect(istDay(new Date("2026-10-07T18:00:00Z"))).toBe("2026-10-07"); // 23:30 IST
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

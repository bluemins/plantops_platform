// Box totals (Drop Home, decisions 18.5, 20.3, D4): a hand-worked month, the 12-month rule, India month / year edges.
import { describe, expect, it } from "vitest";
import { boxTotals, type BoxLine } from "@/lib/box-totals";

const B = (date: string, size: "1L" | "500ml" | "250ml", qty: number, brand = "Bluemins"): BoxLine => ({ date, brand, size, ml: { "1L": 1000, "500ml": 500, "250ml": 250 }[size], qty });

describe("box totals", () => {
  it("a hand-worked month: this month, last month, this year against the same days last year", () => {
    const lines = [
      B("2026-11-02", "1L", 10), // a Zoho bill
      B("2026-11-07", "500ml", 5), // a PlantOps bill
      B("2026-11-07", "1L", 3, "Mr.Charge"), // other brands never count
      B("2026-11-07", "1L", 4, "Bluemins 20L"),
      B("2026-11-07", "1L", 2, "Hemex"),
      B("2026-11-08", "1L", 2), // a delivered order with no bill
      B("2026-11-10", "1L", 50), // after today: not yet
      B("2026-10-31", "1L", 7),
      B("2026-10-01", "250ml", 1.5),
      B("2026-04-01", "1L", 1),
      B("2026-03-31", "1L", 9), // last financial year
      B("2025-11-09", "1L", 4), // same day last year: counts
      B("2025-11-10", "1L", 100), // the day after: not
      B("2025-04-01", "500ml", 6),
    ];
    expect(boxTotals(lines, "bluemins", "2026-11-09")).toEqual({
      this_month: { total: 17, sizes: [{ size: "1L", boxes: 12 }, { size: "500ml", boxes: 5 }] },
      last_month: { total: 8.5, sizes: [{ size: "1L", boxes: 7 }, { size: "250ml", boxes: 1.5 }] },
      this_year: { total: 26.5, last_year_same_days: 10 },
    });
  });

  it("only for a shop that bought the brand in the last 12 months", () => {
    expect(boxTotals([B("2025-11-09", "1L", 4)], "Bluemins", "2026-11-09")).toBeNull();
    expect(boxTotals([B("2025-11-10", "1L", 4)], "Bluemins", "2026-11-09")).not.toBeNull();
    expect(boxTotals([B("2026-11-01", "1L", 4, "Mr.Charge")], "Bluemins", "2026-11-09")).toBeNull();
    expect(boxTotals([], "Bluemins", "2026-11-09")).toBeNull();
  });

  it("on 1 April the year starts again; 31 March is last month and last year", () => {
    const t = boxTotals([B("2026-03-31", "1L", 9), B("2026-04-01", "1L", 1), B("2025-04-01", "1L", 2)], "Bluemins", "2026-04-01")!;
    expect(t.this_month.total).toBe(1);
    expect(t.last_month.total).toBe(9);
    expect(t.this_year).toEqual({ total: 1, last_year_same_days: 2 });
  });

  it("on the 1st, this month is that one day and last month is the whole month before; 29 Feb compares with 28 Feb", () => {
    const t = boxTotals([B("2026-11-30", "1L", 3), B("2026-11-01", "1L", 2), B("2026-12-01", "500ml", 1)], "Bluemins", "2026-12-01")!;
    expect(t.this_month).toEqual({ total: 1, sizes: [{ size: "500ml", boxes: 1 }] });
    expect(t.last_month.total).toBe(5);
    const leap = boxTotals([B("2027-02-28", "1L", 1), B("2028-02-29", "1L", 2)], "Bluemins", "2028-02-29")!;
    expect(leap.this_year).toEqual({ total: 2, last_year_same_days: 1 });
    expect(leap.last_month.total).toBe(0);
  });
});

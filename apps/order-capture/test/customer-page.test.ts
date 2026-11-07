// Customer page Part 1 (docs/CUSTOMER_PAGE_PHASE_PLAN.md): the pure date / tab rules.
import { describe, expect, it } from "vitest";
import { monthEnd, pickTab, quickRanges, shiftMonths } from "@/lib/customer-page";

describe("customer page rules", () => {
  it("months move with the day kept, clamped to the month's end", () => {
    expect(shiftMonths("2026-11-07", -6)).toBe("2026-05-07");
    expect(shiftMonths("2026-08-31", -6)).toBe("2026-02-28");
    expect(shiftMonths("2027-01-15", -1)).toBe("2026-12-15");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });

  it("statement quick ranges: this month, previous month, this quarter", () => {
    expect(quickRanges("2026-11-07")).toEqual([
      { label: "This month", from: "2026-11-01", to: "2026-11-30" },
      { label: "Previous month", from: "2026-10-01", to: "2026-10-31" },
      { label: "This quarter", from: "2026-10-01", to: "2026-12-31" },
    ]);
    expect(quickRanges("2027-01-03")[1]).toEqual({ label: "Previous month", from: "2026-12-01", to: "2026-12-31" });
    expect(quickRanges("2027-01-03")[2]).toEqual({ label: "This quarter", from: "2027-01-01", to: "2027-03-31" });
  });

  it("tabs: Overview by default; the old Bills / Payments links open Transactions", () => {
    expect(pickTab("")).toBe("overview");
    expect(pickTab("bills")).toBe("transactions");
    expect(pickTab("payments")).toBe("transactions");
    expect(pickTab("statement")).toBe("statement");
    expect(pickTab("nonsense")).toBe("overview");
  });
});

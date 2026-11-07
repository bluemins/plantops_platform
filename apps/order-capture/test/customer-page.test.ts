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

import { billToAddress, billToParts, isShortMapLink, parseMapPosition } from "@/lib/customer-page";

describe("Part 2 rules", () => {
  it("reads a position from what the owner pastes", () => {
    expect(parseMapPosition("21.0234, 83.7841")).toEqual({ lat: 21.0234, lng: 83.7841 });
    expect(parseMapPosition("21.0234 83.7841")).toEqual({ lat: 21.0234, lng: 83.7841 });
    expect(parseMapPosition("https://www.google.com/maps?q=21.1,83.2")).toEqual({ lat: 21.1, lng: 83.2 });
    expect(parseMapPosition("https://www.google.com/maps/search/?api=1&query=21.1%2C83.2")).toEqual({ lat: 21.1, lng: 83.2 });
    expect(parseMapPosition("https://www.google.com/maps/@21.5,83.9,15z")).toEqual({ lat: 21.5, lng: 83.9 });
    // the place's own pin (!3d!4d) wins over the map's centre (@)
    expect(parseMapPosition("https://www.google.com/maps/place/X/@21.5,83.9,15z/data=!3d21.51!4d83.91")).toEqual({ lat: 21.51, lng: 83.91 });
    expect(parseMapPosition("0, 0")).toBeNull();
    expect(parseMapPosition("91, 83")).toBeNull();
    expect(parseMapPosition("https://maps.app.goo.gl/AbC123")).toBeNull();
    expect(isShortMapLink("https://maps.app.goo.gl/AbC123")).toBe(true);
    expect(isShortMapLink("https://evil.example/maps.app.goo.gl")).toBe(false);
    expect(isShortMapLink("http://maps.app.goo.gl/x")).toBe(false);
  });

  it("a GST bill's address: saved on lines, back to parts for Zoho", () => {
    const saved = billToAddress({ address: " Main Road, Ward 3 ", city: "Bargarh", pin: "768028" });
    expect(saved).toBe("Main Road, Ward 3\nBargarh\n768028");
    expect(billToParts(saved)).toEqual({ address: "Main Road, Ward 3", city: "Bargarh", pin: "768028" });
    expect(billToParts("Only a street")).toEqual({ address: "Only a street", city: "", pin: "" });
    expect(billToAddress({})).toBeNull();
    expect(billToParts(null)).toEqual({ address: "", city: "", pin: "" });
  });
});

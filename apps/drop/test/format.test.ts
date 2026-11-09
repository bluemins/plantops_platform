import { describe, expect, it } from "vitest";
import { day, longDay, mobile, month, num, rupees, waLink } from "../src/format";

describe("formatting", () => {
  it("rupees from paise, Indian grouping", () => {
    expect(rupees(1245000)).toBe("₹12,450");
    expect(rupees(1245050)).toBe("₹12,450.50");
    expect(rupees(0)).toBe("₹0");
  });
  it("boxes and dates", () => {
    expect(num(1050)).toBe("1,050");
    expect(num(2.5)).toBe("2.5");
    expect(day("2026-11-08")).toBe("8 Nov");
    expect(longDay("2028-01-31")).toBe("31 Jan 2028");
    expect(month("2026-11")).toBe("Nov 2026");
  });
  it("Indian mobile numbers as typed", () => {
    expect(mobile("+91 98765 43210")).toBe("9876543210");
    expect(mobile("09876543210")).toBe("9876543210");
    expect(mobile("12345")).toBeNull();
    expect(mobile("5876543210")).toBeNull();
    expect(waLink("94370 00111")).toBe("https://wa.me/919437000111");
  });
});

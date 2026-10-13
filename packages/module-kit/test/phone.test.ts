// The one Indian-mobile rule shared by Complaint Box and Order Capture.
import { describe, expect, it } from "vitest";
import { normalisePhone, phoneDisplay, telLink } from "../src/phone";

describe("normalisePhone", () => {
  it.each([
    ["9692905402", "9692905402"],
    ["+91 96929 05402", "9692905402"],
    ["096929 05402", "9692905402"],
    ["+91-98765-43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["98765.43210", "9876543210"],
    ["(+91) 6000012345", "6000012345"],
    [" 7000012345 ", "7000012345"],
  ])("%j -> %s", (typed, want) => {
    expect(normalisePhone(typed)).toBe(want);
  });

  it.each(["5876543210", "12345", "987654321", "98765432101", "+1 9876543210", "+91 5876543210", "9876abc210", "", "0091 9876543210", "9.18E+11"])(
    "%j is refused",
    (typed) => {
      expect(normalisePhone(typed)).toBeNull();
    },
  );
});

describe("showing a number", () => {
  it("groups it 5 + 5 and dials with +91; plain text for the support view", () => {
    expect(phoneDisplay("9876543210")).toEqual({ text: "98765 43210", href: "tel:+919876543210" });
    expect(phoneDisplay("9876543210", true)).toEqual({ text: "98765 43210", href: null });
    expect(telLink("6000012345")).toBe("tel:+916000012345");
  });
});

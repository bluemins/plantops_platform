// How old a pending order is (amber from 2 days), and the history in words (pure; no database).
import { describe, expect, it } from "vitest";
import { ageOf, eventText, priced, productsText, versionDiff, withoutAmounts, type LineView, type VersionView } from "@/lib/history";

const H = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-13T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H);

describe("age and the 2-day amber boundary", () => {
  it.each([
    [0, "Today", false],
    [23.99, "Today", false],
    [24, "1 day", false],
    [47 + 59 / 60, "1 day", false], // 1 day 23 h 59 min
    [48, "2 days", true], // exactly 2 days
    [72, "3 days", true],
  ])("%s hours old → %s, amber %s", (hours, text, amber) => {
    expect(ageOf(at(hours as number), NOW)).toMatchObject({ text, amber });
  });

  it("a clock slightly ahead never gives a negative age", () => {
    expect(ageOf(new Date(NOW + 5000), NOW)).toEqual({ days: 0, amber: false, text: "Today" });
  });
});

const line = (sku_id: string, product: string, quantity: number, rate: string, unit = "box"): LineView => ({ sku_id, product, unit, quantity, rate, total: (quantity * Number(rate)).toFixed(2) });
const v1 = [line("a", "500ml", 1, "90.00"), line("b", "1ltr", 2, "140.00")];

describe("what changed between versions", () => {
  it("quantity, rate, added and removed products, and the total", () => {
    expect(versionDiff(v1, [line("a", "500ml", 1, "90.00"), line("b", "1ltr", 3, "140.00")], "370.00", "510.00")).toBe("1ltr: 2 box → 3 box · total ₹370 → ₹510");
    expect(versionDiff(v1, [line("a", "500ml", 1, "95.00"), line("b", "1ltr", 2, "140.00")], "370.00", "375.00")).toBe("500ml: rate ₹90 → ₹95 · total ₹370 → ₹375");
    expect(versionDiff(v1, [...v1, line("c", "Jar", 6, "50.00", "jar")], "370.00", "670.00")).toBe("added Jar 6 jar at ₹50 · total ₹370 → ₹670");
    expect(versionDiff(v1, [v1[0]!], "370.00", "90.00")).toBe("removed 1ltr · total ₹370 → ₹90");
  });

  it("the list cards' product text", () => {
    expect(productsText([line("a", "500ml", 1, "90.00"), line("b", "1ltr", 3, "140.00")])).toBe("500ml 1 box, 1ltr 3 box");
  });
});

describe("history lines", () => {
  const versions: VersionView[] = [
    { version: 1, lines: v1, total: "370.00" },
    { version: 2, lines: [line("a", "500ml", 1, "90.00"), line("b", "1ltr", 3, "140.00")], total: "510.00" },
  ];
  const ev = (kind: "created" | "changed" | "delivered" | "undelivered" | "cancelled", version: number, text: string | null = null, invoice_no: string | null = null) => ({ kind, version, text, invoice_no, by: "Atharv", at: new Date(NOW).toISOString() });

  it.each([
    [ev("created", 1), "Created by Atharv", "2 products · ₹370"],
    [ev("changed", 2), "Changed by Atharv", "1ltr: 2 box → 3 box · total ₹370 → ₹510"],
    [ev("delivered", 2, "80 delivered, 20 next trip", "INV-000123"), "Delivered by Atharv", "80 delivered, 20 next trip · Zoho invoice INV-000123"],
    [ev("delivered", 2), "Delivered by Atharv", ""],
    [ev("undelivered", 2, "marked by mistake"), "Delivery undone by Atharv", "marked by mistake"],
    [ev("cancelled", 2, "customer changed mind"), "Cancelled by Atharv", "customer changed mind"],
  ])("%j", (e, title, detail) => {
    expect(eventText(e, versions)).toEqual({ title, detail });
  });
});

describe("without amounts (plant staff)", () => {
  const hidden: VersionView[] = [
    { version: 1, lines: withoutAmounts(v1), total: null },
    { version: 2, lines: withoutAmounts([line("a", "500ml", 1, "95.00"), line("b", "1ltr", 3, "140.00"), line("c", "Jar", 6, "50.00", "jar")]), total: null },
    { version: 3, lines: withoutAmounts([line("a", "500ml", 1, "99.00"), line("b", "1ltr", 3, "140.00"), line("c", "Jar", 6, "50.00", "jar")]), total: null },
  ];
  const ev = (kind: "created" | "changed", version: number) => ({ kind, version, text: null, invoice_no: null, by: "Atharv", at: new Date(NOW).toISOString() });

  it("no rupee sign anywhere: quantities only; a rate-only change just says the version", () => {
    expect(withoutAmounts(v1).every((l) => l.rate === null && l.total === null)).toBe(true);
    expect(eventText(ev("created", 1), hidden)).toEqual({ title: "Created by Atharv", detail: "2 products" });
    expect(eventText(ev("changed", 2), hidden)).toEqual({ title: "Changed by Atharv", detail: "1ltr: 2 box → 3 box · added Jar 6 jar" });
    expect(eventText(ev("changed", 3), hidden)).toEqual({ title: "Changed by Atharv", detail: "version 3" });
  });

  it("the change screen never gets lines without amounts", () => {
    expect(priced(v1)).toEqual(v1);
    expect(() => priced(withoutAmounts(v1))).toThrow();
  });
});

// GST on bills (src/lib/ledger.ts billAmounts, dueFromTerms; docs/BILL_FIELDS_PHASE_PLAN.md). The owner's real Zoho
// invoice INV-001840 (L&T, GST on top) is the reference: 92 × ₹55 = ₹5,060 + CGST 2.5% ₹126.50 + SGST 2.5% ₹126.50 = ₹5,313.
import { describe, expect, it } from "vitest";
import { billAmounts, BillAmountError, dueFromTerms, paise, rupees, type BillLineIn } from "@/lib/ledger";

const line = (amount: string, gst_rate: number | null = 5, discount = "0"): BillLineIn => ({ amount: paise(amount), discount: paise(discount), gst_rate });
const r = (p: bigint | null) => (p === null ? null : rupees(p));

describe("bill amounts with GST", () => {
  it("the owner's L&T invoice: GST added on top, same state = CGST + SGST, total ₹5,313", () => {
    const b = billAmounts([line("5060")], 0n, 0n, { inclusive: false, intra: true });
    expect(r(b.sub_total)).toBe("5060.00");
    expect(r(b.taxable_total)).toBe("5060.00");
    expect([r(b.cgst), r(b.sgst), r(b.igst)]).toEqual(["126.50", "126.50", "0.00"]);
    expect(r(b.tax_total)).toBe("253.00");
    expect(r(b.total)).toBe("5313.00");
    expect(r(b.lines[0]!.taxable)).toBe("5060.00");
  });

  it("rates include GST (the plant's usual): ₹2,500 at 5% stays ₹2,500, GST worked out inside it", () => {
    const b = billAmounts([line("2500")], 0n, 0n, { inclusive: true, intra: true });
    expect(r(b.total)).toBe("2500.00");
    expect(r(b.taxable_total)).toBe("2380.95");
    expect([r(b.cgst), r(b.sgst)]).toEqual(["59.52", "59.53"]); // the odd paisa goes to SGST
    expect(b.taxable_total! + b.tax_total).toBe(paise("2500"));
  });

  it("another state's customer gets IGST, on top or inside", () => {
    const top = billAmounts([line("5060")], 0n, 0n, { inclusive: false, intra: false });
    expect([r(top.cgst), r(top.sgst), r(top.igst), r(top.total)]).toEqual(["0.00", "0.00", "253.00", "5313.00"]);
    const inside = billAmounts([line("2500")], 0n, 0n, { inclusive: true, intra: false });
    expect([r(inside.igst), r(inside.total)]).toEqual(["119.05", "2500.00"]);
  });

  it("a bill without GST: no tax, total = sub-total − discount + adjustment", () => {
    const b = billAmounts([line("2500", null), line("600", null)], paise("100"), paise("-0.40"), null);
    expect([r(b.sub_total), r(b.tax_total), r(b.total), b.taxable_total]).toEqual(["3100.00", "0.00", "2999.60", null]);
    expect(b.lines.every((l) => l.taxable === null)).toBe(true);
  });

  it("the bill's discount is shared over the lines before GST; every paisa is accounted for", () => {
    const b = billAmounts([line("1000"), line("2000", 18), line("333.33", 0)], paise("100"), 0n, { inclusive: false, intra: true });
    expect(r(b.taxable_total)).toBe("3233.33"); // 3333.33 − 100
    // shares 30.00 / 60.00 / 9.99 + the 1 paisa left over (the last line) = 100.00
    expect(b.lines.map((l) => r(l.taxable))).toEqual(["970.00", "1940.00", "323.33"]);
    expect(b.lines.map((l) => r(l.tax))).toEqual(["48.50", "349.20", "0.00"]);
    expect(r(b.total)).toBe(rupees(paise("3233.33") + b.tax_total));
  });

  it("a line's own discount comes off that line first", () => {
    const b = billAmounts([line("2500", 5, "100")], 0n, 0n, { inclusive: false, intra: true });
    expect([r(b.lines[0]!.amount), r(b.sub_total), r(b.total)]).toEqual(["2400.00", "2400.00", "2520.00"]);
  });

  it("refuses a GST bill when a product has no GST rate, and discounts or totals that don't make sense", () => {
    expect(() => billAmounts([line("100", null)], 0n, 0n, { inclusive: true, intra: true })).toThrow(/no GST rate/);
    expect(() => billAmounts([line("100")], paise("101"), 0n, null)).toThrow(BillAmountError);
    expect(() => billAmounts([line("100", 5, "101")], 0n, 0n, null)).toThrow(/more than the line/);
    expect(() => billAmounts([line("100")], 0n, paise("-101"), null)).toThrow(/below ₹0/);
  });
});

describe("terms → due date", () => {
  it.each([
    ["receipt", "2026-11-07"],
    ["net7", "2026-11-14"],
    ["net15", "2026-11-22"],
    ["net30", "2026-12-07"],
    ["eom", "2026-11-30"],
  ] as const)("%s from 7 Nov 2026 → %s", (terms, due) => {
    expect(dueFromTerms("2026-11-07", terms)).toBe(due);
  });
  it("crosses months and years; end of February", () => {
    expect(dueFromTerms("2026-12-20", "net30")).toBe("2027-01-19");
    expect(dueFromTerms("2028-02-10", "eom")).toBe("2028-02-29");
  });
});

// "Copy as WhatsApp message" on the Pending tab: the ticked orders as one delivery message (pure; no database).
import { describe, expect, it } from "vitest";
import { withoutAmounts, type LineView } from "@/lib/history";
import { whatsappText, type CopyOrder } from "@/lib/whatsapp";

const NOW = new Date("2026-10-14T05:00:00Z"); // 10:30 am IST
const line = (product: string, quantity: number, unit: string, rate: string): LineView => ({ sku_id: product, product, unit, quantity, rate, total: (quantity * Number(rate)).toFixed(2) });
const sai: CopyOrder = {
  ref: "O-0009",
  customer: "Hotel Sai Palace",
  phone: "9876543210",
  place: "Puri",
  note: "Deliver before 10 am",
  lines: [line("SampleAqua 1L", 10, "box", "120"), line("20 L jar", 5, "jar", "35")],
  total: "1375.00",
};
const leaf: CopyOrder = { ref: "O-0013", customer: "Green Leaf Restaurant", phone: "9937044556", place: "Puri", note: null, lines: [line("SampleAqua 500ml", 4, "box", "110.50")], total: "442.00" };
const hide = (o: CopyOrder): CopyOrder => ({ ...o, lines: withoutAmounts(o.lines), total: null });

describe("the WhatsApp message", () => {
  it("Order desk / owner: every ticked order with the rate per product, note and amount, no grand total", () => {
    expect(whatsappText([sai, leaf], NOW)).toBe(
      [
        "*Delivery – 14 Oct – 2 orders*",
        "*O-0009* · Hotel Sai Palace\n+91 98765 43210 · Puri\n- SampleAqua 1L: 10 box × ₹120\n- 20 L jar: 5 jar × ₹35\nNote: Deliver before 10 am\nAmount: ₹1,375",
        "*O-0013* · Green Leaf Restaurant\n+91 99370 44556 · Puri\n- SampleAqua 500ml: 4 box × ₹110.50\nAmount: ₹442",
        "*Total to load*\n- 20 L jar: 5 jar\n- SampleAqua 1L: 10 box\n- SampleAqua 500ml: 4 box",
      ].join("\n\n"),
    );
  });

  it("plant staff: the same orders with no rates and no amount, but the total to load", () => {
    const text = whatsappText([hide(sai), hide(leaf)], NOW);
    expect(text).not.toContain("₹");
    expect(text).not.toContain(" × ₹");
    expect(text).not.toContain("Amount");
    expect(text).toContain("- 20 L jar: 5 jar");
    expect(text.split("\n\n")).toHaveLength(4);
    expect(text.split("\n\n")[3]).toBe("*Total to load*\n- 20 L jar: 5 jar\n- SampleAqua 1L: 10 box\n- SampleAqua 500ml: 4 box");
  });

  it("total to load adds each product up over the ticked orders (the owner's 19 Oct example)", () => {
    const o = (ref: string, lines: LineView[]): CopyOrder => ({ ref, customer: ref, phone: "9876543210", place: "Bargarh", note: null, lines, total: null });
    const text = whatsappText(
      [
        o("O-0018", [line("Mr.Charge 2L (2 L × 9)", 1, "box", "144"), line("Mr.Charge 5L (5 L × 4)", 4, "box", "160")]),
        o("O-0029", [line("Mr.Charge 5L (5 L × 4)", 10, "box", "200"), line("Mr.Charge 2L (2 L × 9)", 3, "box", "180"), line("Mr.Charge 1L (1 L × 12)", 3, "box", "120")]),
        o("O-0032", [line("Bluemins 1L (1 L × 12)", 100, "box", "85")]),
      ],
      NOW,
    );
    expect(text.split("\n\n").at(-1)).toBe(
      "*Total to load*\n- Bluemins 1L (1 L × 12): 100 box\n- Mr.Charge 1L (1 L × 12): 3 box\n- Mr.Charge 2L (2 L × 9): 4 box\n- Mr.Charge 5L (5 L × 4): 14 box",
    );
  });

  it("total to load: a product whose unit changed between orders gets a line per unit", () => {
    const a: CopyOrder = { ...leaf, lines: [line("20 L jar", 5, "jar", "35")] };
    const b: CopyOrder = { ...leaf, ref: "O-0014", lines: [line("20 L jar", 2, "piece", "35")] };
    expect(whatsappText([a, b], NOW).split("\n\n").at(-1)).toBe("*Total to load*\n- 20 L jar: 5 jar\n- 20 L jar: 2 piece");
  });

  it("one order says 'order'; the date is India's (late evening UTC is already the next day)", () => {
    expect(whatsappText([leaf], new Date("2026-10-14T19:00:00Z")).split("\n")[0]).toBe("*Delivery – 15 Oct – 1 order*");
  });
});

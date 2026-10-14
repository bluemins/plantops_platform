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
  it("Order desk / owner: every ticked order with its amount, then the total", () => {
    expect(whatsappText([sai, leaf], NOW)).toBe(
      [
        "*Delivery – 14 Oct – 2 orders*",
        "*O-0009* · Hotel Sai Palace\n+91 98765 43210 · Puri\n- SampleAqua 1L: 10 box\n- 20 L jar: 5 jar\nNote: Deliver before 10 am\nAmount: ₹1,375",
        "*O-0013* · Green Leaf Restaurant\n+91 99370 44556 · Puri\n- SampleAqua 500ml: 4 box\nAmount: ₹442",
        "*Total: ₹1,817*",
      ].join("\n\n"),
    );
  });

  it("plant staff: the same orders with no amount and no total", () => {
    const text = whatsappText([hide(sai), hide(leaf)], NOW);
    expect(text).not.toContain("₹");
    expect(text).not.toContain("Amount");
    expect(text).toContain("- 20 L jar: 5 jar");
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("one order says 'order'; the date is India's (late evening UTC is already the next day)", () => {
    expect(whatsappText([leaf], new Date("2026-10-14T19:00:00Z")).split("\n")[0]).toBe("*Delivery – 15 Oct – 1 order*");
  });
});

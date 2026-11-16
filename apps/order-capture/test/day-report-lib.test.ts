// Reports → Day report (owner 2026-11-16): the pure rules of src/lib/day-report.ts: the four headline numbers, "Needs
// you", the sections, a missing / switched-off module, and the evening notification's text (≤ 80 / ≤ 300).
import { describe, expect, it } from "vitest";
import { buildDayReport, dayNotificationText, dayWhatsappText, type DayFacts } from "@/lib/day-report";

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  date: "2026-11-16",
  newOrders: { count: 3, lines: [{ quantity: 20, unit: "box" }, { quantity: 10, unit: "box" }, { quantity: 4, unit: "jar" }], value: 512_000n },
  byBrand: [
    { brand: "Bluemins", orders: 2, lines: [{ quantity: 30, unit: "box" }] },
    { brand: "Bluemins 20L", orders: 1, lines: [{ quantity: 4, unit: "jar" }] },
  ],
  delivered: { count: 2, lines: [{ quantity: 25, unit: "box" }], notBilled: [41] },
  cancelled: [{ ref: 40, reason: "customer closed shop" }],
  pending: { count: 5, late: 2, oldestRef: 12, oldestDays: 4 },
  calls: { callers: 6, missed: 1, attended: 5, new_callers: 1 },
  bills: [{ number: "B-0101", total: 300_000n, gst: true }, { number: "B-0102", total: 150_050n, gst: false }],
  billsCancelled: [],
  gstWaiting: 1,
  payments: [
    { mode: "upi", customer: "Sahu Stores", amount: 850_000n },
    { mode: "cash", customer: "Ravi", amount: 120_000n },
  ],
  vans: [{ vehicle: "Mini", person: "Dillip", sales: 600_000n, notPaid: 80_000n, handedIn: 500_000n, difference: -15_000n, costs: 25_000n }],
  purchases: { bills: 1, total: 2_640_000n, paid: 1_500_000n },
  sales: 4_865_000n,
  salesWeekAgo: 4_245_000n,
  cash: {
    started: true,
    beforeStart: false,
    close: { counted: 2_387_000n, expected: 2_402_000n, difference: -15_000n, reason: "change given to van", by: "Anmol", at: "2026-11-16T14:12:00Z" },
    cashIn: 620_000n,
    cashOut: 346_000n,
    expenses: [{ type: "Diesel", amount: 210_000n }, { type: "Toll", amount: 16_000n }],
    advances: [{ person: "Ramu", amount: 100_000n }],
  },
  toPost: 4,
  owed: 11_248_000n,
  owedBefore: 9_503_000n,
  payables: 3_890_000n,
  ...over,
});
const stock = { id: "floor_stock", title: "Stock", state: "in" as const, part: { summary: "Counted 6:40 pm · 2 low", tone: "bad" as const, rows: [{ label: "Low", value: "Caps 2 box (limit 5)", tone: "bad" as const }], attention: ["2 stock items low: Caps, Label 1L"] } };
const o = { today: "2026-11-16", shortAlert: 10_000n };

describe("Day report", () => {
  it("headline numbers: sales vs the same weekday last week, money received split, delivered, what customers owe", () => {
    const r = buildDayReport(facts(), [], o);
    expect(r.isToday).toBe(true);
    expect(r.tiles.map((t) => [t.label, t.value, t.sub])).toEqual([
      ["Sales (bills + van)", "₹48,650", "▲ ₹6,200 vs last Mon"],
      ["Money received", "₹9,700", "Cash ₹1,200 · Online ₹8,500"],
      ["Delivered", "25 box", "2 orders"],
      ["Customers owe", "₹1,12,480", "▲ ₹17,450 since the day before"],
    ]);
    expect(r.tiles[3]!.tone).toBe("warn");
  });

  it("Needs you collects every section's points, in section order", () => {
    const r = buildDayReport(facts(), [stock], o);
    expect(r.attention.map((a) => [a.section, a.text])).toEqual([
      ["orders", "2 orders pending over 2 days (oldest O-0012, 4 days)"],
      ["bills", "1 order delivered with no bill yet"],
      ["bills", "1 GST invoice to make in Zoho"],
      ["cash", 'Cash box short ₹150. Reason: "change given to van"'],
      ["cash", "Van Mini: short ₹150 (Dillip)"],
      ["cash", "4 lines waiting in Cash → To post"],
      ["floor_stock", "2 stock items low: Caps, Label 1L"],
    ]);
  });

  it("orders section: brands, pending, cancelled with the reason, calls", () => {
    const s = buildDayReport(facts(), [], o).sections.find((x) => x.id === "orders")!.part!;
    expect(s.summary).toBe("3 new · 2 delivered · 5 pending");
    expect(s.rows).toContainEqual({ label: "New orders", value: "3 · 30 box + 4 jar · ₹5,120" });
    expect(s.rows).toContainEqual({ label: "  Bluemins 20L", value: "1 order · 4 jar" });
    expect(s.rows).toContainEqual({ label: "Cancelled", value: "O-0040: customer closed shop" });
    expect(s.rows).toContainEqual({ label: "Calls", value: "6 callers · 5 attended · 1 new · 1 missed rings" });
  });

  it("a small cash difference (under ₹100) is shown but doesn't need you; a day not closed does", () => {
    const small = buildDayReport(facts({ cash: { ...(facts().cash as Extract<DayFacts["cash"], { started: true }>), close: { counted: 100n, expected: 5_100n, difference: -5_000n, reason: null, by: "Anmol", at: "2026-11-16T14:00:00Z" } }, vans: [], toPost: 0 }), [], o);
    expect(small.attention.filter((a) => a.section === "cash")).toEqual([]);
    expect(small.sections.find((s) => s.id === "cash")!.part!.summary).toBe("Closed, short ₹50");
    const open = buildDayReport(facts({ cash: { ...(facts().cash as Extract<DayFacts["cash"], { started: true }>), close: null }, vans: [], toPost: 0 }), [], o);
    expect(open.attention.filter((a) => a.section === "cash").map((a) => a.text)).toEqual(["Cash book not closed yet today"]);
    const past = buildDayReport(facts({ date: "2026-11-10", cash: { ...(facts().cash as Extract<DayFacts["cash"], { started: true }>), close: null }, vans: [], toPost: 0 }), [], o);
    expect(past.isToday).toBe(false);
    expect(past.attention.filter((a) => a.section === "cash").map((a) => a.text)).toEqual(["Cash book not closed that day"]);
  });

  it("no cash book: one quiet line, nothing to act on", () => {
    const r = buildDayReport(facts({ cash: { started: false }, vans: [], toPost: 0 }), [], o);
    expect(r.sections.find((s) => s.id === "cash")!.part).toEqual({ summary: "Cash book not started", rows: [], attention: [] });
  });

  it("a module that's switched off is left out; one that didn't answer is shown as missing and needs you", () => {
    const r = buildDayReport(facts(), [{ id: "floor_stock", title: "Stock", state: "unreachable" }, { id: "job_applications", title: "Job applications", state: "off" }], o);
    expect(r.sections.map((s) => s.id)).toEqual(["orders", "bills", "cash", "purchases", "floor_stock"]);
    expect(r.sections.at(-1)!.part).toBeUndefined();
    expect(r.attention.at(-1)).toEqual({ text: "Stock didn't answer: its numbers are missing", section: "floor_stock" });
  });

  it("payables only for today (a past day shows no 'owe vendors now')", () => {
    const rows = (p: bigint | null) => buildDayReport(facts({ payables: p }), [], o).sections.find((s) => s.id === "purchases")!.part!.rows.map((x) => x.label);
    expect(rows(3_890_000n)).toContain("You owe vendors (now)");
    expect(rows(null)).not.toContain("You owe vendors (now)");
  });

  it("the notification fits (title ≤ 80, body ≤ 300) and the WhatsApp text has every section", () => {
    const r = buildDayReport(facts(), [stock], o);
    const n = dayNotificationText(r);
    expect(n).toEqual({ title: "Day report · Mon 16 Nov", body: "Sales ₹48,650 · Received ₹9,700 · Cash: closed, short ₹150 · 7 things need you" });
    const quiet = dayNotificationText(buildDayReport(facts({ pending: { count: 0, late: 0, oldestRef: null, oldestDays: null }, delivered: { count: 0, lines: [], notBilled: [] }, gstWaiting: 0, cash: { started: false }, vans: [], toPost: 0 }), [], o));
    expect(quiet.body).toBe("Sales ₹48,650 · Received ₹9,700 · Nothing needs you");
    const long = dayNotificationText(buildDayReport(facts(), Array.from({ length: 4 }, (_, i) => ({ ...stock, id: `m${i}`, part: { ...stock.part, attention: ["x".repeat(200)] } })), o));
    expect(long.body.length).toBeLessThanOrEqual(300);
    const wa = dayWhatsappText(r);
    expect(wa).toContain("*Day report · Monday 16 Nov 2026*");
    expect(wa).toContain("Stock: Counted 6:40 pm · 2 low");
    expect(wa).toContain("• 2 stock items low: Caps, Label 1L");
  });
});

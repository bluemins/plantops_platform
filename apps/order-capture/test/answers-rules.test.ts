// Plant answers Phases 2–3, the rules alone (no database): M1 "paying slower" is the customer page's rule, M3's week
// starts on Monday and waiting collections stay out of the total, M4's marks, M5's days compared (1st–3rd: last month),
// M6 counted vs expected, O1's stock, O2 / O3 from Buying & paying, O4's spellings and look-alikes.
import { describe, expect, it } from "vitest";
import { cardById } from "@/lib/answers/cards";
import { copyText } from "@/lib/answers/copy";
import { m1Facts, m3Facts, m4Facts, m5Periods, m6Facts, mondayOf, type M4Close, type M4Entry, type PayBill } from "@/lib/answers/money-cards";
import { o1Facts, o2Facts, o3Choices, o3Facts, o4Facts, type CustomerBuying, type O1Order } from "@/lib/answers/order-cards";
import { word } from "@/lib/answers/word";
import { customerInsights, type InsightLine, type InsightSettle } from "@/lib/customer-insights";
import type { RecData } from "@/lib/receivables";

const TODAY = "2026-11-28"; // a Saturday
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("M1: paying slower", () => {
  // 3 older bills paid in 5 days, the last 3 paid in 30: the customer page calls that "slower"
  const bills: PayBill[] = Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, customer_key: "c:a", bill_date: addDays(TODAY, -200 + i * 30), due_date: null, total: 100_00n, cancelled: false, opening: false }));
  const settles: InsightSettle[] = bills.map((b, i) => ({ bill_id: b.id, amount: 100_00n, on: addDays(b.bill_date, i < 3 ? 5 : 30) }));
  const rec: RecData = { bills: [{ id: "x", number: "B-0009", customer_key: "c:a", customer_name: "Sahoo Stores", href: "/customers/a", place: "Jatni", bill_date: addDays(TODAY, -10), due_date: null, total: 500_00n, salesperson: null, vehicle: null }], payments: [], settles: [] };
  it("tagged with the customer page's numbers, and listed even when they don't owe the most", () => {
    const f = m1Facts(rec, new Map([["c:a", "9000000001"]]), { bills, settles }, TODAY);
    const ins = customerInsights({ bills, settles, billLines: new Map(), unbilledOrders: [], today: TODAY });
    expect(ins.trend).toMatchObject({ kind: "slower" });
    expect(f.rows[0]).toMatchObject({ customer: "Sahoo Stores", due: 500_00n, oldest_days: 10, slower_days: ins.trend!.recent_days, usual_days: ins.paying!.avg_days });
    expect(f.lists!.slower).toEqual([{ key: "c:a", href: "/customers/a", customer: "Sahoo Stores", place: "Jatni", recent_days: 30, usual_days: 5, due: 500_00n }]);
    expect(f.totals).toEqual({ owed: 500_00n, customers: 1, slower: 1 });
    const text = copyText(cardById("M1")!, f, TODAY);
    expect(text).not.toMatch(/₹|9000000001/);
    expect(text).toContain("Sahoo Stores · Jatni");
  });
});

describe("M3: this week", () => {
  const pay = (date: string, mode: string, amount: bigint) => ({ date, mode, customer: "Shop", amount });
  it("Monday to today; last week's same days; cash / online; collections to post kept apart", () => {
    expect(mondayOf(TODAY)).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    const f = m3Facts({
      payments: [pay("2026-11-23", "cash", 1000_00n), pay("2026-11-28", "upi", 500_00n), pay("2026-11-16", "cash", 800_00n), pay("2026-11-22", "cash", 9_999_00n)],
      vans: [{ date: "2026-11-25", cash: 200_00n }],
      toPost: { count: 2, amount: 340_00n },
      today: TODAY,
    });
    expect(f.totals).toMatchObject({ total: 1700_00n, cash: 1000_00n, online: 500_00n, van: 200_00n, last_week: 800_00n, change_pct: 113, to_post: 340_00n });
    expect(f.lists!.days!.map((d) => d.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat (so far)"]);
    expect(word("M3", f)).toBe("₹1,700 came in this week: ₹1,200 cash (van included), ₹500 online. The same days last week: ₹800 (up 113 %). ₹340 collected is still waiting in To post.");
    expect(copyText(cardById("M3")!, f, TODAY)).not.toMatch(/₹|Shop/);
  });
});

describe("M4: where to look", () => {
  const close = (cash_date: string, counted: bigint, expected: bigint, at: string): M4Close => ({ cash_date, counted, expected, difference: counted - expected, reason: null, by: "Anmol", at, opening: false });
  const entry = (ref: string, o: Partial<M4Entry>): M4Entry => ({ ref, cash_date: "2026-11-27", work_date: "2026-11-27", kind: "expense", direction: "out", amount: 100_00n, category: "Tea / tiffin", vehicle: null, person: null, purpose: null, by: "Bindu", at: "2026-11-27T05:00:00Z", cancelled_at: null, van_difference: null, ...o });
  const closes = [close("2026-11-26", 14_050_00n, 14_050_00n, "2026-11-26T15:00:00Z"), close("2026-11-27", 16_200_00n, 16_800_00n, "2026-11-27T15:40:00Z")];
  it("entries between the two closes, biggest first, with their marks; cancelled before the close left out", () => {
    const f = m4Facts(closes, [
      entry("C-0412", { kind: "van", direction: "in", amount: 5200_00n, vehicle: "Mini", van_difference: -200_00n }),
      entry("C-0409", { category: "Diesel", amount: 2400_00n }),
      entry("C-0415", { kind: "staff_out", amount: 2000_00n, person: "Ramu", purpose: "plant" }),
      entry("C-0418", { kind: "collection", direction: "in", amount: 1150_00n, work_date: "2026-11-25" }),
      entry("C-0420", { amount: 400_00n, cancelled_at: "2026-11-27T16:10:00Z" }),
      entry("C-0421", { amount: 50_00n, cancelled_at: "2026-11-27T10:00:00Z" }),
      entry("C-0300", { cash_date: "2026-11-26", amount: 900_00n }),
    ], TODAY);
    expect(f.totals).toMatchObject({ state: "Short", difference: -600_00n, days_open: 0 });
    expect(f.rows.map((r) => [r.ref, r.marks])).toEqual([
      ["C-0412", "Van short"],
      ["C-0409", "₹2,000 or more"],
      ["C-0415", "₹2,000 or more · Staff cash"],
      ["C-0418", "For an earlier day (25-11-2026)"],
      ["C-0420", "Cancelled after the close"],
    ]);
    expect(f.rows[0]!.what).toBe("Van report, Mini");
    expect(word("M4", f)).toBe("Cash was short ₹600 at the close on 27-11-2026 (counted ₹16,200, expected ₹16,800). Look first at the 5 marked entries below.");
  });
  it("matched, not closed for days, or not started: said plainly", () => {
    const ok = [closes[0]!, close("2026-11-25", 1_00n, 1_00n, "2026-11-25T15:00:00Z")];
    expect(word("M4", m4Facts(ok, [], TODAY))).toBe("Cash matched at the last close (26-11-2026). The day has not been closed since 26-11-2026.");
    expect(word("M4", m4Facts([], [], TODAY))).toBe("The cash book is not started yet, so there is nothing to check.");
  });
});

describe("M5 and M6", () => {
  it("M5: this month so far against the same days of last month; on the 1st–3rd, last month against the month before", () => {
    expect(m5Periods(TODAY)).toEqual({ now: { from: "2026-11-01", to: TODAY }, before: { from: "2026-10-01", to: "2026-10-28" }, fullMonth: false });
    expect(m5Periods("2026-12-02")).toEqual({ now: { from: "2026-11-01", to: "2026-11-30" }, before: { from: "2026-10-01", to: "2026-10-31" }, fullMonth: true });
    expect(m5Periods("2027-03-30").before).toEqual({ from: "2027-02-01", to: "2027-02-28" }); // February is shorter
  });
  it("M6: counted after the close, expected before it, with who counted last", () => {
    const sales = { today: 42_300_00n, weekAgo: 38_900_00n, bills: 9, vans: 1, notBilled: 3 };
    const open = m6Facts({ started: true, today: null, last: { date: "2026-11-27", counted: 16_200_00n, by: "Anmol", at: "2026-11-27T15:40:00Z" }, expected: 18_450_00n, in: 4_750_00n, out: 2_500_00n }, sales, TODAY);
    expect(open.totals).toMatchObject({ cash: 18_450_00n, cash_state: "Expected", last_count: 16_200_00n, change: 3_400_00n });
    expect(open.notes!.last_count).toBe("Counted at the close of 27-11-2026, 9:10 pm, by Anmol.");
    expect(word("M6", open)).toBe("Cash in the box: about ₹18,450 (expected, not counted yet today). Sold today so far: ₹42,300 from 9 bills and 1 van report, ₹3,400 more than a week ago.");
    const closed = m6Facts({ started: true, today: { counted: 18_300_00n, by: "Anmol", at: "2026-11-28T15:35:00Z", expected: 18_450_00n }, last: null, expected: 18_450_00n, in: 0n, out: 0n }, sales, TODAY);
    expect(closed.totals).toMatchObject({ cash: 18_300_00n, cash_state: "Counted" });
    expect(closed.totals.last_count).toBeUndefined();
  });
});

describe("O1: stock for pending orders", () => {
  const order = (id: string, hoursAgo: number, qty: number, sku = "s1"): O1Order => ({
    id, ref: `O-${id}`, customer: `Shop ${id}`, customer_href: `/customers/${id}`, place: "Jatni", phone: null,
    created_at: new Date(Date.parse("2026-11-28T06:00:00Z") - hoursAgo * 3_600_000).toISOString(), lines: [{ sku_id: sku, name: `P ${sku}`, unit: "box", quantity: qty }],
  });
  const now = new Date("2026-11-28T06:00:00Z");
  it("48 hours or more is late; the stock table adds up every pending order; units must match", () => {
    const orders = [order("1", 96, 20), order("2", 50, 10, "s2"), order("3", 47, 10), order("4", 60, 5, "s3")];
    const f = o1Facts(orders, { state: "in", levels: { counted_on: "2026-11-27", counted_at: null, items: [{ sku_id: "s1", name: "P s1", unit: "box", closing: 6 }, { sku_id: "s2", name: "P s2", unit: "Box", closing: 40 }, { sku_id: "s3", name: "P s3", unit: "jar", closing: 9 }] } }, now);
    expect(f.totals).toEqual({ late: 3, pending: 4, stock_on: "2026-11-27" });
    expect(f.rows.map((r) => [r.ref, r.days, r.stock])).toEqual([["O-1", 4, "Short: P s1 (6 in stock)"], ["O-4", 2, "Not counted: P s3"], ["O-2", 2, "Stock there"]]);
    expect(f.lists!.stock).toEqual([
      { product: "P s1", needed: 30, in_stock: 6, short: "24" },
      { product: "P s2", needed: 10, in_stock: 40, short: "—" },
      { product: "P s3", needed: 5, in_stock: null, short: "Counted in jar" },
    ]);
    expect(word("O1", f)).toBe("3 orders have waited 2 days or more. Oldest: O-1 for Shop 1, 4 days. Short for all pending orders: P s1 by 24.");
  });
  it("Floor Stock off or not answering: the orders still listed, stock not checked", () => {
    const f = o1Facts([order("1", 96, 20)], { state: "unreachable" }, now);
    expect(f.rows[0]!.stock).toBe("Stock not checked");
    expect(f.totals.stock_on).toBeNull();
  });
});

describe("O2, O3: from Buying & paying", () => {
  const A: InsightLine = { key: "a", name: "Bluemins 1L", unit: "box", quantity: 10 };
  const B: InsightLine = { key: "b", name: "Bluemins 500ml", unit: "box", quantity: 5 };
  // 9 orders every 6 days, the last 3 without 500 ml; the last one 20 days ago
  const purchases = Array.from({ length: 9 }, (_, i) => ({ date: addDays(TODAY, -20 - (8 - i) * 6), lines: i >= 6 ? [A] : [A, B] }));
  const shop = (key: string, name: string): CustomerBuying => ({
    key, href: `/customers/${key}`, customer: name, place: "Pipili", phone: "9000000009", pending: null,
    ins: customerInsights({ bills: [], settles: [], billLines: new Map(), unbilledOrders: purchases, today: TODAY }),
  });
  it("O2: late with their usual gap; O3: stopped 500 ml, still buying 1 L", () => {
    const list = [shop("c:1", "Jena Kirana")];
    const o2 = o2Facts(list);
    expect(o2.rows[0]).toMatchObject({ customer: "Jena Kirana", usual_gap: 6, since_last: 20, days_late: 14, basket: "Bluemins 1L × 10 box" });
    expect(word("O2", o2)).toBe("1 regular customer is late with their next order. Jena Kirana usually orders every 6 days and hasn't for 20 days.");
    expect(o3Choices(list)).toEqual([{ key: "b", name: "Bluemins 500ml", n: 1 }]);
    const o3 = o3Facts(list, { key: "b", name: "Bluemins 500ml" });
    expect(o3.totals).toEqual({ product: "Bluemins 500ml", stopped: 1, still_buying: 1, stopped_all: 0 });
    expect(o3.rows[0]).toMatchObject({ last_date: purchases[5]!.date, still_buys: "Bluemins 1L × 10 box" });
    for (const id of ["O2", "O3"]) expect(copyText(cardById(id)!, id === "O2" ? o2 : o3, TODAY)).not.toMatch(/₹|9000000009/);
  });
});

describe("O4: by place", () => {
  it("spellings of one place counted together; look-alikes listed; against the days just before", () => {
    const o = (date: string, customer_id: string, place: string, quantity = 10) => ({ date, customer_id, place, quantity });
    const f = o4Facts(
      [o("2026-11-05", "1", "Khurda"), o("2026-11-06", "2", " khurda"), o("2026-11-07", "3", "Jatani"), o("2026-11-08", "4", "Jatni", 5), o("2026-10-20", "1", "Khurda")],
      "this_month",
      TODAY,
    );
    expect(f.rows.map((r) => [r.place, r.orders, r.customers, r.quantity, r.vs_before])).toEqual([["Khurda", 2, 2, 20, "+1"], ["Jatani", 1, 1, 10, "+1"], ["Jatni", 1, 1, 5, "+1"]]);
    expect(f.lists!.lookalike).toEqual([{ places: "Jatani / Jatni", orders: 2 }]);
    expect(f.totals).toMatchObject({ orders: 4, places: 3, from: "2026-11-01", to: TODAY });
  });
});

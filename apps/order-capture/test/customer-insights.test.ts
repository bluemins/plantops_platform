// "Buying & paying" on a customer's page (v0.47.0): the pure rules in src/lib/customer-insights.ts.
import { describe, expect, it } from "vitest";
import { addDays, customerInsights, fyLabel, fyOf, paidOn, type InsightBill, type InsightLine, type InsightsInput } from "@/lib/customer-insights";

const TODAY = "2026-11-07";
let n = 0;
const bill = (bill_date: string, rupees: number, more: Partial<InsightBill> = {}): InsightBill => ({
  id: `b${++n}`,
  bill_date,
  due_date: bill_date,
  total: BigInt(rupees * 100),
  cancelled: false,
  opening: false,
  ...more,
});
const jar = (q: number): InsightLine => ({ key: "jar", name: "20 L jar", unit: "jar", quantity: q });
const box1l = (q: number): InsightLine => ({ key: "1l", name: "Bluemins 1L", unit: "box", quantity: q });
const box500 = (q: number): InsightLine => ({ key: "500", name: "Bluemins 500ml", unit: "box", quantity: q });

/** bills each paid in full `days` later */
function paidBills(dates: [string, number][], days: number[], lines?: InsightLine[][]): Omit<InsightsInput, "today"> {
  const bills = dates.map(([d, r]) => bill(d, r));
  return {
    bills,
    settles: bills.map((b, i) => ({ bill_id: b.id, amount: b.total, on: addDays(b.bill_date, days[i]!) })),
    billLines: new Map(lines ? bills.map((b, i) => [b.id, lines[i]!]) : []),
    unbilledOrders: [],
  };
}

describe("paid on", () => {
  it("is the date the payments first reach the total, and moves when one is undone", () => {
    const b = bill("2026-10-01", 500);
    expect(paidOn(b, [{ bill_id: b.id, amount: 20000n, on: "2026-10-05" }])).toBeNull();
    const two = [
      { bill_id: b.id, amount: 20000n, on: "2026-10-05" },
      { bill_id: b.id, amount: 30000n, on: "2026-10-20" },
    ];
    expect(paidOn(b, two)).toBe("2026-10-20");
    // the second payment cancelled on 25 Oct, paid again on 2 Nov
    const undone = [...two, { bill_id: b.id, amount: -30000n, on: "2026-10-25" }];
    expect(paidOn(b, undone)).toBeNull();
    expect(paidOn(b, [...undone, { bill_id: b.id, amount: 30000n, on: "2026-11-02" }])).toBe("2026-11-02");
  });
});

describe("paying", () => {
  it("averages days to pay over the last 12 months, with the usual upper end and late bills", () => {
    const f = paidBills([["2026-06-01", 100], ["2026-07-01", 100], ["2026-08-01", 100], ["2026-09-01", 100], ["2026-10-01", 100]], [0, 10, 10, 20, 30]);
    f.bills[4]!.due_date = "2026-10-15"; // Net 15, paid 31 Oct: late
    const r = customerInsights({ ...f, today: TODAY });
    // the 1 Jun bill was paid on its due date: not late
    expect(r.paying).toEqual({ bills: 5, all_time: false, avg_days: 14, within_days: 20, late: 4, with_due_date: 5 });
  });

  it("leaves out cancelled bills, opening balances and ₹0 bills; an opening balance still counts as the oldest unpaid", () => {
    const f = paidBills([["2026-09-01", 100], ["2026-09-10", 100], ["2026-09-20", 100]], [5, 5, 5]);
    f.bills.push(bill("2026-08-01", 300, { cancelled: true }), bill("2026-04-01", 900, { opening: true }), bill("2026-09-30", 0));
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.paying).toMatchObject({ bills: 3, avg_days: 5 });
    expect(r.oldest_unpaid).toEqual({ bill_date: "2026-04-01", days: 220 });
    expect(r.ordering.purchases).toBe(3);
  });

  it("falls back to all time with fewer than 3 paid bills in 12 months; nothing when nothing is paid", () => {
    const f = paidBills([["2025-01-01", 100], ["2025-02-01", 100], ["2026-10-01", 100]], [3, 5, 7]);
    expect(customerInsights({ ...f, today: TODAY }).paying).toMatchObject({ bills: 3, all_time: true, avg_days: 5 });
    expect(customerInsights({ bills: [bill("2026-10-01", 100)], settles: [], billLines: new Map(), unbilledOrders: [], today: TODAY }).paying).toBeNull();
  });

  it("paying slower lately: last 3 bills against the others (an unpaid bill older than usual counts as slow)", () => {
    const f = paidBills(
      [["2026-04-01", 100], ["2026-05-01", 100], ["2026-06-01", 100], ["2026-07-01", 100], ["2026-08-01", 100], ["2026-09-01", 100]],
      [5, 5, 6, 30, 32, 28],
    );
    expect(customerInsights({ ...f, today: TODAY }).trend).toEqual({ kind: "slower", recent_days: 30, usual_days: 5 });
    // an unpaid bill from 1 Oct (37 days) is the latest of the last 3
    const g = paidBills([["2026-04-01", 100], ["2026-05-01", 100], ["2026-06-01", 100], ["2026-07-01", 100], ["2026-08-01", 100]], [5, 5, 6, 30, 32]);
    g.bills.push(bill("2026-10-01", 100));
    expect(customerInsights({ ...g, today: TODAY }).trend).toMatchObject({ kind: "slower", recent_days: 33 });
    const fast = paidBills(
      [["2026-04-01", 100], ["2026-05-01", 100], ["2026-06-01", 100], ["2026-07-01", 100], ["2026-08-01", 100], ["2026-09-01", 100]],
      [30, 25, 28, 2, 3, 1],
    );
    expect(customerInsights({ ...fast, today: TODAY }).trend).toEqual({ kind: "faster", recent_days: 2, usual_days: 28 });
    // a small change is not a trend
    const same = paidBills(
      [["2026-04-01", 100], ["2026-05-01", 100], ["2026-06-01", 100], ["2026-07-01", 100], ["2026-08-01", 100], ["2026-09-01", 100]],
      [10, 12, 11, 14, 15, 13],
    );
    expect(customerInsights({ ...same, today: TODAY }).trend).toBeNull();
  });
});

describe("ordering and the next order", () => {
  const weekly = (last: string, count: number) => Array.from({ length: count }, (_, i) => [addDays(last, -7 * (count - 1 - i)), 100] as [string, number]);

  it("needs 3 purchases; two bills on one day are one purchase", () => {
    const f = paidBills([["2026-10-20", 100], ["2026-10-20", 50], ["2026-10-27", 100]], [0, 0, 0]);
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.ordering).toEqual({ purchases: 2, last_date: "2026-10-27", days_since_last: 11, usual_gap: null });
    expect(r.next).toBeNull();
  });

  it("usual gap = the middle gap; expected = last + gap; due, late, stopped", () => {
    const f = paidBills(weekly("2026-11-03", 6), [0, 0, 0, 0, 0, 0]);
    const at = (today: string) => customerInsights({ ...f, today });
    expect(at("2026-11-07").ordering.usual_gap).toBe(7);
    expect(at("2026-11-07").next).toEqual({ expected: "2026-11-10", state: "ahead", days_late: 0 });
    expect(at("2026-11-10").next).toMatchObject({ state: "due", days_late: 0 });
    expect(at("2026-11-12").next).toMatchObject({ state: "due", days_late: 2 });
    expect(at("2026-11-13").next).toMatchObject({ state: "late", days_late: 3 });
    expect(at("2027-01-10").next).toMatchObject({ state: "stopped" });
  });

  it("one long break doesn't move the usual gap; an unbilled order counts as the latest purchase", () => {
    const f = paidBills([["2026-08-01", 1], ["2026-08-11", 1], ["2026-08-21", 1], ["2026-10-21", 1], ["2026-10-31", 1]], [0, 0, 0, 0, 0]);
    f.unbilledOrders = [{ date: "2026-11-06", lines: [] }];
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.ordering).toMatchObject({ purchases: 6, last_date: "2026-11-06", usual_gap: 10 });
    expect(r.next).toMatchObject({ expected: "2026-11-16", state: "ahead" });
  });
});

describe("usual order and stopped buying", () => {
  it("products in at least half of the last 5 purchases, with the middle quantity", () => {
    const dates: [string, number][] = [["2026-10-01", 1], ["2026-10-08", 1], ["2026-10-15", 1], ["2026-10-22", 1], ["2026-10-29", 1]];
    const f = paidBills(dates, [0, 0, 0, 0, 0], [[jar(30), box1l(5)], [jar(28)], [jar(30), box1l(4)], [jar(40), box500(2)], [jar(30), box1l(6)]]);
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.basket.map((b) => [b.name, b.quantity, b.unit, b.times, b.of])).toEqual([
      ["20 L jar", 30, "jar", 5, 5],
      ["Bluemins 1L", 5, "box", 3, 5],
    ]);
  });

  it("a product regular before the last 3 purchases and missing from them", () => {
    const dates = Array.from({ length: 8 }, (_, i) => [addDays("2026-09-01", 7 * i), 1] as [string, number]);
    const lines = [[jar(30), box500(2)], [jar(30), box500(2)], [jar(30)], [jar(30), box500(1)], [jar(30), box500(2)], [jar(30)], [jar(30)], [jar(30)]];
    const r = customerInsights({ ...paidBills(dates, dates.map(() => 0), lines), today: TODAY });
    expect(r.stopped).toEqual([{ key: "500", name: "Bluemins 500ml", last_date: "2026-09-29", times: 4, of: 5 }]);
    // fewer than 6 purchases: too early to say
    expect(customerInsights({ ...paidBills(dates.slice(0, 5), [0, 0, 0, 0, 0], lines.slice(0, 5)), today: TODAY }).stopped).toEqual([]);
  });
});

describe("financial year", () => {
  it("April to March; labels", () => {
    expect([fyOf("2026-03-31"), fyOf("2026-04-01"), fyOf("2027-01-15")]).toEqual([2025, 2026, 2026]);
    expect(fyLabel(2026)).toBe("FY 2026-27");
    expect(fyLabel(2099)).toBe("FY 2099-00");
  });

  it("bills per month for the chosen year and the year before, this year so far vs the same days last year", () => {
    const f = paidBills(
      [["2025-04-10", 100], ["2025-11-07", 200], ["2025-11-08", 999], ["2026-03-31", 50], ["2026-04-01", 300], ["2026-11-02", 120], ["2027-01-01", 1]],
      [0, 0, 0, 0, 0, 0, 0],
    );
    f.bills.push(bill("2026-05-05", 500, { cancelled: true }), bill("2026-04-01", 700, { opening: true }));
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.year.fy).toBe(2026);
    expect(r.year.fys).toEqual([2026, 2025]);
    expect(r.year.months.map(Number)).toEqual([30000, 0, 0, 0, 0, 0, 0, 12000, 0, 100, 0, 0]);
    expect(r.year.prev_months.map(Number)).toEqual([10000, 0, 0, 0, 0, 0, 0, 119900, 0, 0, 0, 5000]);
    // 1 Apr – 7 Nov 2026 = ₹420; 1 Apr – 7 Nov 2025 = ₹300 (the 8 Nov bill is after the same day)
    expect(r.year).toMatchObject({ ytd: 42000n, last_ytd: 30000n, change_pct: 40, customer_since: "2025-04-10" });
    expect(customerInsights({ ...f, today: TODAY, fy: 2025 }).year.fy).toBe(2025);
    expect(customerInsights({ ...f, today: TODAY, fy: 2019 }).year.fy).toBe(2026); // before the first bill: this year
  });

  it("nothing last year = no percent; average bill over the last 12 months", () => {
    const f = paidBills([["2026-05-01", 100], ["2026-06-01", 300]], [0, 0]);
    const r = customerInsights({ ...f, today: TODAY });
    expect(r.year).toMatchObject({ change_pct: null, avg_bill: 20000n, bills_12m: 2 });
  });
});

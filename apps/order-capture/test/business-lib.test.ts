// Business Overview + charts (docs/REPORTS_PHASE_PLAN.md section 9): the pure rules: periods, buckets, last year laid
// over this year, brands (colour follows the brand), expense groups and types, money in / out with its running total,
// orders per weekday, top customers, the overview's by-bill / by-payment switch, the axis scale.
import { describe, expect, it } from "vitest";
import {
  buildCharts,
  buildOverview,
  bucketsFor,
  chartDates,
  fitBy,
  niceScale,
  nextYear,
  running,
  shortRupees,
  topTypes,
  weekdayAverages,
  type ExpenseFact,
  type MoneyFact,
  type SaleFact,
} from "@/lib/business";

const sale = (over: Partial<SaleFact>): SaleFact => ({ date: "2026-10-05", before: 100_000n, with_gst: 105_000n, brand: "Bluemins", van: false, customer_key: "c:1", customer_name: "Jitu Dhaba", href: "/customers/1", ...over });
const exp = (over: Partial<ExpenseFact>): ExpenseFact => ({ date: "2026-10-05", group: "purchases", type: "Purchases: Preform", before: 50_000n, with_gst: 59_000n, ...over });

describe("periods and buckets", () => {
  it("last 12 months starts on the 1st, 11 months back; day / week fall back when too fine", () => {
    expect(chartDates("last_12", "2026-11-16")).toEqual({ from: "2025-12-01", to: "2026-11-16" });
    expect(chartDates("this_fy", "2026-11-16")).toEqual({ from: "2026-04-01", to: "2026-11-16" });
    expect(fitBy("day", "2026-11-01", "2026-11-16")).toBe("day");
    expect(fitBy("day", "2026-04-01", "2026-11-16")).toBe("week");
    expect(fitBy("day", "2025-04-01", "2026-11-16")).toBe("month");
    expect(fitBy("week", "2025-04-01", "2026-11-16")).toBe("month");
  });

  it("months cut to the period; weeks start on Monday; empty buckets kept", () => {
    expect(bucketsFor("2026-10-15", "2026-11-16", "month")).toEqual([
      { key: "2026-10", label: "Oct 26", axis: "Oct", from: "2026-10-15", to: "2026-10-31" },
      { key: "2026-11", label: "Nov 26", axis: "Nov", from: "2026-11-01", to: "2026-11-16" },
    ]);
    const weeks = bucketsFor("2026-11-04", "2026-11-16", "week"); // Wed 4 Nov … Mon 16 Nov
    expect(weeks.map((w) => [w.key, w.from, w.to])).toEqual([
      ["2026-11-02", "2026-11-04", "2026-11-08"],
      ["2026-11-09", "2026-11-09", "2026-11-15"],
      ["2026-11-16", "2026-11-16", "2026-11-16"],
    ]);
    expect(bucketsFor("2026-12-30", "2027-01-02", "day").map((d) => d.label)).toEqual(["30 Dec", "31 Dec", "1 Jan", "2 Jan"]);
    expect(nextYear("2024-02-29")).toBe("2025-03-01");
  });
});

describe("the charts", () => {
  const o = { from: "2026-10-01", to: "2026-11-16", by: "month" as const, brand: "", amount: "before" as const, recordsFrom: "2025-02-01" };
  const data = {
    sales: [
      sale({}),
      sale({ date: "2026-10-20", brand: "Mr.Charge", customer_key: "c:2", customer_name: "Sahu Store", before: 300_000n, with_gst: 315_000n }),
      sale({ date: "2026-11-02", brand: null, before: 20_000n, with_gst: 20_000n }),
      sale({ date: "2026-11-03", van: true, brand: null, customer_key: null, customer_name: "Van sales", before: 70_000n, with_gst: 70_000n }),
      sale({ date: "2026-09-30", before: 999_999n }), // before the period: left out
    ],
    lastYearSales: [sale({ date: "2025-10-10", before: 80_000n }), sale({ date: "2025-11-20", before: 1n })], // 20 Nov is after 16 Nov's bucket end
    expenses: [
      exp({}),
      exp({ date: "2026-11-01", group: "van", type: "Van: diesel", before: 20_000n, with_gst: 20_000n }),
      exp({ date: "2026-11-01", group: "other", type: "Repairs", before: 5_000n, with_gst: 5_000n }),
    ],
    money: [
      { date: "2026-10-10", dir: "in", amount: 200_000n },
      { date: "2026-10-11", dir: "out", amount: 150_000n },
      { date: "2026-11-05", dir: "out", amount: 100_000n },
    ] as MoneyFact[],
    orderDates: ["2026-11-02", "2026-11-09", "2026-11-09", "2026-11-14"],
  };

  it("sales by month, last year laid over, brands with van sales and no brand, top customers", () => {
    const c = buildCharts(data, o, []);
    expect(c.buckets.map((b) => b.key)).toEqual(["2026-10", "2026-11"]);
    expect(c.sales.total).toEqual([400_000n, 90_000n]);
    expect(c.sales.lastYear).toEqual([80_000n, 0n]);
    expect(c.sales.byBrand.map((s) => [s.name, s.values])).toEqual([
      ["Mr.Charge", [300_000n, 0n]],
      ["Bluemins", [100_000n, 0n]],
      ["No brand", [0n, 20_000n]],
      ["Van sales", [0n, 70_000n]],
    ]);
    expect(c.sales.brands).toEqual(["Bluemins", "Mr.Charge"]);
    expect(c.topCustomers.rows.map((r) => [r.label, r.amount])).toEqual([["Sahu Store", 300_000n], ["Jitu Dhaba", 120_000n]]);
    expect(c.topCustomers.share).toBeCloseTo(85.7, 1); // 4,200 of 4,900 (van sales have no customer)
    expect(c.totals).toMatchObject({ sales: 490_000n, lastYear: 80_000n, expenses: 75_000n, moneyIn: 200_000n, moneyOut: 250_000n });
  });

  it("no last-year comparison when the plant's records start after the same days last year (stray old bills)", () => {
    const c = buildCharts(data, { ...o, recordsFrom: "2026-02-01" }, []);
    expect([c.sales.lastYear, c.totals.lastYear, c.recordsFrom]).toEqual([null, null, "2026-02-01"]);
    expect(buildCharts(data, { ...o, recordsFrom: null }, []).sales.lastYear).toBeNull();
  });

  it("a brand picked: only its bills (never van sales); with GST", () => {
    const c = buildCharts(data, { ...o, brand: "Bluemins", amount: "with" }, []);
    expect(c.sales.total).toEqual([105_000n, 0n]);
    expect(c.expenses.total).toEqual([59_000n, 25_000n]);
  });

  it("expenses by group (empty groups left out), money in / out and the running total", () => {
    const c = buildCharts(data, o, []);
    expect(c.expenses.groups.map((s) => [s.name, s.values])).toEqual([
      ["Purchases", [50_000n, 0n]],
      ["Van (diesel, meal, toll)", [0n, 20_000n]],
      ["Other cash expenses", [0n, 5_000n]],
    ]);
    expect(c.money.in).toEqual([200_000n, 0n]);
    expect(c.money.out).toEqual([150_000n, 100_000n]);
    expect(c.money.running).toEqual([50_000n, -50_000n]);
    expect(running([1n, 2n], [3n, 0n])).toEqual([-2n, 0n]);
  });

  it("orders a day by weekday: count ÷ how many of that weekday the period has", () => {
    // 2–15 Nov: two of every weekday
    const w = weekdayAverages(data.orderDates, "2026-11-02", "2026-11-15");
    expect(w.map((x) => [x.label, x.orders, x.avg])).toEqual([
      ["Mon", 3, 1.5], ["Tue", 0, 0], ["Wed", 0, 0], ["Thu", 0, 0], ["Fri", 0, 0], ["Sat", 1, 0.5], ["Sun", 0, 0],
    ]);
  });

  it("expense types biggest first, the tail folded into one row", () => {
    const rows = topTypes(
      [exp({ type: "A", before: 5n }), exp({ type: "B", before: 9n }), exp({ type: "A", before: 5n }), exp({ type: "C", before: 1n }), exp({ type: "D", before: 2n })],
      "before",
      3,
    );
    expect(rows.map((r) => [r.label, r.amount])).toEqual([["A", 10n], ["B", 9n], ["2 other types", 3n]]);
  });
});

describe("the overview", () => {
  it("by bill = sales vs purchases + expenses; by payment = money in vs out; cash flow from 0", () => {
    const d = {
      sales: [sale({ date: "2026-10-03" }), sale({ date: "2026-11-03", van: true, before: 7_000n })],
      expenses: [exp({ date: "2026-10-04" }), exp({ date: "2026-11-04", group: "other", type: "Repairs", before: 1_000n })],
      money: [{ date: "2026-10-09", dir: "in", amount: 90_000n }, { date: "2026-11-09", dir: "out", amount: 30_000n }] as MoneyFact[],
    };
    const bill = buildOverview(d, { from: "2026-10-01", to: "2026-11-16", basis: "bill" });
    expect([bill.income, bill.expense]).toEqual([[100_000n, 7_000n], [50_000n, 1_000n]]);
    const pay = buildOverview(d, { from: "2026-10-01", to: "2026-11-16", basis: "payment" });
    expect([pay.income, pay.expense]).toEqual([[90_000n, 0n], [0n, 30_000n]]);
    expect(pay.cash).toMatchObject({ start: 0n, totalIn: 90_000n, totalOut: 30_000n, end: 60_000n, running: [90_000n, 60_000n] });
    expect(bill.types.map((t) => t.label)).toEqual(["Purchases: Preform", "Repairs"]);
  });
});

describe("the axis", () => {
  it("round tops and short rupee labels", () => {
    expect(niceScale(432_000)).toEqual({ max: 500_000, step: 125_000 });
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect([shortRupees(125_000), shortRupees(2_50_00_000), shortRupees(85_000), shortRupees(950), shortRupees(-150_000)]).toEqual(["₹1.3 L", "₹2.5 Cr", "₹85k", "₹950", "−₹1.5 L"]);
  });
});

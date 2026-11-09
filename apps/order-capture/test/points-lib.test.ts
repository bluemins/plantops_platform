// Drop points rules (src/lib/points.ts), a hand-worked year. Owner 2026-11-09: Bluemins value before GST after
// discounts; paid within 5 days of delivery or no points; points on the payment's allocation day; ₹ per point by date.
import { describe, expect, it } from "vitest";
import {
  canUse,
  firstYearEnd,
  mainValue,
  nextReward,
  pointsSummary,
  purchasePoints,
  redeemOpensOn,
  requestState,
  yearEndOf,
  type PointsAllocation,
  type PointsBill,
  type PointsPayment,
  type PointsRequest,
  type PointsSetting,
} from "@/lib/points";

const R = (rupees: number) => BigInt(Math.round(rupees * 100));
const ONE_L = { sku_id: "1l", label: "Bluemins 1L Water Bottle", points: 400 };
const S0: PointsSetting = { effective_from: "2026-11-09", start_date: "2026-11-10", rupees_per_point: R(20), late_days: 5, poll_points: 10, redeem_months: [7, 8, 9, 10, 11, 12, 1], rewards: [ONE_L] };
// ₹ per point raised from 1 March 2027: only allocations from that day use it
const S1: PointsSetting = { ...S0, effective_from: "2027-03-01", rupees_per_point: R(25) };
const SETTINGS = [S0, S1];

const nonGst = (lines: [string, number][]) => lines.map(([brand, v]) => ({ brand, line_total: v.toFixed(2), taxable: null, free: false }));

describe("a bill's main-brand value (before GST, after discounts)", () => {
  it("a bill without GST shares the whole-bill discount by line value; other brands left out", () => {
    // Bluemins ₹8,000 + Mr.Charge ₹2,000, ₹1,000 off the bill → Bluemins worth ₹7,200
    expect(mainValue(nonGst([["Bluemins", 8000], ["Mr.Charge", 2000]]), R(10000), R(1000), "bluemins")).toBe(R(7200));
  });
  it("a GST bill counts the taxable value of its main-brand lines; free and 20 L lines don't count", () => {
    const lines = [
      { brand: "Bluemins", line_total: "1050.00", taxable: "1000.00", free: false },
      { brand: "Bluemins", line_total: "0.00", taxable: "0.00", free: true },
      { brand: "Bluemins 20L", line_total: "525.00", taxable: "500.00", free: false },
    ];
    expect(mainValue(lines, R(1575), 0n, "Bluemins")).toBe(R(1000));
  });
});

describe("a hand-worked year", () => {
  const bills: PointsBill[] = [
    // B1: ₹9,000 (₹7,200 Bluemins), delivered 11 Nov
    { id: "B1", source: "plantops", bill_date: "2026-11-12", delivered_on: "2026-11-11", total: R(9000), main_value: R(7200), cancelled: false },
    // B2: GST bill ₹1,575 (₹1,000 Bluemins before GST), delivered 29 Nov, paid by an advance from 25 Nov
    { id: "B2", source: "plantops", bill_date: "2026-12-01", delivered_on: "2026-11-29", total: R(1575), main_value: R(1000), cancelled: false },
    // B3: before the start date
    { id: "B3", source: "plantops", bill_date: "2026-11-05", delivered_on: "2026-11-05", total: R(1000), main_value: R(1000), cancelled: false },
    // B4: cancelled
    { id: "B4", source: "plantops", bill_date: "2026-11-15", delivered_on: "2026-11-15", total: R(1000), main_value: R(1000), cancelled: true },
    // B5: no order (bill date counts), after ₹25 a point
    { id: "B5", source: "plantops", bill_date: "2027-03-05", delivered_on: null, total: R(5000), main_value: R(5000), cancelled: false },
    // B6: paid exactly 5 days after delivery
    { id: "B6", source: "plantops", bill_date: "2027-04-03", delivered_on: "2027-04-01", total: R(2000), main_value: R(2000), cancelled: false },
    // B7: Zoho history never earns
    { id: "B7", source: "zoho", bill_date: "2026-11-20", delivered_on: null, total: R(1000), main_value: R(1000), cancelled: false },
  ];
  const payments: PointsPayment[] = [
    { id: "P1", payment_date: "2026-11-14", cancelled: false }, // 3 days after delivery: on time
    { id: "P2", payment_date: "2026-11-17", cancelled: false }, // 6 days after: no points
    { id: "P3", payment_date: "2026-11-25", cancelled: false }, // advance, used on 1 Dec
    { id: "P4", payment_date: "2026-11-06", cancelled: false },
    { id: "P5", payment_date: "2026-11-15", cancelled: false },
    { id: "P6", payment_date: "2027-03-10", cancelled: false },
    { id: "P7", payment_date: "2027-03-10", cancelled: true }, // typed twice, cancelled
    { id: "P8", payment_date: "2027-04-06", cancelled: false },
    { id: "P9", payment_date: "2026-11-20", cancelled: false },
  ];
  const allocations: PointsAllocation[] = [
    { payment_id: "P1", bill_id: "B1", amount: R(4500), allocated_on: "2026-11-14" },
    { payment_id: "P2", bill_id: "B1", amount: R(4500), allocated_on: "2026-11-17" },
    { payment_id: "P3", bill_id: "B2", amount: R(1575), allocated_on: "2026-12-01" },
    { payment_id: "P4", bill_id: "B3", amount: R(1000), allocated_on: "2026-11-06" },
    { payment_id: "P5", bill_id: "B4", amount: R(1000), allocated_on: "2026-11-15" },
    { payment_id: "P5", bill_id: "B4", amount: R(-1000), allocated_on: "2026-11-16" },
    { payment_id: "P6", bill_id: "B5", amount: R(5000), allocated_on: "2027-03-10" },
    { payment_id: "P7", bill_id: "B5", amount: R(5000), allocated_on: "2027-03-10" },
    { payment_id: "P7", bill_id: "B5", amount: R(-5000), allocated_on: "2027-03-12" },
    { payment_id: "P8", bill_id: "B6", amount: R(2000), allocated_on: "2027-04-06" },
    { payment_id: "P9", bill_id: "B7", amount: R(1000), allocated_on: "2026-11-20" },
  ];
  const earned = purchasePoints(bills, payments, allocations, SETTINGS);

  it("each payment earns its share; late, cancelled, before-start and Zoho earn nothing", () => {
    // P1: ₹4,500 × 7,200 / 9,000 / ₹20 = 180 · P2 late: 0 · P3: ₹1,000 / ₹20 = 50 · P6: ₹5,000 / ₹25 = 200 · P8: ₹2,000 / ₹25 = 80
    expect(earned.map((e) => [e.on, Number(e.hundredths) / 100])).toEqual([
      ["2026-11-14", 180],
      ["2026-11-17", 0],
      ["2026-12-01", 50],
      ["2027-03-10", 200],
      ["2027-04-06", 80],
    ]);
  });

  it("nothing earns while points are off", () => {
    expect(purchasePoints(bills, payments, allocations, [{ ...S0, start_date: null }])).toEqual([]);
    expect(purchasePoints(bills, payments, allocations, [])).toEqual([]);
  });

  const requests: PointsRequest[] = [
    { id: "R1", label: ONE_L.label, points: 400, year_end: "2028-01-31", asked_on: "2027-07-02", state: "delivered" },
    { id: "R2", label: ONE_L.label, points: 400, year_end: "2028-01-31", asked_on: "2027-07-01", state: "returned" },
  ];

  it("balance and the monthly record (no per-bill numbers); a delivered free box is spent, a returned one gives the points back", () => {
    const s = pointsSummary({ earned, polls: [{ on: "2027-07-05", points: 10 }], requests, settings: SETTINGS, today: "2027-08-15" });
    expect(s.on).toBe(true);
    expect(s.year_end).toBe("2028-01-31");
    expect(s.balance).toBe(510 + 10 - 400);
    expect(s.open_request).toBeNull();
    expect(s.record).toEqual([
      { month: "2027-07", purchases: 0, polls: 10, boxes: [{ label: ONE_L.label, state: "delivered", date: "2027-07-02" }, { label: ONE_L.label, state: "returned", date: "2027-07-01" }] },
      { month: "2027-04", purchases: 80, polls: 0, boxes: [] },
      { month: "2027-03", purchases: 200, polls: 0, boxes: [] },
      { month: "2026-12", purchases: 50, polls: 0, boxes: [] },
      { month: "2026-11", purchases: 180, polls: 0, boxes: [] },
    ]);
  });

  it("points end on 31 January: the long first year, then 1 February – 31 January", () => {
    expect(firstYearEnd("2026-11-10")).toBe("2028-01-31");
    expect(firstYearEnd("2027-07-31")).toBe("2028-01-31");
    expect(firstYearEnd("2027-02-01")).toBe("2028-01-31");
    expect(yearEndOf("2028-01-31", "2026-11-10")).toBe("2028-01-31");
    expect(yearEndOf("2028-02-01", "2026-11-10")).toBe("2029-01-31");
    expect(yearEndOf("2029-01-15", "2026-11-10")).toBe("2029-01-31");
    const after = pointsSummary({ earned, polls: [], requests, settings: SETTINGS, today: "2028-02-01" });
    expect(after.balance).toBe(0);
    expect(after.record).toEqual([]);
    const last = pointsSummary({ earned, polls: [], requests, settings: SETTINGS, today: "2028-01-31" });
    expect(last.balance).toBe(110);
  });

  it("before the start date, points are off", () => {
    expect(pointsSummary({ earned, polls: [], requests: [], settings: SETTINGS, today: "2026-11-09" }).on).toBe(false);
  });
});

describe("free boxes", () => {
  const summary = (balance: number, open = false) => ({
    on: true,
    start_date: "2026-11-10",
    year_end: "2028-01-31",
    balance,
    open_request: open ? ({ id: "x", label: "1L", points: 400, year_end: "2028-01-31", asked_on: "2027-08-01", state: "asked" } as PointsRequest) : null,
    record: [],
  });
  it("only in the redeem months, with enough points, one at a time", () => {
    expect(canUse(summary(500), S0, ONE_L, "2027-08-15")).toBeNull();
    expect(canUse(summary(500), S0, ONE_L, "2028-01-31")).toBeNull();
    expect(canUse(summary(500), S0, ONE_L, "2027-02-01")).toBe("not_now");
    expect(canUse(summary(500), S0, ONE_L, "2027-06-30")).toBe("not_now");
    expect(canUse(summary(399), S0, ONE_L, "2027-08-15")).toBe("too_few");
    expect(canUse(summary(900, true), S0, ONE_L, "2027-08-15")).toBe("one_open");
    expect(canUse({ ...summary(900), on: false }, S0, ONE_L, "2027-08-15")).toBe("points_off");
  });
  it("when free boxes open next; how far to the cheapest", () => {
    expect(redeemOpensOn(S0, "2027-03-15")).toBe("2027-07-01");
    expect(redeemOpensOn(S0, "2027-12-15")).toBe("2028-01-01");
    expect(nextReward(summary(240), [ONE_L, { ...ONE_L, sku_id: "5", points: 1250 }])).toEqual({ label: ONE_L.label, missing: 160 });
    expect(nextReward(summary(900), [ONE_L])).toEqual({ label: ONE_L.label, missing: 0 });
  });
  it("a request's state follows its order: undo delivered puts it back on the order", () => {
    expect(requestState({ cancelled: false, order_status: null })).toBe("asked");
    expect(requestState({ cancelled: false, order_status: "pending" })).toBe("on_order");
    expect(requestState({ cancelled: false, order_status: "delivered" })).toBe("delivered");
    expect(requestState({ cancelled: false, order_status: "cancelled" })).toBe("returned");
    expect(requestState({ cancelled: true, order_status: "pending" })).toBe("returned");
  });
});

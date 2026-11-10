// The Receivables rules (src/lib/receivables.ts; docs/REPORTS_PHASE_PLAN.md section 6) on a hand-worked set:
//   A (Bijepur): A1 1 Sep ₹1,000 (due 16 Sep, kedar, OD-1), A2 20 Oct ₹500 (due 4 Nov, anmol);
//                payment 5 Oct ₹1,200: ₹1,000 on A1 that day, the ₹200 left used on A2 on 20 Oct.
//   B (Zoho contact, no place): OB-1 opening balance 1 Apr ₹300 (₹100 closed in Zoho on 10 Oct), B1 31 Oct ₹700 (no due date).
//   C (Dhanupali): payment 15 Oct ₹300, not used (advance).
import { describe, expect, it } from "vitest";
import {
  agingDetails,
  agingSummary,
  asOfDate,
  bandIndex,
  bandLabels,
  billDetails,
  customerBalances,
  daysBetween,
  type RecBill,
  type RecData,
  type RecTable,
} from "@/lib/receivables";

const A = { customer_key: "c:a", customer_name: "Sri ram hotel", href: "/customers/a?tab=statement", place: "Bijepur" };
const B = { customer_key: "z:b", customer_name: "Uttam Bargarh", href: "/customers/z/b?tab=statement", place: null };
const C = { customer_key: "c:c", customer_name: "Krupalu Enterprises", href: "/customers/c?tab=statement", place: "Dhanupali" };
const bill = (x: Partial<RecBill> & Pick<RecBill, "id" | "bill_date" | "total">): RecBill => ({
  ...A, number: x.id, due_date: null, salesperson: null, vehicle: null, ...x,
});
const R = (n: number) => BigInt(n * 100);
const data: RecData = {
  bills: [
    bill({ id: "A1", bill_date: "2026-09-01", due_date: "2026-09-16", total: R(1000), salesperson: "kedar", vehicle: "OD-1" }),
    bill({ id: "A2", bill_date: "2026-10-20", due_date: "2026-11-04", total: R(500), salesperson: "Anmol" }),
    bill({ ...B, id: "OB-1", bill_date: "2026-04-01", due_date: "2026-04-01", total: R(300) }),
    bill({ ...B, id: "B1", bill_date: "2026-10-31", total: R(700) }),
  ],
  payments: [
    { ...A, id: "PA", payment_date: "2026-10-05", amount: R(1200) },
    { ...C, id: "PC", payment_date: "2026-10-15", amount: R(300) },
  ],
  settles: [
    { bill_id: "A1", payment_id: "PA", amount: R(1000), on: "2026-10-05" },
    { bill_id: "A2", payment_id: "PA", amount: R(200), on: "2026-10-20" },
    { bill_id: "OB-1", payment_id: null, amount: R(100), on: "2026-10-10" },
  ],
};
const rupees = (c: unknown) => (typeof c === "bigint" ? Number(c) / 100 : c);
const rows = (t: RecTable) => t.groups.flatMap((g) => g.rows.map((r) => [r.label, ...r.cells.map(rupees)]));
const aging = (asOf: string, more: Partial<Parameters<typeof agingSummary>[1]> = {}) =>
  agingSummary(data, { asOf, basis: "due", interval: 15, filter: {}, group: "none", ...more });

describe("dates and bands", () => {
  it("as of: today, end of last month / quarter / financial year, custom", () => {
    expect(asOfDate("today", "2026-11-10")).toBe("2026-11-10");
    expect(asOfDate("end_prev_month", "2026-11-10")).toBe("2026-10-31");
    expect(asOfDate("end_prev_quarter", "2026-11-10")).toBe("2026-09-30");
    expect(asOfDate("end_prev_fy", "2026-11-10")).toBe("2026-03-31");
    expect(asOfDate("custom", "2026-11-10", "2026-11-05")).toBe("2026-11-05");
    expect(asOfDate("custom", "2026-11-10", "junk")).toBe("2026-11-10");
  });
  it("band edges: 0 = current, 1–15, 16–30, 31–45, over 45 (or 30-day steps)", () => {
    expect([-3, 0, 1, 15, 16, 30, 31, 45, 46, 400].map((d) => bandIndex(d, 15))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect([30, 31, 90, 91].map((d) => bandIndex(d, 30))).toEqual([1, 2, 3, 4]);
    expect(bandLabels(30)).toEqual(["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"]);
    expect(daysBetween("2026-04-01", "2026-11-10")).toBe(223);
  });
});

describe("Aging Summary", () => {
  it("today: what is still due per customer by age; the opening balance counts; advances shown apart", () => {
    const t = aging("2026-11-10");
    expect(rows(t)).toEqual([
      ["Uttam Bargarh", "2", 0, 700, 0, 0, 200, 900],
      ["Sri ram hotel", "1", 0, 300, 0, 0, 0, 300],
    ]);
    expect(t.total.map(rupees)).toEqual(["3", 0, 1000, 0, 0, 200, 1200]);
    expect(t.advance).toBe(R(300)); // C's payment, not taken off
  });
  it("as of a past day: later bills, payments and adjustments don't count", () => {
    expect(rows(aging("2026-10-04"))).toEqual([
      ["Sri ram hotel", "1", 0, 0, 1000, 0, 0, 1000], // 18 days past 16 Sep
      ["Uttam Bargarh", "1", 0, 0, 0, 0, 300, 300], // the ₹100 closed on 10 Oct not yet
    ]);
    const t = aging("2026-10-10");
    expect(t.total.at(-1)).toBe(R(200));
    expect(t.advance).toBe(R(200)); // ₹200 of A's payment not used until 20 Oct
  });
  it("by bill date, 30-day bands, place filter, grouped by salesperson", () => {
    expect(rows(aging("2026-11-10", { basis: "bill" }))[1]).toEqual(["Sri ram hotel", "1", 0, 0, 300, 0, 0, 300]); // 21 days old
    expect(rows(aging("2026-11-10", { interval: 30 }))[0]).toEqual(["Uttam Bargarh", "2", 0, 700, 0, 0, 200, 900]);
    const bij = aging("2026-11-10", { filter: { place: "bijepur" } });
    expect([rows(bij).length, bij.total.at(-1), bij.advance]).toEqual([1, R(300), null]);
    const g = aging("2026-11-10", { group: "salesperson" });
    expect(g.groups.map((x) => [x.label, rupees(x.total.at(-1))])).toEqual([["Not mentioned", 900], ["Anmol", 300]]);
    expect(aging("2026-11-10", { filter: { salesperson: "anmol" } }).advance).toBeNull(); // advances are per customer
  });
});

describe("Aging Details", () => {
  it("each unpaid bill, oldest band first, oldest bill first in a band", () => {
    const t = agingDetails(data, { asOf: "2026-11-10", basis: "due", interval: 15, filter: {}, group: "band" });
    expect(t.groups.map((g) => g.label)).toEqual(["Over 45 days", "1–15 days"]);
    expect(rows(t)).toEqual([
      ["OB-1", "01-04-2026", "Uttam Bargarh", "01-04-2026", "223", "Over 45 days", 300, 200],
      ["B1", "31-10-2026", "Uttam Bargarh", "31-10-2026", "10", "1–15 days", 700, 700],
      ["A2", "20-10-2026", "Sri ram hotel", "04-11-2026", "6", "1–15 days", 500, 300],
    ]);
    expect(t.total.map(rupees)).toEqual(["", "", "", "", "", 1500, 1200]);
  });
});

describe("Customer Balances", () => {
  const oct = { from: "2026-10-01", to: "2026-10-31", filter: {}, group: "none" as const };
  it("opening + billed − received = closing; owe / with advance / everyone", () => {
    expect(rows(customerBalances(data, { ...oct, show: "owe" }))).toEqual([
      ["Uttam Bargarh", 300, 700, 100, 900],
      ["Sri ram hotel", 1000, 500, 1200, 300],
    ]);
    const t = customerBalances(data, { ...oct, show: "nonzero" });
    expect(rows(t).at(-1)).toEqual(["Krupalu Enterprises", 0, 0, 300, -300]);
    expect(t.total.map(rupees)).toEqual([1300, 1200, 1600, 900]);
  });
  it("by salesperson: per bill (what those bills owe), advances left out", () => {
    const t = customerBalances(data, { ...oct, group: "salesperson", show: "all" });
    expect(t.groups.map((g) => [g.label, ...g.total.map(rupees)])).toEqual([
      ["Not mentioned", 300, 700, 100, 900],
      ["Anmol", 0, 500, 200, 300],
      ["kedar", 1000, 0, 1000, 0],
    ]);
    expect(t.notes.join(" ")).toMatch(/Advances .* left out/);
  });
});

describe("Bill Details", () => {
  it("bills of the period with status today; filter overdue; group by status", () => {
    const o = { from: "2026-10-01", to: "2026-10-31", today: "2026-11-10", filter: {}, group: "none" as const };
    expect(rows(billDetails(data, { ...o, status: "all" }))).toEqual([
      ["B1", "31-10-2026", "Uttam Bargarh", "—", "Due", 700, 700],
      ["A2", "20-10-2026", "Sri ram hotel", "04-11-2026", "Overdue", 500, 300],
    ]);
    expect(rows(billDetails(data, { ...o, status: "overdue" })).map((r) => r[0])).toEqual(["A2"]);
    expect(billDetails(data, { ...o, status: "all", group: "status" }).groups.map((g) => g.label)).toEqual(["Overdue", "Due"]);
    expect(rows(billDetails(data, { ...o, from: "2026-09-01", to: "2026-09-30", status: "paid" }))).toEqual([
      ["A1", "01-09-2026", "Sri ram hotel", "16-09-2026", "Paid", 1000, 0],
    ]);
  });
});

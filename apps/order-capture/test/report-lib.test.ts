// The sales report rules (src/lib/report.ts; docs/REPORTS_PHASE_PLAN.md): periods on the Indian financial year,
// month / quarter columns, grouping, filters, one row per product, before / with GST, exact totals.
import { describe, expect, it } from "vitest";
import { bucketOf, bucketsBetween, buildReport, periodDates, qtyOf, qtyText, type SalesLine } from "@/lib/report";

describe("periods", () => {
  it.each([
    ["this_month", "2026-11-07", "2026-11-01", "2026-11-07"],
    ["prev_month", "2026-11-07", "2026-10-01", "2026-10-31"],
    ["prev_month", "2027-01-05", "2026-12-01", "2026-12-31"],
    ["this_quarter", "2026-11-07", "2026-10-01", "2026-11-07"],
    ["prev_quarter", "2026-11-07", "2026-07-01", "2026-09-30"],
    ["prev_quarter", "2026-05-02", "2026-01-01", "2026-03-31"],
    ["this_fy", "2026-11-07", "2026-04-01", "2026-11-07"],
    ["this_fy", "2027-02-10", "2026-04-01", "2027-02-10"],
    ["prev_fy", "2026-11-07", "2025-04-01", "2026-03-31"],
  ] as const)("%s on %s = %s to %s", (period, today, from, to) => {
    expect(periodDates(period, today)).toEqual({ from, to });
  });
  it("custom dates, swapped when typed the wrong way round; bad dates fall back to this month", () => {
    expect(periodDates("custom", "2026-11-07", { from: "2026-10-31", to: "2026-10-01" })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodDates("custom", "2026-11-07", { from: "x" })).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  });
  it("columns: months, and Indian financial-year quarters", () => {
    expect(bucketOf("2026-10-15", "month")).toEqual({ key: "2026-10", label: "Oct 2026" });
    expect(bucketOf("2026-08-15", "quarter")).toEqual({ key: "2026-07", label: "Jul–Sep 2026 (Q2)" });
    expect(bucketOf("2027-02-15", "quarter").label).toBe("Jan–Mar 2027 (Q4)");
    expect(bucketsBetween("2026-07-01", "2026-09-30", "month").map((b) => b.label)).toEqual(["Jul 2026", "Aug 2026", "Sep 2026"]);
    expect(bucketsBetween("2026-04-01", "2027-03-31", "quarter").map((b) => b.label)).toEqual(["Apr–Jun 2026 (Q1)", "Jul–Sep 2026 (Q2)", "Oct–Dec 2026 (Q3)", "Jan–Mar 2027 (Q4)"]);
  });
  it("quantities stay exact", () => {
    expect(qtyText(qtyOf("2197.000"))).toBe("2,197");
    expect(qtyText(qtyOf("1.500"))).toBe("1.5");
  });
});

let n = 0;
const line = (p: Omit<Partial<SalesLine>, "before" | "with_gst"> & { before: number; with_gst?: number; date?: string }): SalesLine => ({
  bill_id: p.bill_id ?? `b${++n}`,
  bill_date: p.date ?? "2026-10-10",
  salesperson: p.salesperson ?? null,
  customer_key: p.customer_key ?? "c:1",
  customer_name: p.customer_name ?? "Krupalu Enterprises",
  place: p.place ?? "Dhanupali",
  vehicle: p.vehicle ?? null,
  brand: p.brand ?? null,
  item_key: p.item_key ?? "s:1l",
  item_name: p.item_name ?? "1L Water Bottle",
  sku: p.sku ?? "PV_BM_1",
  qty: p.qty ?? 1000n,
  before: BigInt(Math.round(p.before * 100)),
  with_gst: BigInt(Math.round((p.with_gst ?? p.before) * 100)),
});
const base = { kind: "item" as const, from: "2026-10-01", to: "2026-10-31", breakdown: "none" as const, group: "none" as const, amount: "before" as const };

describe("Sales by Item", () => {
  const lines = [
    line({ salesperson: "kedar", item_key: "s:500", item_name: "500ml Water Bottle", sku: "PV_BM_500", qty: 854000n, before: 108800 }),
    line({ salesperson: "kedar", qty: 1292000n, before: 108245 }),
    line({ salesperson: "Anmol ", qty: 15000n, before: 1350 }),
    line({ salesperson: "anmol", item_key: "s:500", item_name: "500ml Water Bottle", sku: "PV_BM_500", qty: 5000n, before: 700 }),
    line({ salesperson: null, item_key: "s:dm5", item_name: "5 Litre Deionised Water", sku: "PV_DM_5", qty: 1000n, before: 200 }),
    // the same product under Zoho's other name: one row
    line({ salesperson: "Bindu Sagar Bhoi", item_key: "s:dm1", item_name: "1 Litre Deionised Water", sku: "PV_DM_1", qty: 919000n, before: 78798 }),
    line({ salesperson: "Bindu Sagar Bhoi", item_key: "s:dm1", item_name: "1 Litre Deionised Water", sku: "PV_DM_1", qty: 1000n, before: 96 }),
    // outside October: left out
    line({ salesperson: "kedar", date: "2026-09-30", before: 999 }),
  ];

  it("grouped by salesperson like the owner's Zoho report: Not mentioned first, names in any case together", () => {
    const r = buildReport(lines, { ...base, group: "salesperson" });
    expect(r.groups.map((g) => [g.label, qtyText(g.qty), Number(g.amount) / 100])).toEqual([
      ["Not mentioned", "1", 200],
      ["Anmol", "20", 2050],
      ["Bindu Sagar Bhoi", "920", 78894],
      ["kedar", "2,146", 217045],
    ]);
    expect(r.groups[2]!.rows).toHaveLength(1); // two Zoho names, one product
    expect(r.groups[3]!.rows.map((x) => x.label)).toEqual(["500ml Water Bottle", "1L Water Bottle"]); // biggest first
    expect(Number(r.total.amount) / 100).toBe(298189);
    expect(r.total.bills).toBe(7);
  });

  it("a salesperson filter (any case), Not mentioned, place and vehicle filters", () => {
    expect(Number(buildReport(lines, { ...base, salesperson: "ANMOL" }).total.amount) / 100).toBe(2050);
    expect(Number(buildReport(lines, { ...base, salesperson: "Not mentioned" }).total.amount) / 100).toBe(200);
    expect(buildReport(lines, { ...base, place: "Bargarh" }).groups).toEqual([]);
    expect(buildReport(lines, { ...base }).choices.salespeople).toEqual(["Anmol", "Bindu Sagar Bhoi", "kedar"]);
  });

  it("broken down by month: one column per month, a month without sales shows 0", () => {
    const r = buildReport(lines, { ...base, from: "2026-08-01", breakdown: "month" });
    expect(r.buckets.map((b) => b.label)).toEqual(["Aug 2026", "Sep 2026", "Oct 2026"]);
    expect(r.total.amounts.map((a) => Number(a) / 100)).toEqual([0, 999, 298189]);
    expect(Number(r.total.amount) / 100).toBe(299188);
  });
});

describe("Sales by Customer", () => {
  it("bills, sales before and with GST per customer; grouped by place; the customer group is not offered twice", () => {
    const lines = [
      line({ bill_id: "x1", customer_key: "c:lt", customer_name: "LARSEN & TOUBRO LIMITED", place: "Bijepur", before: 5060, with_gst: 5313 }),
      line({ bill_id: "x2", customer_key: "c:k", customer_name: "Krupalu Enterprises", before: 50000 }),
      line({ bill_id: "x2", customer_key: "c:k", customer_name: "Krupalu Enterprises", before: 46640 }),
    ];
    const r = buildReport(lines, { ...base, kind: "customer" });
    expect(r.groups[0]!.rows.map((x) => [x.label, x.bills, Number(x.before) / 100, Number(x.with_gst) / 100])).toEqual([
      ["Krupalu Enterprises", 1, 96640, 96640],
      ["LARSEN & TOUBRO LIMITED", 1, 5060, 5313],
    ]);
    expect(Number(buildReport(lines, { ...base, kind: "customer", amount: "with" }).total.amount) / 100).toBe(101953);
    expect(buildReport(lines, { ...base, kind: "customer", group: "place" }).groups.map((g) => g.label)).toEqual(["Bijepur", "Dhanupali"]);
    expect(buildReport(lines, { ...base, kind: "customer", group: "customer" }).group).toBe("none");
  });
});

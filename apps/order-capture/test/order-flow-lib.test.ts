// Order to Payment rules (src/lib/order-flow.ts): the stage of each order, what each stage counts, days waiting, overdue,
// filters, the List's order and the Paid column's last 7 days. Zoho and PlantOps bills count alike.
import { describe, expect, it } from "vitest";
import { flowRow, flowRows, flowStage, recentlyPaid, sortRows, stageSums, type FlowFilter, type FlowOrder } from "@/lib/order-flow";

const today = "2026-11-10";
const all: FlowFilter = { period: "all", from: "", to: today, customer: "", salesperson: "", place: "", brand: "", overdue: false, cancelled: false };
let n = 0;
function order(o: Partial<Omit<FlowOrder, "bill">> & { bill?: Partial<NonNullable<FlowOrder["bill"]>> | null } = {}): FlowOrder {
  const { bill, ...rest } = o;
  n++;
  return {
    id: `o${n}`,
    ref_no: n,
    status: "delivered",
    entered: "2026-11-01",
    delivered: "2026-11-02",
    delivered_by: "Dillip",
    total: 100_000n,
    customer_id: `c${n}`,
    customer_name: "Sri ram hotel",
    phone: "9876543210",
    place: "Bijepur",
    brands: ["Bluemins"],
    ...rest,
    bill: bill === undefined || bill === null
      ? null
      : { id: `b${n}`, number: `B-${n}`, bill_date: "2026-11-03", due_date: "2026-11-03", total: 105_000n, settled: 0n, settled_on: null, salesperson: "Anmol", ...bill },
  };
}

describe("stage of an order", () => {
  it("pending, delivered, billed, part paid, paid, cancelled", () => {
    expect(flowStage(order({ status: "pending", delivered: null, delivered_by: null }))).toBe("pending");
    expect(flowStage(order())).toBe("delivered");
    expect(flowStage(order({ bill: {} }))).toBe("billed");
    expect(flowStage(order({ bill: { settled: 5_000n } }))).toBe("part");
    expect(flowStage(order({ bill: { settled: 105_000n } }))).toBe("paid");
    expect(flowStage(order({ status: "cancelled", delivered: null }))).toBe("cancelled");
  });

  it("an imported Zoho bill counts like a PlantOps one, even long before", () => {
    const zoho = order({ entered: "2026-10-13", delivered: "2026-10-14", bill: { number: "INV-001729", bill_date: "2026-10-13", due_date: "2026-10-13", total: 1_030_000n, settled: 612_000n } });
    const r = flowRow(zoho, today);
    expect([r.stage, r.amount, r.days, r.overdue]).toEqual(["part", 418_000n, 28, true]);
  });
});

describe("what a row shows", () => {
  it("pending: the order total, days since entered", () => {
    const r = flowRow(order({ status: "pending", entered: "2026-10-20", delivered: null, delivered_by: null }), today);
    expect([r.amount, r.days, r.overdue, r.bill]).toEqual([100_000n, 21, false, null]);
  });
  it("delivered: days since delivered; salesperson = who delivered when there is no bill", () => {
    const r = flowRow(order({ delivered: "2026-11-06" }), today);
    expect([r.amount, r.days, r.salesperson]).toEqual([100_000n, 4, "Dillip"]);
  });
  it("billed: still due with GST, days since the bill, overdue after the due date (no due date = bill date)", () => {
    const r = flowRow(order({ bill: { bill_date: "2026-11-08", due_date: null } }), today);
    expect([r.amount, r.due, r.days, r.overdue, r.salesperson]).toEqual([105_000n, 105_000n, 2, true, "Anmol"]);
    expect(flowRow(order({ bill: { bill_date: "2026-11-10", due_date: null } }), today).overdue).toBe(false);
    expect(flowRow(order({ bill: { due_date: "2026-11-25" } }), today).overdue).toBe(false);
  });
  it("paid: the bill total, the day it was fully paid, never overdue", () => {
    const r = flowRow(order({ bill: { settled: 105_000n, settled_on: "2026-11-09" } }), today);
    expect([r.amount, r.due, r.days, r.overdue, r.paid_on]).toEqual([105_000n, 0n, null, false, "2026-11-09"]);
    expect(recentlyPaid(r, today)).toBe(true);
    expect(recentlyPaid(flowRow(order({ bill: { settled: 105_000n, settled_on: "2026-11-01" } }), today), today)).toBe(false);
  });
  it("paid more than the bill (an adjustment on top) still shows nothing due", () => {
    expect(flowRow(order({ bill: { settled: 110_000n } }), today).due).toBe(0n);
  });
});

describe("filters, totals, order", () => {
  const orders = [
    order({ status: "pending", entered: "2026-10-20", delivered: null, delivered_by: null, customer_name: "Mahapatra Battle", place: "Ghens" }),
    order({ customer_name: "Trinath Electricals", phone: "9437000001", brands: ["Mr.Charge"] }),
    order({ bill: { bill_date: "2026-10-19", due_date: "2026-10-19" }, customer_name: "Judhirstir tripathi" }),
    order({ bill: { bill_date: "2026-11-09", due_date: "2026-11-09", settled: 5_000n } }),
    order({ bill: { settled: 105_000n, settled_on: "2026-11-09" } }),
    order({ status: "cancelled", delivered: null }),
  ];

  it("cancelled left out unless asked; sums per stage in board order", () => {
    const rows = flowRows(orders, today, all);
    expect(rows.map((r) => r.stage)).not.toContain("cancelled");
    expect(stageSums(rows, false).map((s) => [s.stage, s.count, s.amount, s.overdue])).toEqual([
      ["pending", 1, 100_000n, 0],
      ["delivered", 1, 100_000n, 0],
      ["billed", 1, 105_000n, 1],
      ["part", 1, 100_000n, 1],
      ["paid", 1, 105_000n, 0],
    ]);
    expect(stageSums(flowRows(orders, today, { ...all, cancelled: true }), true).at(-1)).toMatchObject({ stage: "cancelled", count: 1 });
  });

  it("customer by name or mobile, place, brand, salesperson, only overdue, period by entered date", () => {
    expect(flowRows(orders, today, { ...all, customer: "mahapatra" }).map((r) => r.customer_name)).toEqual(["Mahapatra Battle"]);
    expect(flowRows(orders, today, { ...all, customer: "+91 94370 00001" }).map((r) => r.customer_name)).toEqual(["Trinath Electricals"]);
    expect(flowRows(orders, today, { ...all, place: "ghens" })).toHaveLength(1);
    expect(flowRows(orders, today, { ...all, brand: "mr.charge" })).toHaveLength(1);
    expect(flowRows(orders, today, { ...all, salesperson: "anmol" })).toHaveLength(3);
    expect(flowRows(orders, today, { ...all, overdue: true }).map((r) => r.stage)).toEqual(["billed", "part"]);
    expect(flowRows(orders, today, { ...all, period: "custom", from: "2026-10-01", to: "2026-10-31" }).map((r) => r.customer_name)).toEqual(["Mahapatra Battle"]);
  });

  it("List order: billed, part paid (oldest first), delivered, pending, paid", () => {
    expect(sortRows(flowRows(orders, today, all)).map((r) => r.stage)).toEqual(["billed", "part", "delivered", "pending", "paid"]);
  });
});

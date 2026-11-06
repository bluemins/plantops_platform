// The sales ledger's money rules (src/lib/ledger.ts) with the cases found in plant 001's Zoho exports: part payments,
// several payments on one bill, an advance, invoices closed in Zoho without a payment, Zoho's -3.60 adjustment,
// cancelled bills and payments, oldest-first allocation, Closed orders and the statement.
import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  billDue,
  billRef,
  billStatus,
  ledgerTotals,
  orderLedgerStatus,
  paise,
  paymentRef,
  paymentUnused,
  rupees,
  statement,
  useAdvances,
  type LedgerAdjustment,
  type LedgerAllocation,
  type LedgerBill,
  type LedgerPayment,
} from "@/lib/ledger";

const bill = (id: string, total: string, bill_date: string, over: Partial<LedgerBill> = {}): LedgerBill => ({
  id, number: `INV-${id}`, bill_date, due_date: bill_date, total: paise(total), cancelled: false, order_id: null, ...over,
});
const pay = (id: string, amount: string, payment_date: string, over: Partial<LedgerPayment> = {}): LedgerPayment => ({
  id, number: id, payment_date, amount: paise(amount), cancelled: false, ...over,
});
const alloc = (payment_id: string, bill_id: string, amount: string): LedgerAllocation => ({ payment_id, bill_id, amount: paise(amount) });
const adj = (bill_id: string, amount: string, adjusted_on = "2026-11-05"): LedgerAdjustment => ({ bill_id, amount: paise(amount), adjusted_on });

describe("paise", () => {
  it("reads signed rupees exactly (Zoho's -3.60 adjustment) and writes them back", () => {
    expect([paise("1150.00"), paise("-3.60"), paise("0.5"), paise("0"), paise("1500.000")]).toEqual([115000n, -360n, 50n, 0n, 150000n]);
    expect([rupees(115000n), rupees(-360n), rupees(5n)]).toEqual(["1150.00", "-3.60", "0.05"]);
  });
  it("numbers: B-0001, P-0042", () => {
    expect([billRef(1), paymentRef(42), billRef(12345)]).toEqual(["B-0001", "P-0042", "B-12345"]);
  });
});

describe("a bill's due and status", () => {
  const b = bill("1", "1150", "2026-10-01");
  it("full, part and several payments", () => {
    expect(billDue(b, [], [])).toBe(115000n);
    expect(billDue(b, [alloc("p1", "1", "600")], [])).toBe(55000n);
    expect(billDue(b, [alloc("p1", "1", "600"), alloc("p2", "1", "550")], [])).toBe(0n);
    expect(billStatus(b, 55000n, "2026-09-30")).toBe("part_paid");
    expect(billStatus(b, 115000n, "2026-09-30")).toBe("due");
    expect(billStatus(b, 55000n, "2026-10-02")).toBe("overdue");
    expect(billStatus(b, 0n, "2027-01-01")).toBe("paid");
  });
  it("closed in Zoho without a payment: the adjustment settles it", () => {
    expect(billDue(b, [alloc("p1", "1", "1000")], [adj("1", "150")])).toBe(0n);
  });
  it("a reversing allocation (cancelled payment) brings the due back", () => {
    expect(billDue(b, [alloc("p1", "1", "1150"), alloc("p1", "1", "-1150")], [])).toBe(115000n);
  });
  it("a cancelled bill owes nothing", () => {
    const c = { ...b, cancelled: true };
    expect(billDue(c, [], [])).toBe(0n);
    expect(billStatus(c, 0n, "2026-10-02")).toBe("cancelled");
  });
});

describe("payments and advances", () => {
  it("unused = amount − what it paid (Zoho's ₹1,460 unused advance)", () => {
    const p = pay("1719", "1500", "2026-10-05");
    expect(paymentUnused(p, [alloc("1719", "x", "40")])).toBe(146000n);
    expect(paymentUnused({ ...p, cancelled: true }, [])).toBe(0n);
  });

  it("oldest bills first; never more than a bill's due; the rest stays as advance", () => {
    const open = [
      { id: "b2", number: "INV-000010", bill_date: "2026-10-03", due: paise("500") },
      { id: "b1", number: "INV-000009", bill_date: "2026-10-01", due: paise("350") },
      { id: "b3", number: "INV-000011", bill_date: "2026-10-03", due: paise("200") },
    ];
    expect(allocatePayment(paise("600"), open)).toEqual({ allocations: [{ bill_id: "b1", amount: 35000n }, { bill_id: "b2", amount: 25000n }], unused: 0n });
    expect(allocatePayment(paise("1200"), open)).toEqual({
      allocations: [{ bill_id: "b1", amount: 35000n }, { bill_id: "b2", amount: 50000n }, { bill_id: "b3", amount: 20000n }],
      unused: 15000n,
    });
    // ticked bills only (oldest of them first), the rest is advance
    expect(allocatePayment(paise("600"), open, ["b3", "b2"])).toEqual({ allocations: [{ bill_id: "b2", amount: 50000n }, { bill_id: "b3", amount: 10000n }], unused: 0n });
    expect(allocatePayment(paise("100"), [], [])).toEqual({ allocations: [], unused: 10000n });
  });

  it("a new bill uses advances, oldest payment first", () => {
    const adv = [
      { id: "p2", number: "P-0002", payment_date: "2026-11-02", unused: paise("300") },
      { id: "p1", number: "P-0001", payment_date: "2026-11-01", unused: paise("100") },
    ];
    expect(useAdvances(paise("250"), adv)).toEqual([{ payment_id: "p1", amount: 10000n }, { payment_id: "p2", amount: 15000n }]);
    expect(useAdvances(paise("1000"), adv).map((a) => a.amount)).toEqual([10000n, 30000n]);
  });
});

describe("a customer's totals", () => {
  it("billed − received − adjusted = balance = dues − advances; cancelled rows left out", () => {
    const bills = [bill("1", "1150", "2026-10-01"), bill("2", "500", "2026-10-05"), bill("3", "999", "2026-10-06", { cancelled: true })];
    const payments = [pay("p1", "1150", "2026-10-02"), pay("p2", "600", "2026-10-06"), pay("p3", "50", "2026-10-07", { cancelled: true })];
    const allocations = [alloc("p1", "1", "1150"), alloc("p2", "2", "500")];
    const t = ledgerTotals(bills, payments, allocations, []);
    expect(t).toEqual({ billed: 165000n, received: 175000n, adjusted: 0n, due: 0n, advance: 10000n, balance: -10000n });
    expect(t.balance).toBe(t.due - t.advance);
  });
});

describe("an order shows Closed", () => {
  it("only when delivered and its bill is fully paid", () => {
    expect(orderLedgerStatus("delivered", { cancelled: false, due: 0n })).toBe("closed");
    expect(orderLedgerStatus("delivered", { cancelled: false, due: 100n })).toBe("delivered");
    expect(orderLedgerStatus("delivered", { cancelled: true, due: 0n })).toBe("delivered");
    expect(orderLedgerStatus("delivered", null)).toBe("delivered");
    expect(orderLedgerStatus("pending", { cancelled: false, due: 0n })).toBe("pending");
    expect(orderLedgerStatus("cancelled", null)).toBe("cancelled");
  });
});

describe("statement", () => {
  // like Ajit Kirana (Barpali): 31 Aug bill ₹350 paid the same day, 5 Oct bill ₹500 paid the same day
  const bills = [bill("1321", "350", "2026-08-31"), bill("1660", "500", "2026-10-05"), bill("x", "999", "2026-09-01", { cancelled: true })];
  const payments = [pay("1366", "350", "2026-08-31"), pay("1719", "500", "2026-10-05")];

  it("bills before payments on the same day, running balance, cancelled left out", () => {
    const s = statement(bills, payments, []);
    expect(s.rows.map((r) => [r.date, r.kind, r.number, rupees(r.balance)])).toEqual([
      ["2026-08-31", "bill", "INV-1321", "350.00"],
      ["2026-08-31", "payment", "1366", "0.00"],
      ["2026-10-05", "bill", "INV-1660", "500.00"],
      ["2026-10-05", "payment", "1719", "0.00"],
    ]);
    expect(s).toMatchObject({ opening: 0n, closing: 0n });
  });

  it("a date range starts from what was owed before it", () => {
    const s = statement([...bills, bill("2000", "200", "2026-09-10")], payments, [adj("2000", "50", "2026-10-06")], { from: "2026-09-01", to: "2026-10-05" });
    expect(s.opening).toBe(0n);
    expect(s.rows.map((r) => [r.number, rupees(r.balance)])).toEqual([
      ["INV-2000", "200.00"],
      ["INV-1660", "700.00"],
      ["1719", "200.00"],
    ]);
    expect(s.closing).toBe(20000n);
    const later = statement([...bills, bill("2000", "200", "2026-09-10")], payments, [adj("2000", "50", "2026-10-06")], { from: "2026-10-06" });
    expect(later.opening).toBe(20000n);
    expect(later.rows.map((r) => [r.kind, rupees(r.credit), rupees(r.balance)])).toEqual([["adjustment", "50.00", "150.00"]]);
    expect(statement(bills, payments, [], { from: "2027-01-01" })).toMatchObject({ rows: [], closing: 0n });
  });
});

// Business Overview + charts on real rows (src/server/business.ts; docs/REPORTS_PHASE_PLAN.md section 9): a PlantOps
// bill, a purchase bill, a cash-book expense (and a cancelled one), a customer payment and a vendor payment become sales,
// expenses, money in / out, what customers owe and what the plant owes; owner only (support reads); another plant sees
// none of it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantSku } from "@plantops/types";
import { makeBill } from "@/server/bill-make";
import { businessCharts, businessOverview, readChartParams, readOverviewParams } from "@/server/business";
import { addEntry, cancelEntry, cashLists, startCashBook } from "@/server/cash";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { kit } from "@/server/kit";
import { ReceivePaymentInput, receivePayment } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { addVendor, payVendor, recordPurchaseBill } from "@/server/purchase-entry";
import * as salaryLink from "@/server/salary-link";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Anmol");
const [b1l] = SKUS as [TenantSku];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const days = () => readChartParams({ period: "custom", from: yesterday, to: today, by: "day" });
const rs = (p: bigint) => Number(p) / 100;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  // a bill of ₹900 (10 × ₹90), ₹400 of it paid
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `business-${Date.now()}`,
    customer: { phone: "9876543210", name: "Sri ram hotel", place: "Bijepur" },
    lines: [{ sku_id: b1l.id, quantity: 10, rate: "90" }],
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  await makeBill(acct, { order_id: o.id });
  const customer = ((await asApp(a.tenantId, `select id from order_capture.customers where tenant_id = '${a.tenantId}' and phone = '9876543210'`)).rows[0] as { id: string }).id;
  await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: customer, amount: "400", payment_date: today, mode: "cash" }));
  // a purchase of ₹2,500 + 18 % GST, ₹500 paid
  vi.spyOn(kit, "branding").mockResolvedValue({ name: "Bluemins", gstin: "21ABCDE1234F1Z5" } as never);
  const v = (await addVendor(a.owner, { name: "Balaji Sales", gstin: "21AFFPJ6952A1ZY", active: true } as never)).id;
  await recordPurchaseBill(acct, { vendor_id: v, bill_date: today, adjustment: "0", lines: [{ item_name: "Preform 18.5 g", quantity: "25", unit: "kg", rate: "100", gst_rate: 18 }] } as never);
  await payVendor(acct, { vendor_id: v, payment_date: today, amount: "500", mode: "cash", paid_from: null, reference: null, note: null, bill_ids: [] });
  // cash book: ₹160 diesel; a ₹999 one cancelled
  await startCashBook(a.owner, { date: yesterday, counted: "5000" }, today);
  vi.spyOn(kit, "contacts").mockResolvedValue([]);
  const diesel = (await cashLists(a.owner)).categories.find((c) => c.name === "Diesel")!;
  await addEntry(acct, { kind: "expense", amount: "160", cash_date: today, category_id: diesel.id }, today);
  const wrong = await addEntry(acct, { kind: "expense", amount: "999", cash_date: today, category_id: diesel.id }, today);
  await cancelEntry(a.owner, wrong.id, { reason: "typed twice" });
  vi.restoreAllMocks();
});
afterAll(() => platform.close());

describe("Business charts on real rows", () => {
  it("sales, expenses (purchases before GST + cash), money in / out, customers owe, top customer and type", async () => {
    const c = await businessCharts(a.owner, days());
    expect(c.buckets.map((x) => x.key)).toEqual([yesterday, today]);
    expect([rs(c.totals.sales), rs(c.totals.expenses), rs(c.totals.moneyIn), rs(c.totals.moneyOut)]).toEqual([900, 2660, 400, 660]);
    expect(c.expenses.groups.map((g) => [g.name, g.values.map(rs)])).toEqual([["Purchases", [0, 2500]], ["Other cash expenses", [0, 160]]]);
    expect(c.expenses.types.map((t) => [t.label, rs(t.amount)])).toEqual([["Purchases: Preform 18.5 g", 2500], ["Diesel", 160]]);
    expect(c.money.running.map(rs)).toEqual([0, -260]);
    expect(c.owed.map(rs)).toEqual([0, 500]);
    expect(c.topCustomers.rows.map((r) => [r.label, rs(r.amount)])).toEqual([["Sri ram hotel", 900]]);
    const withGst = await businessCharts(a.owner, readChartParams({ period: "custom", from: yesterday, to: today, by: "day", amount: "with" }));
    expect(rs(withGst.totals.expenses)).toBe(3110); // 2,950 + 160
  });

  it("the overview: customers owe ₹500, the plant owes ₹2,450; income and expense by bill and by payment", async () => {
    const o = await businessOverview(a.owner, readOverviewParams({}));
    expect([rs(o.receivables.total), rs(o.payables.total)]).toEqual([500, 2450]);
    expect([rs(o.totals.income), rs(o.totals.expense)]).toEqual([900, 2660]);
    const pay = await businessOverview(a.owner, readOverviewParams({ basis: "payment" }));
    expect([rs(pay.totals.income), rs(pay.totals.expense), rs(pay.cash.end)]).toEqual([400, 660, -260]);
  });

  it("salary from Attendance: the paid month's cost as an expense, salary paid and advances as money out", async () => {
    // without an answer from Attendance (the test platform has no lookup ticket): said so, never ₹0 salary
    expect((await businessCharts(a.owner, days())).salary.state).toBe("unreachable");
    vi.spyOn(salaryLink, "fetchSalaryTotals").mockResolvedValue({
      state: "in",
      totals: { months: [{ month: today.slice(0, 7), cost_paise: 1_000_000, people: 2 }], paid: [{ date: today, paise: 600_000 }], advances: [{ date: yesterday, paise: 200_000 }], last_paid_month: today.slice(0, 7) },
    });
    const c = await businessCharts(a.owner, days());
    expect(c.salary).toEqual({ state: "in", lastPaidMonth: today.slice(0, 7) });
    expect([rs(c.totals.expenses), rs(c.totals.moneyOut)]).toEqual([2660 + 10000, 660 + 6000 + 2000]);
    expect(c.expenses.groups.find((g) => g.name === "Salary")!.values.map(rs)).toEqual([0, 10000]); // on the month's end, cut to the period
    expect(c.money.out.map(rs)).toEqual([2000, 660 + 6000]);
    const o = await businessOverview(a.owner, readOverviewParams({}));
    expect([rs(o.totals.expense), o.salary.state]).toEqual([2660 + 10000, "in"]);
    vi.spyOn(salaryLink, "fetchSalaryTotals").mockResolvedValue({ state: "off" });
    expect((await businessCharts(a.owner, days())).salary.state).toBe("off");
    vi.restoreAllMocks();
  });

  it("owner only (support reads); Accounts, Order desk and staff are refused; plant B sees nothing", async () => {
    expect(rs((await businessCharts(a.support, days())).totals.sales)).toBe(900);
    for (const who of [acct, a.desk, a.staff, a.keeper]) {
      expect((await refused(() => businessCharts(who, days()))).status).toBe(403);
      expect((await refused(() => businessOverview(who, readOverviewParams({})))).status).toBe(403);
    }
    const c = await businessCharts(b.owner, days());
    expect([c.totals.sales, c.totals.expenses, c.totals.moneyIn, c.totals.moneyOut, ...c.owed]).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);
  });
});

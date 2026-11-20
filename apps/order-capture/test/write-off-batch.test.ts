// Owner 2026-11-20: write off a customer's dues (owner only, no undo, a later payment is an advance); the bottles'
// batch no. on Mark delivered (migration 0027, replaces the Zoho invoice no. box); Business Overview's one-month view.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeliverInput, deliverOrder, getOrder, ReasonInput, undoDelivered } from "@/server/handling";
import { account, billDetail, billsList, istToday, receivePayment, writeOff, writeOffsReport } from "@/server/ledger";
import { makeBill } from "@/server/bill-make";
import { listCustomers } from "@/server/customers";
import { exportCsv, listOrders } from "@/server/list";
import { createOrder, lookupCustomer, OrderInput } from "@/server/orders";
import { overviewMonths, readOverviewParams } from "@/server/business";
import { buildOverview } from "@/lib/business";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, dbError, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const [b1l, b500] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0]];
let k = 0;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

type P = ReturnType<typeof plant>;
/** 500ml 1 box × 90 + 1L 2 box × 140 = ₹370 */
const order = (p: P) =>
  createOrder(p.desk, OrderInput.parse({
    request_key: `wo-${Date.now()}-${++k}`,
    customer: { phone: "9876543210", name: "Maa Tarini Store", place: "Bhanjanagar" },
    lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b1l.id, quantity: 2, rate: "140" }],
  }));
const deliver = (p: P, id: string, batch_no?: string) => deliverOrder(p.desk, id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, batch_no }));

describe("write off a customer's dues", () => {
  const a = plant();
  const b = plant();
  const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
  const today = istToday();
  let customerId = "";
  const bills: string[] = [];

  it("setup: two delivered orders billed at ₹370 each; ₹100 paid on the first", async () => {
    for (let i = 0; i < 2; i++) {
      const o = await order(a);
      await deliver(a, o.id);
      bills.push((await makeBill(acct, { order_id: o.id })).id);
    }
    customerId = ((await asApp(a.tenantId, "select id from order_capture.customers")).rows[0] as { id: string }).id;
    await receivePayment(acct, { customer_id: customerId, amount: "100", payment_date: today, mode: "cash", bill_ids: [bills[0]!] });
    expect((await account(a.owner, { kind: "customer", id: customerId })).totals.due).toBe("640.00");
  });

  it("only the owner writes off; not Order desk, Accounts or support", async () => {
    const input = { bill_ids: bills, written_off_on: today, reason: "shop closed" };
    for (const who of [a.desk, acct, a.support, a.staff]) expect((await refused(() => writeOff(who, customerId, input))).status).toBe(403);
  });

  it("refuses a future date, a bill dated after the write-off, and an empty reason", async () => {
    expect((await refused(() => writeOff(a.owner, customerId, { bill_ids: bills, written_off_on: "2999-01-01", reason: "shop closed" }))).status).toBe(400);
    expect((await refused(() => writeOff(a.owner, customerId, { bill_ids: bills, written_off_on: "2020-01-01", reason: "shop closed" }))).message).toMatch(/is dated after the write-off date/);
  });

  it("writes off what each bill still owes; the bills show Written off and nothing is due", async () => {
    const done = await writeOff(a.owner, customerId, { bill_ids: bills, written_off_on: today, reason: "shop closed" });
    expect(done).toEqual({ amount: "640.00", bills: ["B-0001", "B-0002"] });
    const rows = (await asApp(a.tenantId, "select kind, amount::text, reason from order_capture.bill_adjustments order by amount")).rows;
    expect(rows).toEqual([
      { kind: "write_off", amount: "270.00", reason: "shop closed" },
      { kind: "write_off", amount: "370.00", reason: "shop closed" },
    ]);
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    expect(acc.totals).toMatchObject({ due: "0.00", written_off: "640.00", balance: "0.00" });
    expect(acc.bills.map((x) => [x.number, x.status, x.written_off])).toEqual([
      ["B-0002", "written_off", "370.00"],
      ["B-0001", "written_off", "270.00"],
    ]);
    expect(acc.open_bills).toEqual([]);
    expect(acc.statement.rows.filter((r) => r.kind === "write_off").map((r) => [r.number, r.credit])).toEqual([["B-0001", "270.00"], ["B-0002", "370.00"]]);
    expect(acc.timeline[0]!.text).toBe("Written off ₹640.00 (2 bills): shop closed");
    expect((await billDetail(a.owner, bills[0]!)).status).toBe("written_off");
  });

  it("a written-off bill can't be written off again or paid; a later payment stays as advance", async () => {
    expect((await refused(() => writeOff(a.owner, customerId, { bill_ids: [bills[0]!], written_off_on: today, reason: "again" }))).status).toBe(409);
    await receivePayment(acct, { customer_id: customerId, amount: "200", payment_date: today, mode: "upi", bill_ids: [] });
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    expect(acc.totals).toMatchObject({ due: "0.00", advance: "200.00", written_off: "640.00" });
  });

  it("Bills list: a Written off filter; Paid leaves them out", async () => {
    expect((await billsList(a.owner, { show: "written_off" })).bills.map((x) => [x.number, x.status])).toEqual([["B-0002", "written_off"], ["B-0001", "written_off"]]);
    expect((await billsList(a.owner, { show: "paid" })).bills).toEqual([]);
    expect((await billsList(a.owner, { show: "open" })).bills).toEqual([]);
  });

  it("customer list tag for the owner only; New order warns Order desk", async () => {
    expect((await listCustomers(a.owner)).writtenOff).toEqual({ [customerId]: "640.00" });
    expect((await listCustomers(a.desk)).writtenOff).toBeNull();
    expect((await lookupCustomer(a.desk, "9876543210")).written_off).toEqual({ amount: "640.00", on: today });
  });

  it("Reports → Written off: owner and support; one row per write-off", async () => {
    const range = { from: "2000-01-01", to: today };
    const r = await writeOffsReport(a.owner, range);
    expect(r.total).toBe("640.00");
    expect(r.rows.map((x) => [x.name, x.bills, x.reason, x.by, x.amount, x.customer_id])).toEqual([["Maa Tarini Store", "B-0001, B-0002", "shop closed", "Sujata", "640.00", customerId]]);
    expect((await writeOffsReport(a.support, range)).total).toBe("640.00");
    expect((await refused(() => writeOffsReport(a.desk, range))).status).toBe(403);
  });

  it("another plant sees and changes nothing", async () => {
    expect((await refused(() => writeOff(b.owner, customerId, { bill_ids: bills, written_off_on: today, reason: "shop closed" }))).status).toBe(404);
    expect((await writeOffsReport(b.owner, { from: "2000-01-01", to: today })).rows).toEqual([]);
  });
});

describe("batch no. on Mark delivered", () => {
  const p = plant();

  it("saved in capitals on the order, its history, the list and the CSV; Undo clears the order but not the history", async () => {
    const o = await order(p);
    await deliver(p, o.id, "  pv144 ");
    let d = await getOrder(p.owner, o.id);
    expect(d.delivered?.batch_no).toBe("PV144");
    expect(d.events.find((e) => e.kind === "delivered")?.batch_no).toBe("PV144");
    expect((await listOrders(p.owner, { tab: "delivered" })).orders[0]!.batch_no).toBe("PV144");
    expect((await exportCsv(p.owner)).trim().split("\r\n")[1]).toMatch(/,PV144$/);
    await undoDelivered(p.owner, o.id, ReasonInput.parse({ expected: { status: "delivered", version: 1 }, reason: "marked by mistake" }));
    d = await getOrder(p.owner, o.id);
    expect(d.delivered).toBeNull();
    expect((await asApp(p.tenantId, `select batch_no from order_capture.orders where id = '${o.id}'`)).rows[0]).toEqual({ batch_no: null });
    expect(d.events.find((e) => e.kind === "delivered")?.batch_no).toBe("PV144");
  });

  it("optional; a mixed load may list two; other characters are refused", () => {
    const parse = (batch_no?: string) => DeliverInput.safeParse({ expected: { status: "pending", version: 1 }, batch_no });
    expect(parse(undefined).success).toBe(true);
    expect(parse("").success).toBe(true);
    expect(parse("pv144, pv145").data?.batch_no).toBe("PV144, PV145");
    expect(parse("PV#144").success).toBe(false);
    expect(parse("A".repeat(41)).success).toBe(false);
  });

  it("the database refuses a batch on an order that isn't delivered, or in small letters", async () => {
    // the order put back to Pending above (one pending order per customer)
    const o = (await asApp(p.tenantId, "select id from order_capture.orders where status = 'pending'")).rows[0] as { id: string };
    expect(await dbError(asApp(p.tenantId, `update order_capture.orders set batch_no = 'PV1' where id = '${o.id}'`))).toMatch(/orders_batch_only_delivered/);
    await deliver(p, o.id);
    expect(await dbError(asApp(p.tenantId, `update order_capture.orders set batch_no = 'pv1' where id = '${o.id}'`))).toMatch(/check constraint/);
  });
});

describe("Business Overview: one month, day by day", () => {
  it("reads the month from the address; a bad or future month = this month; this month ends today", () => {
    expect(readOverviewParams({ period: "month", month: "2026-10" }, "2026-11-20")).toMatchObject({ period: "month", month: "2026-10", from: "2026-10-01", to: "2026-10-31", by: "day" });
    expect(readOverviewParams({ period: "month", month: "2026-11" }, "2026-11-20")).toMatchObject({ from: "2026-11-01", to: "2026-11-20" });
    expect(readOverviewParams({ period: "month", month: "2026-13" }, "2026-11-20")).toMatchObject({ month: "2026-11" });
    expect(readOverviewParams({ period: "month", month: "2027-01" }, "2026-11-20")).toMatchObject({ month: "2026-11" });
    expect(readOverviewParams({}, "2026-11-20")).toMatchObject({ period: "last_12", by: "month" });
  });

  it("offers this month back to the first records", () => {
    expect(overviewMonths("2026-11-20", "2026-02-03")).toEqual(["2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02"]);
    expect(overviewMonths("2026-01-05", null)).toEqual(["2026-01"]);
  });

  it("a bar per day", () => {
    const o = buildOverview(
      { sales: [], expenses: [], money: [{ date: "2026-10-05", dir: "in", amount: 50000n } as never, { date: "2026-10-07", dir: "out", amount: 20000n } as never] },
      { from: "2026-10-01", to: "2026-10-31", basis: "payment", by: "day" },
    );
    expect(o.buckets).toHaveLength(31);
    expect(o.cash.running[4]).toBe(50000n);
    expect(o.cash.end).toBe(30000n);
  });
});

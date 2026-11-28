// Plant answers Phases 2–3 on real rows (docs/MORNING_REPORT_PHASE_PLAN.md): each money and order card against the
// report it comes from on the same rows (Customer Balances, Business charts, the cash day sheet, the Day report, the
// Pending tab), Floor Stock's last count through a lookup ticket (in / off), who may open each card, and the copied text
// (no amounts, no phones; M4 and M6 never copied).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantSku } from "@plantops/types";
import { allFields, CARDS, isBuilt } from "@/lib/answers/cards";
import { leakIn } from "@/lib/answers/copy";
import { makeBill } from "@/server/bill-make";
import { businessCharts, readChartParams } from "@/server/business";
import { addEntry, cashLists, closeDay, daySheet, startCashBook } from "@/server/cash";
import { copyFor, runCard } from "@/server/answers";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { kit } from "@/server/kit";
import { ReceivePaymentInput, receivePayment } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { readRecParams, receivablesReport } from "@/server/reports";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Anmol");
const [b1l] = SKUS as [TenantSku];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const before = process.env.PLANT_ANSWERS_PLANTS;
let unit = "box";

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  process.env.PLANT_ANSWERS_PLANTS = `${a.tenantId},${b.tenantId}`;
  // billed and delivered: 10 × ₹90 = ₹900; ₹400 cash + ₹100 UPI today → owes ₹400
  const o = await createOrder(a.desk, OrderInput.parse({ request_key: `ans-${Date.now()}`, customer: { phone: "9876543210", name: "Sri ram hotel", place: "Bijepur" }, lines: [{ sku_id: b1l.id, quantity: 10, rate: "90" }] }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  await makeBill(acct, { order_id: o.id });
  const sri = ((await asApp(a.tenantId, `select id from order_capture.customers where tenant_id = '${a.tenantId}' and phone = '9876543210'`)).rows[0] as { id: string }).id;
  await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: sri, amount: "400", payment_date: today, mode: "cash" }));
  await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: sri, amount: "100", payment_date: today, mode: "upi" }));
  // one order pending for 3 days (5 boxes), one entered now
  const late = await createOrder(a.desk, OrderInput.parse({ request_key: `ans2-${Date.now()}`, customer: { phone: "9876543211", name: "Maa Tarini", place: "Sason" }, lines: [{ sku_id: b1l.id, quantity: 5, rate: "90" }] }));
  await asOwner(`update order_capture.orders set created_at = now() - interval '3 days' where id = $1`, [late.id]);
  await createOrder(a.desk, OrderInput.parse({ request_key: `ans3-${Date.now()}`, customer: { phone: "9876543212", name: "Jena Kirana", place: "sason " }, lines: [{ sku_id: b1l.id, quantity: 2, rate: "90" }] }));
  unit = ((await asApp(a.tenantId, `select unit from order_capture.order_lines where tenant_id = '${a.tenantId}' and order_id = '${late.id}'`)).rows[0] as { unit: string }).unit;
  // the cash book started yesterday with ₹5,000; ₹160 diesel today, not closed yet
  await startCashBook(a.owner, { date: yesterday, counted: "5000" }, today);
  vi.spyOn(kit, "contacts").mockResolvedValue([]);
  const diesel = (await cashLists(a.owner)).categories.find((c) => c.name === "Diesel")!;
  await addEntry(acct, { kind: "expense", amount: "160", cash_date: today, category_id: diesel.id }, today);
  vi.restoreAllMocks();
  // Floor Stock answers for plant a: 3 boxes of the product left (7 needed); plant b has it off
  platform.stockLevels.set(a.tenantId, { counted_on: yesterday, counted_at: `${yesterday}T13:10:00.000Z`, items: [{ sku_id: b1l.id, name: "Bluemins 1 L", unit, closing: 3 }] });
});
afterAll(async () => {
  await platform.close();
  if (before === undefined) delete process.env.PLANT_ANSWERS_PLANTS;
  else process.env.PLANT_ANSWERS_PLANTS = before;
});

describe("money cards against their reports", () => {
  it("M1: customers owe = Receivables → Customer Balances (owe only, today), top customer first, phone for Call", async () => {
    const r = await runCard(a.owner, "M1", today);
    const { table } = await receivablesReport(a.owner, readRecParams("balances", { period: "custom", from: today, to: today }, today), today);
    expect(r.facts.totals.owed).toBe(table.total[3]);
    expect(r.facts.totals.owed).toBe(400_00n);
    expect(r.facts.rows[0]).toMatchObject({ customer: "Sri ram hotel", place: "Bijepur", due: 400_00n, oldest_days: 0, phone: "9876543210" });
    expect(r.sentence).toBe("1 customer owes ₹400 in all. Sri ram hotel owes the most: ₹400, oldest bill 0 days. Nobody is paying slower than usual.");
  });

  it("M3: this week's money in = Business charts' money in for Monday to today; cash and online apart", async () => {
    const r = await runCard(a.owner, "M3", today);
    const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const charts = await businessCharts(a.owner, readChartParams({ period: "custom", from: monday, to: today }, today));
    expect(r.facts.totals.total).toBe(charts.totals.moneyIn);
    expect(r.facts.totals).toMatchObject({ total: 500_00n, cash: 400_00n, online: 100_00n, van: 0n, payments: 2, cash_payments: 1, online_payments: 1 });
    expect(r.facts.lists!.biggest!.map((x) => x.amount)).toEqual([400_00n, 100_00n]);
  });

  it("M6 before the close: expected cash = the day sheet's; sold today = the Day report's rule", async () => {
    const r = await runCard(a.owner, "M6", today);
    const s = await daySheet(a.owner, today, today);
    if (!s.started) throw new Error("cash book should be started");
    expect(r.facts.totals.cash_state).toBe("Expected");
    expect(String(r.facts.totals.cash)).toBe(String(BigInt(s.expected!.replace(".", ""))));
    expect(r.facts.totals.last_count).toBe(5000_00n);
    expect(r.facts.totals).toMatchObject({ sold: 900_00n, bills: 1, vans: 0, not_billed: 0 });
    expect(r.sentence).toMatch(/^Cash in the box: about ₹[\d,]+ \(expected, not counted yet today\)\. Sold today so far: ₹900 from 1 bill and 0 van reports/);
    expect(copyFor(a.owner, r)).toBeNull();
  });

  it("M4 after a short close: the day sheet's difference, and the entries between the two closes", async () => {
    const s = await daySheet(a.owner, today, today);
    if (!s.started) throw new Error("cash book should be started");
    const expected = s.expected!;
    const counted = (Number(expected) - 40).toFixed(2);
    await closeDay(acct, { date: today, counted, reason: "Change given to van" }, today);
    const r = await runCard(a.owner, "M4", today);
    expect(r.facts.totals).toMatchObject({ state: "Short", close_date: today, difference: -40_00n, reason: "Change given to van" });
    expect(r.facts.rows.map((x) => [x.what, x.direction, x.amount])).toContainEqual(["Diesel", "Out", 160_00n]);
    expect(r.sentence).toMatch(/^Cash was short ₹40 at the close on /);
    expect(copyFor(a.owner, r)).toBeNull();
    // and M6 now says counted
    const m6 = await runCard(a.owner, "M6", today);
    expect(m6.facts.totals).toMatchObject({ cash_state: "Counted", cash: BigInt(counted.replace(".", "")) });
  });

  it("M5: this month (or last month early on) = Business charts' sales for the same dates, before GST", async () => {
    const r = await runCard(a.owner, "M5", today);
    const charts = await businessCharts(a.owner, readChartParams({ period: "custom", from: String(r.facts.totals.from), to: String(r.facts.totals.to) }, today));
    expect(r.facts.totals.now).toBe(charts.totals.sales);
    expect(r.facts.totals.last_year).toBeNull(); // no full records a year ago: not shown, never ₹0
  });
});

describe("order cards", () => {
  it("O1: the 3-day-old order is late; stock from Floor Stock's last count says what is short", async () => {
    const r = await runCard(a.owner, "O1", today);
    expect(r.facts.totals).toMatchObject({ late: 1, pending: 2, stock_on: yesterday });
    expect(r.facts.rows.map((x) => [x.customer, x.days])).toEqual([["Maa Tarini", 3]]);
    expect(String(r.facts.rows[0]!.stock)).toMatch(/^Short: /);
    expect(r.facts.lists!.stock).toEqual([{ product: expect.any(String), needed: 7, in_stock: 3, short: "4" }]);
    expect(platform.tickets.filter((t) => t.scope === "stock_levels").every((t) => t.to === "floor_stock" && t.tenantId === a.tenantId)).toBe(true);
  });
  it("O1 with Floor Stock off: the orders, \"Stock not checked\", and the reason said", async () => {
    const o = await createOrder(b.desk, OrderInput.parse({ request_key: `ansb-${Date.now()}`, customer: { phone: "9876543299", name: "Plant B shop", place: "Bargarh" }, lines: [{ sku_id: b1l.id, quantity: 1, rate: "90" }] }));
    await asOwner(`update order_capture.orders set created_at = now() - interval '5 days' where id = $1`, [o.id]);
    const r = await runCard(b.owner, "O1", today);
    expect(r.facts.rows.map((x) => [x.customer, x.stock])).toEqual([["Plant B shop", "Stock not checked"]]);
    expect(r.missing).toEqual(["Floor Stock is not switched on for this plant, so stock is not checked."]);
    expect(JSON.stringify(r.facts, (_, v) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/Maa Tarini|Sri ram/);
  });
  it("O4: places with their orders; \"Sason\" and \"sason \" are one place", async () => {
    const r = await runCard(a.owner, "O4", today, { period: "this_fy" });
    expect(r.facts.rows.map((x) => [x.place, x.orders, x.customers])).toEqual([["Sason", 2, 2], ["Bijepur", 1, 1]]);
    expect(r.choices?.picked).toBe("this_fy");
  });
  it("O5: search by name, then the customer's usual order (too few orders yet = said so)", async () => {
    const found = await runCard(a.owner, "O5", today, { q: "Sri" });
    expect(found.ready).toBe(false);
    const key = found.choices!.customers![0]!.key;
    const r = await runCard(a.owner, "O5", today, { q: "Sri", customer: key });
    expect(r.ready).toBe(true);
    expect(r.facts.totals.customer).toBe("Sri ram hotel (Bijepur)");
    expect(r.sentence).toBe("Sri ram hotel (Bijepur) has too few orders yet to tell a usual order.");
    // another plant's customer can't be asked for
    const other = await runCard(b.owner, "O5", today, { customer: key });
    expect(other.missing).toEqual(["No orders or bills for this customer yet."]);
  });
  it("O2 and O3 answer on a plant with little history without failing", async () => {
    expect((await runCard(a.owner, "O2", today)).facts.totals).toEqual({ late: 0, stopped: 0 });
    expect((await runCard(a.owner, "O3", today)).sentence).toBe("Nobody stopped buying any product.");
  });
});

describe("who may open them, and what Copy gives", () => {
  const built = CARDS.filter(isBuilt).map((c) => c.id);
  it("Accounts, Order desk and viewers are refused every card; support reads them without Copy", async () => {
    for (const id of built) {
      for (const u of [acct, a.desk, ocUser(a.tenantId, ["order_viewer"])]) expect((await refused(() => runCard(u, id, today))).status).toBe(403);
      const s = await runCard(a.support, id, today);
      expect(copyFor(a.support, s)).toBeNull();
    }
  });
  it("the owner's copied text never has an amount or a phone number; M4 and M6 have none", async () => {
    for (const id of built) {
      const r = await runCard(a.owner, id, today, id === "O5" ? { q: "Sri" } : {});
      const text = copyFor(a.owner, r);
      if (id === "M4" || id === "M6" || id === "O5") expect(text).toBeNull();
      else {
        expect(text, id).not.toBeNull();
        expect(leakIn(text!), id).toBeNull();
        expect(text).not.toMatch(/9876543210|9876543211/);
      }
    }
  });
  it("every fact on a built card says what it is", () => {
    for (const c of CARDS.filter(isBuilt)) for (const f of allFields(c)) expect(f.note).toBeTruthy();
  });
});

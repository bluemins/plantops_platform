// The sales ledger in daily use (docs/ZOHO_IMPORT_PHASE_PLAN.md sections 6–7): Make bill from a delivered order, Receive
// payment (oldest first / ticked / advance), the advance paying the next bill, cancel a bill or a payment (owner),
// "Closed" orders, Undo delivered refused while a bill is open, the GST invoice no., a customer's account and
// statement with an imported Zoho bill on a linked contact, the plant's lists; who may; another plant sees nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeliverInput, deliverOrder, ReasonInput, undoDelivered } from "@/server/handling";
import {
  account,
  billDetail,
  billsList,
  cancelBill,
  cancelPayment,
  makeBill,
  paymentsList,
  receivePayment,
  setGstInvoice,
} from "@/server/ledger";
import { listOrders } from "@/server/list";
import { paymentNotification } from "@/server/notify";
import { createOrder, OrderInput } from "@/server/orders";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, auditRows, plant, refused } from "./helpers";

let platform: FakePlatform;
const [b1l, b500] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0]];
const a = plant();
const b = plant();
let k = 0;
let customerId = "";

/** 500ml 1 box × 90 + 1L 2 box × 140 = ₹370, delivered. */
async function deliveredOrder() {
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `ledger-${Date.now()}-${++k}`,
    customer: { phone: "9876543210", name: "Sri ram hotel", place: "bijepur" },
    lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b1l.id, quantity: 2, rate: "140" }],
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  return o;
}
const pay = (amount: string, bill_ids: string[] = [], date = "2026-11-06", mode: "cash" | "upi" = "cash") =>
  receivePayment(a.desk, { customer_id: customerId, amount, payment_date: date, mode, bill_ids });

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

describe("make bill, receive payment, advances, cancel", () => {
  let o1: Awaited<ReturnType<typeof deliveredOrder>>;
  let zohoBill = "";

  it("setup: a delivered order, and an imported Zoho bill on a contact linked to the same customer", async () => {
    o1 = await deliveredOrder();
    customerId = (await asApp(a.tenantId, "select id from order_capture.customers")).rows[0]!.id as string;
    const one = async (q: string) => ((await asApp(a.tenantId, q)).rows[0] as { id: string }).id;
    const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${a.tenantId}', gen_random_uuid(), 'Sujata') returning id`);
    const contact = await one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, customer_id, import_id) values ('${a.tenantId}', 'zc1', 'Sriram Hotel (Bijepur)', '${customerId}', '${imp}') returning id`);
    zohoBill = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, due_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', 'INV-000500', 'zi-500', '2026-10-01', '2026-10-01', '${contact}', 'Sriram Hotel (Bijepur)', 500, 500, '${imp}', gen_random_uuid(), 'Sujata') returning id`);
  });

  it("only owner and Order desk make bills; only for a delivered order; one per order", async () => {
    expect((await refused(() => makeBill(a.staff, { order_id: o1.id }))).status).toBe(403);
    expect((await refused(() => makeBill(a.support, { order_id: o1.id }))).status).toBe(403);
    const bill = await makeBill(a.desk, { order_id: o1.id, discount: "20", zoho_gst_invoice_no: "INV-001900" });
    expect(bill).toMatchObject({ number: "B-0001", total: "350.00", advance_used: "0.00" });
    expect((await refused(() => makeBill(a.owner, { order_id: o1.id }))).message).toBe("This order already has bill B-0001.");
    const d = await billDetail(a.owner, bill.id);
    expect(d).toMatchObject({ source: "plantops", sub_total: "370.00", discount: "20.00", total: "350.00", due: "350.00", status: "due", gst_invoice_no: "INV-001900", order: { ref: o1.ref } });
    expect(d.lines.map((l) => [l.item, l.quantity, l.rate, l.total])).toEqual([
      [expect.stringContaining("500"), "1.000", "90.00", "90.00"],
      [expect.stringContaining("1"), "2.000", "140.00", "280.00"],
    ]);
  });

  it("a pending order can't get a bill", async () => {
    const p = await createOrder(a.desk, OrderInput.parse({ request_key: `ledger-p-${Date.now()}`, customer: { phone: "9876543210", name: "x", place: "y" }, lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }] }));
    expect((await refused(() => makeBill(a.owner, { order_id: p.id }))).status).toBe(409);
  });

  it("a payment pays the oldest bill first (the Zoho one), then the next; notifications say so", async () => {
    const p = await pay("600");
    expect(p).toMatchObject({ number: "P-0001", bills: ["INV-000500", "B-0001"], advance: "0.00" });
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    expect(acc.totals).toMatchObject({ billed: "850.00", received: "600.00", due: "250.00", advance: "0.00", balance: "250.00" });
    expect(acc.bills.map((x) => [x.number, x.status, x.due])).toEqual([["B-0001", "part_paid", "250.00"], ["INV-000500", "paid", "0.00"]]);
    expect(acc.zoho_names).toEqual(["Sriram Hotel (Bijepur)"]);
    const n = paymentNotification(a.desk, p);
    expect(n).toMatchObject({ kind: "order_capture.payment", title: "Payment ₹600 from Sri ram hotel", level: "bell", exclude_user_id: a.desk.userId });
    expect(n.body).toContain("Paid INV-000500, B-0001");
  });

  it("more than is due stays as advance, and the next bill uses it; the order shows Closed when its bill is paid", async () => {
    const p = await pay("300", [], "2026-11-06", "upi");
    expect(p).toMatchObject({ bills: ["B-0001"], advance: "50.00" });
    const list = await listOrders(a.owner, { tab: "delivered" });
    expect(list.orders.find((x) => x.id === o1.id)?.closed).toBe(true);
    expect((await listOrders(a.staff, { tab: "delivered" })).orders.find((x) => x.id === o1.id)?.closed).toBeUndefined();
    const o2 = await deliveredOrder();
    const bill2 = await makeBill(a.owner, { order_id: o2.id });
    expect(bill2).toMatchObject({ number: "B-0002", total: "370.00", advance_used: "50.00" });
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    expect(acc.totals).toMatchObject({ due: "320.00", advance: "0.00" });
    expect(acc.orders.find((x) => x.id === o1.id)?.status).toBe("closed");
  });

  it("ticked bills only; a future date or someone else's bill is refused", async () => {
    expect((await refused(() => pay("10", [], "2099-01-01"))).status).toBe(400);
    const other = (await asApp(a.tenantId, "select id from order_capture.bills where number = 'INV-000500'")).rows[0]!.id as string;
    expect((await refused(() => pay("10", [other]))).status).toBe(409); // already paid
    expect((await refused(() => receivePayment(a.staff, { customer_id: customerId, amount: "10", payment_date: "2026-11-06", mode: "cash", bill_ids: [] }))).status).toBe(403);
  });

  it("owner cancels a payment: the bills it paid are due again; Order desk can't", async () => {
    const p = (await asApp(a.tenantId, "select id from order_capture.payments where number = 'P-0002'")).rows[0]!.id as string;
    expect((await refused(() => cancelPayment(a.desk, p, { reason: "typed twice" }))).status).toBe(403);
    await cancelPayment(a.owner, p, { reason: "typed twice" });
    expect((await refused(() => cancelPayment(a.owner, p, { reason: "again" }))).status).toBe(409);
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    // P-0002 paid ₹250 on B-0001 and ₹50 (as advance) on B-0002: both due again
    expect(acc.totals).toMatchObject({ received: "600.00", due: "620.00" });
    expect(acc.payments.find((x) => x.number === "P-0002")).toMatchObject({ cancelled: true, cancel_reason: "typed twice", unused: "0.00" });
  });

  it("Undo delivered is refused while the order has a bill; owner cancels the bill (payments freed as advance), then undo works", async () => {
    const undo = () => undoDelivered(a.owner, o1.id, ReasonInput.parse({ expected: { status: "delivered", version: 1 }, reason: "wrong customer" }));
    expect((await refused(undo)).message).toBe("This order has bill B-0001. Cancel the bill first, then undo the delivery.");
    const bill1 = (await asApp(a.tenantId, "select id from order_capture.bills where number = 'B-0001'")).rows[0]!.id as string;
    expect((await refused(() => cancelBill(a.desk, bill1, { reason: "wrong customer" }))).status).toBe(403);
    await cancelBill(a.owner, bill1, { reason: "wrong customer" });
    const acc = await account(a.owner, { kind: "customer", id: customerId });
    // P-0001 had paid ₹100 on B-0001: now an advance
    expect(acc.totals).toMatchObject({ advance: "100.00" });
    expect(acc.bills.find((x) => x.number === "B-0001")?.status).toBe("cancelled");
    await undo();
    // a new bill can be made after the order is delivered again
    await deliverOrder(a.owner, o1.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
    expect((await makeBill(a.owner, { order_id: o1.id })).advance_used).toBe("100.00");
  });

  it("the GST invoice no. on a PlantOps bill; audit rows", async () => {
    const bill2 = (await asApp(a.tenantId, "select id from order_capture.bills where number = 'B-0002'")).rows[0]!.id as string;
    await setGstInvoice(a.desk, bill2, { zoho_gst_invoice_no: "INV-001901" });
    expect((await billDetail(a.owner, bill2)).gst_invoice_no).toBe("INV-001901");
    const actions = (await auditRows(a.tenantId)).map((r) => r.action);
    for (const x of ["bill.make", "payment.receive", "payment.cancel", "bill.cancel", "bill.gst_invoice"]) expect(actions).toContain(x);
  });

  it("statement: running balance; a date range starts from what was owed before", async () => {
    const all = await account(a.owner, { kind: "customer", id: customerId });
    expect(all.statement.rows[0]).toMatchObject({ date: "2026-10-01", kind: "bill", number: "INV-000500", balance: "500.00" });
    expect(all.statement.closing).toBe(all.totals.balance);
    const later = await account(a.owner, { kind: "customer", id: customerId }, { from: "2026-10-02" });
    expect(later.statement.opening).toBe("500.00");
  });

  it("the plant's lists: due total, filters, search; payments with modes", async () => {
    const open = await billsList(a.owner, { show: "open" });
    expect(open.bills.every((x) => x.due !== "0.00")).toBe(true);
    expect(Number(open.summary!.due)).toBeGreaterThan(0);
    expect((await billsList(a.owner, { show: "cancelled" })).bills.map((x) => x.number)).toEqual(["B-0001"]);
    expect((await billsList(a.owner, { show: "all", q: "INV-000500" })).bills.map((x) => x.name)).toEqual(["Sri ram hotel"]);
    const pays = await paymentsList(a.owner, { mode: "upi" });
    expect(pays.payments.map((x) => [x.number, x.cancelled])).toEqual([["P-0002", true]]);
    expect(pays.total!.sum).toBe("0.00");
    // the plant's totals: owner (and support) only, never Order desk
    expect((await billsList(a.desk)).summary).toBeNull();
    expect((await paymentsList(a.desk)).total).toBeNull();
    expect((await billsList(a.support)).summary).not.toBeNull();
    expect((await refused(() => billsList(a.staff))).status).toBe(403);
    expect((await billsList(a.support)).bills.length).toBeGreaterThan(0);
  });

  it("another plant sees nothing and can't act on plant A's rows", async () => {
    expect((await billsList(b.owner, { show: "all" })).bills).toEqual([]);
    expect((await refused(() => account(b.owner, { kind: "customer", id: customerId }))).status).toBe(404);
    expect((await refused(() => makeBill(b.owner, { order_id: o1.id }))).status).toBe(404);
  });
});

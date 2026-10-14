// Handling an order: Change (versions), Mark delivered, Cancel (final), Undo delivered (owner only); every change
// checks what the person saw (409 if it changed); who may; reasons; totals after a change.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as changeRoute } from "@/app/api/orders/[id]/change/route";
import { POST as deliverRoute } from "@/app/api/orders/[id]/deliver/route";
import { cancelOrder, ChangeInput, changeOrder, DeliverInput, deliverOrder, getOrder, ReasonInput, undoDelivered } from "@/server/handling";
import { createOrder, lookupCustomer, OrderInput } from "@/server/orders";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, dbError, asApp, jsonReq, plant, refused, signInAs } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.skus = SKUS;
});

const [b1l, b500, jar] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];
type U = Parameters<typeof createOrder>[0];
let k = 0;
/** The sample order, as the Order desk enters it: 500ml 1 box × 90 + 1ltr 2 box × 140 = ₹370. */
async function sample(p: ReturnType<typeof plant>, phone = "9876543210") {
  return createOrder(p.desk, OrderInput.parse({ request_key: `handling-${Date.now()}-${++k}`, customer: { phone, name: "Sri ram hotel", place: "bijepur" }, lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b1l.id, quantity: 2, rate: "140" }] }));
}
const seen = (status: "pending" | "delivered" | "cancelled", version = 1) => ({ status, version });
const change = (u: U, id: string, version: number, lines: { sku_id: string; quantity: number; rate: string }[]) => changeOrder(u, id, ChangeInput.parse({ expected: seen("pending", version), lines }));
const deliver = (u: U, id: string, over: { note?: string; invoice_no?: string; version?: number } = {}) => deliverOrder(u, id, DeliverInput.parse({ expected: seen("pending", over.version ?? 1), note: over.note, invoice_no: over.invoice_no }));
const cancel = (u: U, id: string, reason = "customer changed mind", version = 1) => cancelOrder(u, id, ReasonInput.parse({ expected: seen("pending", version), reason }));
const undo = (u: U, id: string, reason = "marked by mistake", version = 1) => undoDelivered(u, id, ReasonInput.parse({ expected: seen("delivered", version), reason }));
const counts = async (orderId: string) =>
  (await asOwner<{ lines: number; events: number }>("select (select count(*)::int from order_capture.order_lines where order_id = $1) as lines, (select count(*)::int from order_capture.order_events where order_id = $1) as events", [orderId])).rows[0]!;

describe("Change: a new version of the lines", () => {
  it("1ltr 2 → 3 box: version 2, total ₹370 → ₹510, version 1 kept, 'changed' event", async () => {
    const p = plant();
    const o = await sample(p);
    expect(await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b1l.id, quantity: 3, rate: "140" }])).toEqual({ changed: true, version: 2, total: "510.00" });
    const d = await getOrder(p.owner, o.id);
    expect([d.version, d.total, d.lines.map((l) => l.quantity)]).toEqual([2, "510.00", [1, 3]]);
    expect(d.versions.map((v) => [v.version, v.total])).toEqual([
      [1, "370.00"],
      [2, "510.00"],
    ]);
    expect(d.events.map((e) => [e.kind, e.version, e.by])).toEqual([
      ["created", 1, "Atharv"],
      ["changed", 2, "Atharv"],
    ]);
  });

  it("two changes keep versions 1–3; added / removed products and decimals add up exactly", async () => {
    const p = plant();
    const o = await sample(p);
    await change(p.owner, o.id, 1, [{ sku_id: b500.id, quantity: 3, rate: "33.33" }]);
    await change(p.desk, o.id, 2, [{ sku_id: b500.id, quantity: 3, rate: "33.33" }, { sku_id: jar.id, quantity: 6, rate: "50" }]);
    const d = await getOrder(p.desk, o.id);
    expect(d.versions.map((v) => [v.version, v.lines.length, v.total])).toEqual([
      [1, 2, "370.00"],
      [2, 1, "99.99"],
      [3, 2, "399.99"],
    ]);
    expect(d.total).toBe("399.99");
    expect(d.lines.map((l) => [l.product, l.unit])).toEqual([
      ["Bluemins (500 ml × 24)", "box"],
      ["Jar (20 L)", "jar"],
    ]);
  });

  it("the same lines again write nothing; the next pre-fill reads the new version", async () => {
    const p = plant();
    const o = await sample(p);
    expect(await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 1, rate: "90.00" }, { sku_id: b1l.id, quantity: 2, rate: "140" }])).toEqual({ changed: false, version: 1, total: "370.00" });
    expect(await counts(o.id)).toEqual({ lines: 2, events: 1 });
    await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 1, rate: "95" }, { sku_id: b1l.id, quantity: 2, rate: "140" }]);
    expect((await lookupCustomer(p.desk, "9876543210")).last_rates[b500.id]).toBe("95.00");
  });

  it("a product switched off in PlantOps since can stay (same name / unit), but can't be newly added", async () => {
    const p = plant();
    const o = await sample(p);
    // the order also holds a product that is no longer an active PlantOps product (switched off since)
    const gone = crypto.randomUUID();
    await asApp(p.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total) values ('${p.tenantId}', '${o.id}', 2, 1, '${gone}', 'Old 2L', 'bottle', 4, 30, 120)`);
    await asApp(p.tenantId, `update order_capture.orders set version = 2, total = 120 where id = '${o.id}'`);
    expect((await change(p.desk, o.id, 2, [{ sku_id: gone, quantity: 5, rate: "30" }, { sku_id: jar.id, quantity: 1, rate: "50" }])).total).toBe("200.00");
    const d = await getOrder(p.desk, o.id);
    expect(d.lines.map((l) => [l.product, l.unit, l.quantity])).toEqual([
      ["Old 2L", "bottle", 5],
      ["Jar (20 L)", "jar", 1],
    ]);
    expect(await refused(() => change(p.desk, o.id, 3, [{ sku_id: crypto.randomUUID(), quantity: 1, rate: "1" }]))).toEqual({
      status: 400,
      message: "One of the products is not an active product of this plant. Reload the page and try again.",
    });
  });
});

describe("Mark delivered, Cancel, Undo delivered", () => {
  it("delivered with a note and invoice no.; the owner's undo puts it back to Pending, the note stays in the history", async () => {
    const p = plant();
    const o = await sample(p);
    await deliver(p.desk, o.id, { note: "80 delivered, 20 next trip", invoice_no: "INV-000123" });
    let d = await getOrder(p.owner, o.id);
    expect([d.status, d.delivered]).toEqual(["delivered", { by: "Atharv", at: expect.any(String), note: "80 delivered, 20 next trip", invoice_no: "INV-000123" }]);
    await undo(p.owner, o.id, "marked by mistake");
    d = await getOrder(p.owner, o.id);
    expect([d.status, d.delivered]).toEqual(["pending", null]);
    expect(d.events.map((e) => [e.kind, e.text, e.invoice_no])).toEqual([
      ["created", null, null],
      ["delivered", "80 delivered, 20 next trip", "INV-000123"],
      ["undelivered", "marked by mistake", null],
    ]);
    // pending again: it can be changed and delivered again
    expect((await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 2, rate: "90" }])).version).toBe(2);
    await deliver(p.desk, o.id, { version: 2 });
    expect((await getOrder(p.desk, o.id)).status).toBe("delivered");
  });

  it("an empty note and invoice no. are fine; over 300 / 40 characters is refused", () => {
    expect(DeliverInput.safeParse({ expected: seen("pending"), note: "x".repeat(301) }).success).toBe(false);
    expect(DeliverInput.safeParse({ expected: seen("pending"), invoice_no: "x".repeat(41) }).success).toBe(false);
    expect(DeliverInput.safeParse({ expected: seen("pending"), note: "", invoice_no: "" }).success).toBe(true);
  });

  it("cancel needs a reason and is final", async () => {
    const p = plant();
    const o = await sample(p);
    expect(ReasonInput.safeParse({ expected: seen("pending"), reason: "" }).success).toBe(false);
    expect(ReasonInput.safeParse({ expected: seen("pending"), reason: " ok " }).success).toBe(false);
    await cancel(p.desk, o.id, "customer changed mind");
    const d = await getOrder(p.desk, o.id);
    expect([d.status, d.events.at(-1)!.text]).toEqual(["cancelled", "customer changed mind"]);
    for (const attempt of [
      () => deliverOrder(p.owner, o.id, { expected: seen("cancelled") }),
      () => changeOrder(p.owner, o.id, { expected: seen("cancelled"), lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }] }),
      () => undoDelivered(p.owner, o.id, { expected: seen("cancelled"), reason: "please" }),
      () => cancelOrder(p.owner, o.id, { expected: seen("cancelled"), reason: "again" }),
    ]) {
      expect(await refused(attempt)).toEqual({ status: 409, message: "O-0001 is cancelled, so this can't be done." });
    }
  });

  it("the database refuses a cancel or undo event without a reason too", async () => {
    const p = plant();
    const o = await sample(p);
    expect(await dbError(asApp(p.tenantId, `insert into order_capture.order_events (tenant_id, order_id, kind, version, created_by, created_by_name) values ('${p.tenantId}', '${o.id}', 'cancelled', 1, gen_random_uuid(), 'x')`))).toMatch(/check constraint/);
  });

  it("no change after delivery: change / deliver / cancel → 409 until the owner undoes it", async () => {
    const p = plant();
    const o = await sample(p);
    await deliver(p.desk, o.id);
    expect(await refused(() => changeOrder(p.owner, o.id, { expected: seen("delivered"), lines: [{ sku_id: b500.id, quantity: 9, rate: "90" }] }))).toEqual({
      status: 409,
      message: "O-0001 is already delivered, so this can't be done.",
    });
    expect((await refused(() => cancelOrder(p.owner, o.id, { expected: seen("delivered"), reason: "too late" }))).status).toBe(409);
    expect((await refused(() => deliverOrder(p.owner, o.id, { expected: seen("delivered") }))).status).toBe(409);
    expect(await counts(o.id)).toEqual({ lines: 2, events: 2 });
  });
});

describe("409 when the order changed since it was opened", () => {
  it("two people act on the same version: the second gets 'just changed by …', nothing written", async () => {
    const p = plant();
    const o = await sample(p);
    await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 2, rate: "90" }]);
    expect(await refused(() => change(p.owner, o.id, 1, [{ sku_id: b500.id, quantity: 7, rate: "90" }]))).toEqual({ status: 409, message: "This order was just changed by Atharv. Please reload." });
    expect(await refused(() => deliver(p.owner, o.id))).toEqual({ status: 409, message: "This order was just changed by Atharv. Please reload." });
    expect(await refused(() => cancel(p.owner, o.id))).toMatchObject({ status: 409 });
    await deliver(p.owner, o.id, { version: 2 });
    expect(await refused(() => cancel(p.desk, o.id, "x y z", 2))).toEqual({ status: 409, message: "This order was just changed by Sujata. Please reload." });
    expect(await refused(() => undo(p.owner, o.id, "oops", 1))).toMatchObject({ status: 409 });
    expect(await counts(o.id)).toEqual({ lines: 3, events: 3 });
  });

  it("at the same moment, only one of two changes wins", async () => {
    const p = plant();
    const o = await sample(p);
    const results = await Promise.allSettled([deliver(p.desk, o.id), cancel(p.owner, o.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await counts(o.id)).toEqual({ lines: 2, events: 2 });
  });

  it("through the API: 409 with the plain message; a body for another order's id is not found", async () => {
    const p = plant();
    const o = await sample(p);
    signInAs(p.desk);
    const ok = await deliverRoute(jsonReq("POST", `/api/orders/${o.id}/deliver`, { expected: seen("pending") }), { params: Promise.resolve({ id: o.id }) });
    expect(ok.status).toBe(200);
    const stale = await changeRoute(jsonReq("POST", `/api/orders/${o.id}/change`, { expected: seen("pending"), lines: [{ sku_id: b500.id, quantity: 1, rate: "1" }] }), { params: Promise.resolve({ id: o.id }) });
    expect([stale.status, (await stale.json()).error]).toEqual([409, "This order was just changed by Atharv. Please reload."]);
    const other = plant();
    const theirs = await sample(other);
    expect((await deliverRoute(jsonReq("POST", "/x", { expected: seen("pending") }), { params: Promise.resolve({ id: theirs.id }) })).status).toBe(404);
  });
});

describe("who may", () => {
  it("owner and Order desk change, deliver and cancel; only the owner undoes; support, plant staff and a store keeper never", async () => {
    const p = plant();
    const o = await sample(p);
    for (const u of [p.support, p.staff, p.keeper]) {
      expect((await refused(() => deliver(u, o.id))).status).toBe(403);
      expect((await refused(() => cancel(u, o.id))).status).toBe(403);
      expect((await refused(() => change(u, o.id, 1, [{ sku_id: b500.id, quantity: 1, rate: "1" }]))).status).toBe(403);
    }
    expect(await refused(() => deliver(p.support, o.id))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    await deliver(p.desk, o.id);
    expect(await refused(() => undo(p.desk, o.id))).toEqual({ status: 403, message: "Only the plant owner can do this" });
    await undo(p.owner, o.id);
    expect((await getOrder(p.support, o.id)).status).toBe("pending"); // support can read
    expect((await getOrder(p.staff, o.id)).status).toBe("pending"); // plant staff can read (no amounts)
    expect((await refused(() => getOrder(p.keeper, o.id))).status).toBe(403);
  });

  it("plant staff get the order and its history without a single rate or amount", async () => {
    const p = plant();
    const o = await sample(p);
    await change(p.desk, o.id, 1, [{ sku_id: b500.id, quantity: 1, rate: "95" }, { sku_id: b1l.id, quantity: 3, rate: "140" }]);
    const d = await getOrder(p.staff, o.id);
    expect(d.total).toBeNull();
    expect(d.customer).toMatchObject({ phone: expect.stringMatching(/^\d{10}$/) });
    expect(d.lines.map((l) => [l.quantity, l.rate, l.total])).toEqual([
      [1, null, null],
      [3, null, null],
    ]);
    expect(d.versions.map((v) => [v.version, v.total, v.lines.every((l) => l.rate === null && l.total === null)])).toEqual([
      [1, null, true],
      [2, null, true],
    ]);
    const full = await getOrder(p.desk, o.id);
    expect([full.total, full.versions[0]!.total]).toEqual(["515.00", "370.00"]);
  });

  it("another plant's order is not found", async () => {
    const a = plant();
    const b = plant();
    const o = await sample(a);
    expect(await refused(() => getOrder(b.owner, o.id))).toEqual({ status: 404, message: "Order not found" });
    expect((await refused(() => deliver(b.owner, o.id))).status).toBe(404);
  });
});

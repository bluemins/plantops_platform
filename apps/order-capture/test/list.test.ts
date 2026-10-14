// The order list (tabs, order, search, dates, counts, amber, isolation) and the owner's CSV export.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as exportRoute } from "@/app/api/export/route";
import { recentChanges } from "@/server/audit";
import { cancelOrder, changeOrder, deliverOrder } from "@/server/handling";
import { exportCsv, listOrders, pendingSummary, tabCounts } from "@/server/list";
import { createOrder, OrderInput } from "@/server/orders";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused, signInAs } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const [b1l, b500] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0]];
const DAY = 24 * 60 * 60 * 1000;
let k = 0;
type P = ReturnType<typeof plant>;
const add = (p: P, phone: string, name: string, place: string, qty = 1) =>
  createOrder(p.desk, OrderInput.parse({ request_key: `list-${Date.now()}-${++k}`, customer: { phone, name, place }, lines: [{ sku_id: b500.id, quantity: qty, rate: "90" }, { sku_id: b1l.id, quantity: 3, rate: "140" }] }));
/** Move an order's entry time back (as the table owner; the app itself can't). */
const backdate = (id: string, daysAgo: number, extraMs = 0) => asOwner("update order_capture.orders set created_at = now() - make_interval(secs => $2) where id = $1", [id, (daysAgo * DAY + extraMs) / 1000]);
const refs = (rows: { ref: string }[]) => rows.map((r) => r.ref);

describe("the order list", () => {
  it("Pending oldest first with amber from 2 days; Delivered / Cancelled newest first; counts per tab", async () => {
    const p = plant();
    const a = await add(p, "9000000001", "Hotel Annapurna", "Sambalpur");
    const b = await add(p, "9000000002", "Maa Tarini Store", "Bargarh");
    const c = await add(p, "9000000003", "Sharma Tiffin", "Bijepur");
    const d = await add(p, "9000000004", "Sri ram hotel", "bijepur");
    const e = await add(p, "9000000005", "Raju Store", "Sambalpur");
    await backdate(a.id, 3);
    await backdate(b.id, 2, 60_000); // just over 2 days
    await backdate(c.id, 1);
    await backdate(e.id, 5);
    await deliverOrder(p.desk, d.id, { expected: { status: "pending", version: 1 } });
    await cancelOrder(p.desk, e.id, { expected: { status: "pending", version: 1 }, reason: "customer changed mind" });
    const pending = (await listOrders(p.desk)).orders;
    expect(pending.map((o) => [o.ref, o.age!.text, o.age!.amber])).toEqual([
      ["O-0001", "3 days", true],
      ["O-0002", "2 days", true],
      ["O-0003", "1 day", false],
    ]);
    expect(pending[0]).toMatchObject({ customer: "Hotel Annapurna", place: "Sambalpur", entered_by: "Atharv", total: "510.00" });
    expect(pending[0]!.lines.map((l) => [l.quantity, l.unit])).toEqual([
      [1, "box"],
      [3, "box"],
    ]);
    expect((await listOrders(p.desk, { tab: "delivered" })).orders.map((o) => [o.ref, o.age])).toEqual([["O-0004", null]]);
    expect(refs((await listOrders(p.desk, { tab: "cancelled" })).orders)).toEqual(["O-0005"]);
    expect(await tabCounts(p.support)).toEqual({ pending: 3, delivered: 1, cancelled: 1 });
  });

  it("Delivered newest first (by when delivered)", async () => {
    const p = plant();
    const a = await add(p, "9000000001", "A shop", "Bargarh");
    const b = await add(p, "9000000002", "B shop", "Bargarh");
    await deliverOrder(p.desk, b.id, { expected: { status: "pending", version: 1 } });
    await deliverOrder(p.desk, a.id, { expected: { status: "pending", version: 1 } });
    expect(refs((await listOrders(p.owner, { tab: "delivered" })).orders)).toEqual(["O-0001", "O-0002"]);
  });

  it("search: O-0042 / 42 → the reference, digits → the phone, otherwise name or place; dates", async () => {
    const p = plant();
    await add(p, "9876543210", "Sri ram hotel", "bijepur");
    const two = await add(p, "9123456780", "Maa Tarini Store", "Bargarh");
    for (let i = 0; i < 10; i++) await add(p, `91000000${String(i).padStart(2, "0")}`, `Shop ${i}`, "Attabira");
    const q = async (text: string) => refs((await listOrders(p.desk, { q: text })).orders);
    expect(await q("O-0002")).toEqual(["O-0002"]);
    expect(await q("o0002")).toEqual(["O-0002"]);
    expect(await q("12")).toEqual(["O-0012"]);
    expect(await q("43210")).toEqual(["O-0001"]);
    expect(await q("+91 91234 56780")).toEqual(["O-0002"]);
    expect(await q("TARINI")).toEqual(["O-0002"]);
    expect(await q("bijep")).toEqual(["O-0001"]);
    expect(await q("Nowhere")).toEqual([]);
    expect(await q("100%")).toEqual([]);
    await backdate(two.id, 3);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const old = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 3 * DAY));
    expect(refs((await listOrders(p.desk, { from: old, to: old })).orders)).toEqual(["O-0002"]);
    expect((await listOrders(p.desk, { from: today })).orders).toHaveLength(11);
    expect((await listOrders(p.desk, { from: "not-a-date" })).orders).toHaveLength(12);
    expect((await listOrders(p.desk, {}, Date.now(), 5)).more).toBe(true);
  });

  it("each plant sees only its own orders (plant staff too); a store keeper sees nothing", async () => {
    const a = plant();
    const b = plant();
    await add(a, "9876543210", "Sri ram hotel", "bijepur");
    expect((await listOrders(b.owner)).orders).toEqual([]);
    expect((await listOrders(b.owner, { q: "Sri ram" })).orders).toEqual([]);
    expect((await listOrders(b.staff)).orders).toEqual([]);
    expect(await tabCounts(b.owner)).toEqual({ pending: 0, delivered: 0, cancelled: 0 });
    expect((await refused(() => listOrders(a.keeper))).status).toBe(403);
  });

  it("plant staff see customer, phone, place, products and quantities, but never a rate or an amount", async () => {
    const p = plant();
    await add(p, "9876543210", "Sri ram hotel", "Bijepur");
    const [mine] = (await listOrders(p.staff)).orders;
    expect(mine).toMatchObject({ customer: "Sri ram hotel", phone: "9876543210", place: "Bijepur", total: null });
    expect(mine!.lines.map((l) => [l.product, l.quantity, l.unit, l.rate, l.total])).toEqual([
      [mine!.lines[0]!.product, 1, "box", null, null],
      [mine!.lines[1]!.product, 3, "box", null, null],
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/"(90|140|510)(\.00)?"/);
    const [desk] = (await listOrders(p.desk)).orders;
    expect([desk!.total, desk!.phone, desk!.lines[0]!.rate]).toEqual(["510.00", "9876543210", "90.00"]);
    expect(await tabCounts(p.staff)).toEqual({ pending: 1, delivered: 0, cancelled: 0 });
    expect((await refused(() => pendingSummary(p.staff))).status).toBe(403);
    expect((await refused(() => exportCsv(p.staff))).status).toBe(403);
  });
});

describe("the owner's pending summary", () => {
  it("adds up every pending order's current lines: total, and quantity / rate range / amount per product", async () => {
    const p = plant();
    expect(await pendingSummary(p.owner)).toEqual({ orders: 0, total: "0", products: [] });
    const a = await add(p, "9000000001", "Hotel Annapurna", "Sambalpur"); // 500ml 1 × 90 + 1L 3 × 140 = 510
    const b = await add(p, "9000000002", "Maa Tarini Store", "Bargarh", 4); // 500ml 4 × 90 + 1L 3 × 140 = 780
    // a change: only the current version counts (500ml 2 × 100 = 200)
    await changeOrder(p.desk, b.id, { expected: { status: "pending", version: 1 }, lines: [{ sku_id: b500.id, quantity: 2, rate: "100" }] });
    // delivered and cancelled orders are left out
    const c = await add(p, "9000000003", "Sharma Tiffin", "Bijepur");
    const d = await add(p, "9000000004", "Sri ram hotel", "bijepur");
    await deliverOrder(p.desk, c.id, { expected: { status: "pending", version: 1 } });
    await cancelOrder(p.desk, d.id, { expected: { status: "pending", version: 1 }, reason: "customer changed mind" });
    expect(a.total).toBe("510.00");
    expect(await pendingSummary(p.owner)).toEqual({
      orders: 2,
      total: "710.00",
      products: [
        { sku_id: b1l.id, product: "Bluemins (1 L × 12)", unit: "box", quantity: 3, orders: 1, min_rate: "140.00", max_rate: "140.00", amount: "420.00" },
        { sku_id: b500.id, product: "Bluemins (500 ml × 24)", unit: "box", quantity: 3, orders: 2, min_rate: "90.00", max_rate: "100.00", amount: "290.00" },
      ],
    });
  });

  it("owner only; another plant's orders never count", async () => {
    const a = plant();
    const b = plant();
    await add(a, "9876543210", "Sri ram hotel", "bijepur");
    for (const u of [a.desk, a.support, a.staff]) expect((await refused(() => pendingSummary(u))).status).toBe(403);
    expect((await pendingSummary(b.owner)).orders).toBe(0);
  });
});

describe("the owner's CSV export", () => {
  it("one row per line of each order's current version, formulas neutralised, audited", async () => {
    const p = plant();
    await add(p, "9876543210", "Sri ram hotel", "bijepur");
    const evil = await add(p, "9123456780", "=HYPERLINK(\"http://x\")", "Bargarh", 2);
    await deliverOrder(p.owner, evil.id, { expected: { status: "pending", version: 1 }, note: "+all delivered", invoice_no: "INV-7" });
    const text = (await exportCsv(p.owner)).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("Reference,Entered at,Entered by,Customer,Phone,Place,Order note,Status,Status changed at,Delivered by,Delivered at,Delivery note,Zoho invoice no.,Version,Product,Unit,Quantity,Rate,Line total,Order total");
    expect(lines).toHaveLength(5); // header + 2 orders × 2 lines
    expect(lines[1]).toMatch(/^O-0001,.*,Atharv,Sri ram hotel,9876543210,bijepur,,Pending,.*,1,Bluemins \(500 ml × 24\),box,1,90\.00,90\.00,510\.00$/);
    expect(lines[3]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[3]).toContain(",Delivered,");
    expect(lines[3]).toContain(",'+all delivered,INV-7,");
    expect((await recentChanges(p.owner))[0]!.text).toBe("Exported the orders (CSV, 2 orders, 4 lines)");
  });

  it("owner only; another plant's orders never appear", async () => {
    const a = plant();
    const b = plant();
    await add(a, "9876543210", "Sri ram hotel", "bijepur");
    for (const u of [a.desk, a.support, a.staff]) expect((await refused(() => exportCsv(u))).status).toBe(403);
    expect((await exportCsv(b.owner)).trim().split("\r\n")).toHaveLength(1);
  });

  it("through the API: a CSV file named by today's date; Order desk 403", async () => {
    const p = plant();
    signInAs(p.owner);
    const res = await exportRoute(new Request("http://localhost:3005/api/export"), undefined as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    vi.restoreAllMocks();
    signInAs(p.desk);
    expect((await exportRoute(new Request("http://localhost:3005/api/export"), undefined as never)).status).toBe(403);
  });
});

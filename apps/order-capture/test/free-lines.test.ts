// Free boxes on the order (scheme, "12 + 1 free"; owner 2026-11-08, docs/FREE_BOXES_PHASE_PLAN.md, migration 0011):
// a free line is saved with the worth rate and amount 0; the total never counts it; each product once paid and once
// free; at least one paid line; Change keeps / adds / removes free lines; plant staff see FREE and the count but no
// amounts; the pending summary, CSV, WhatsApp copy, last rates and Make bill (free row at ₹0 with the worth as its
// discount, in the Zoho file too) and the Sales by Item report; what the database refuses; another plant sees nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { makeBill, zohoCsvRows } from "@/server/bill-make";
import { changeOrder, DeliverInput, deliverOrder, getOrder } from "@/server/handling";
import { billDetail } from "@/server/ledger";
import { exportCsv, listOrders, pendingSummary } from "@/server/list";
import { createOrder, lookupCustomer, OrderInput } from "@/server/orders";
import { readParams, salesReport } from "@/server/reports";
import { productsText, versionDiff } from "@/lib/history";
import { whatsappText } from "@/lib/whatsapp";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, dbError, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
const [b1l, b500] = SKUS as [TenantSku, TenantSku, TenantSku];
let k = 0;

type L = { sku_id: string; quantity: number; rate: string; free?: boolean };
const order = (p: ReturnType<typeof plant>, lines: L[], phone = "9876543210", name = "Bikash Kirana") =>
  createOrder(p.desk, OrderInput.parse({ request_key: `free-${Date.now()}-${++k}`, customer: { phone, name, place: "Turunga" }, lines }));

// O-0100: 12 × 1L at ₹100 + 2 × 500ml at ₹150, + 1 box 1L free
const scheme: L[] = [
  { sku_id: b1l.id, quantity: 12, rate: "100" },
  { sku_id: b500.id, quantity: 2, rate: "150" },
  { sku_id: b1l.id, quantity: 1, rate: "100", free: true },
];

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  platform.skus = SKUS.map((s) => ({ ...s, hsn: "22011010", gst_rate: 5 }));
  platform.branding.set(a.tenantId, { gstin: "21NWSPS1732J1ZX" });
});
afterAll(() => platform.close());

describe("free boxes on an order", () => {
  it("saved with the worth rate and amount 0; the total is the paid lines only", async () => {
    const o = await order(a, scheme);
    expect(o.total).toBe("1500.00");
    expect(o.lines.map((l) => [l.quantity, l.rate, l.total, l.free])).toEqual([
      [12, "100.00", "1200.00", false],
      [2, "150.00", "300.00", false],
      [1, "100.00", "0.00", true],
    ]);
    const [row] = (await asApp(a.tenantId, `select count(*)::int as n, sum(line_total)::text as t from order_capture.order_lines where order_id = '${o.id}'`)).rows;
    expect(row).toEqual({ n: 3, t: "1500.00" });
    expect(productsText(o.lines)).toBe("Bluemins (1 L × 12) 12 box, Bluemins (500 ml × 24) 2 box, Bluemins (1 L × 12) 1 box free");
  });

  it("a free box of another product; a rate the form couldn't fill is saved as ₹0 worth", async () => {
    const o = await order(a, [{ sku_id: b1l.id, quantity: 12, rate: "100" }, { sku_id: b500.id, quantity: 1, rate: "0", free: true }], "9000000011", "Shop");
    expect(o.total).toBe("1200.00");
    expect(o.lines[1]).toMatchObject({ free: true, rate: "0.00", total: "0.00" });
  });

  it("refuses: two free lines of one product, two paid lines of one product, only free lines", async () => {
    const twiceFree = OrderInput.safeParse({ request_key: "free-refuse-1", customer: { phone: "9876543210" }, lines: [...scheme, { sku_id: b1l.id, quantity: 2, rate: "100", free: true }] });
    expect(twiceFree.success).toBe(false);
    expect(twiceFree.error!.issues[0]!.message).toBe("Each product can be free only once in an order");
    const twicePaid = OrderInput.safeParse({ request_key: "free-refuse-2", customer: { phone: "9876543210" }, lines: [...scheme, { sku_id: b500.id, quantity: 2, rate: "150" }] });
    expect(twicePaid.error!.issues[0]!.message).toBe("Each product can be in the order only once");
    const onlyFree = OrderInput.safeParse({ request_key: "free-refuse-3", customer: { phone: "9876543210" }, lines: [{ sku_id: b1l.id, quantity: 1, rate: "100", free: true }] });
    expect(onlyFree.error!.issues[0]!.message).toBe("Add at least one product that is charged");
  });

  it("the customer's last rate comes from paid lines only", async () => {
    await order(a, [{ sku_id: b500.id, quantity: 5, rate: "140" }, { sku_id: b1l.id, quantity: 1, rate: "999", free: true }], "9000000012", "Rate shop");
    const r = await lookupCustomer(a.desk, "9000000012");
    expect(r.last_rates).toEqual({ [b500.id]: "140.00" });
  });

  it("Change adds, keeps and removes free lines; the history says so", async () => {
    const o = await order(a, scheme.slice(0, 2), "9000000013", "Change shop");
    const v2 = await changeOrder(a.desk, o.id, { expected: { status: "pending", version: 1 }, lines: scheme });
    expect(v2).toMatchObject({ changed: true, version: 2, total: "1500.00" });
    // the same lines again: nothing written
    expect((await changeOrder(a.desk, o.id, { expected: { status: "pending", version: 2 }, lines: scheme })).changed).toBe(false);
    const v3 = await changeOrder(a.desk, o.id, { expected: { status: "pending", version: 2 }, lines: [...scheme.slice(0, 2), { ...scheme[2]!, quantity: 2 }] });
    expect(v3.total).toBe("1500.00");
    const d = await getOrder(a.owner, o.id);
    expect(versionDiff(d.versions[0]!.lines, d.versions[1]!.lines, d.versions[0]!.total, d.versions[1]!.total)).toBe("added Bluemins (1 L × 12) 1 box free");
    expect(versionDiff(d.versions[1]!.lines, d.versions[2]!.lines, d.versions[1]!.total, d.versions[2]!.total)).toBe("Bluemins (1 L × 12) (free): 1 box → 2 box");
    const v4 = await changeOrder(a.desk, o.id, { expected: { status: "pending", version: 3 }, lines: scheme.slice(0, 2) });
    expect(v4.version).toBe(4);
    const d4 = await getOrder(a.owner, o.id);
    expect(versionDiff(d4.versions[2]!.lines, d4.versions[3]!.lines, null, null)).toBe("removed Bluemins (1 L × 12) (free)");
  });

  it("plant staff see the free line and its count, never a rate or an amount", async () => {
    const p = plant();
    await order(p, scheme);
    const [mine] = (await listOrders(p.staff)).orders;
    expect(mine!.total).toBeNull();
    expect(mine!.lines.map((l) => [l.quantity, l.free, l.rate, l.total])).toEqual([
      [12, false, null, null],
      [2, false, null, null],
      [1, true, null, null],
    ]);
  });

  it("pending summary: paid quantity and free quantity apart; rates from paid lines; brand units paid only", async () => {
    const p = plant();
    await order(p, scheme);
    const s = await pendingSummary(p.owner);
    expect(s.total).toBe("1500.00");
    expect(s.products.find((x) => x.sku_id === b1l.id)).toMatchObject({ quantity: 12, free_quantity: 1, min_rate: "100.00", max_rate: "100.00", amount: "1200.00" });
    expect(s.products.find((x) => x.sku_id === b500.id)).toMatchObject({ quantity: 2, free_quantity: 0 });
  });

  it("CSV: a Free column; WhatsApp copy: FREE and the load totals count the free box", async () => {
    const p = plant();
    await order(p, scheme);
    const csv = (await exportCsv(p.owner)).trim().split("\r\n");
    expect(csv.slice(1).map((l) => l.split(",").at(-1))).toEqual(["", "", "Yes"]);
    const [o] = (await listOrders(p.owner)).orders;
    const text = whatsappText([{ ref: o!.ref, customer: o!.customer, phone: o!.phone, place: o!.place, note: null, lines: o!.lines, total: o!.total }]);
    expect(text).toContain("- Bluemins (1 L × 12): 1 box FREE");
    expect(text).toContain("- Bluemins (1 L × 12): 12 box × ₹100");
    expect(text).toContain("- Bluemins (1 L × 12): 13 box");
  });

  it("another plant never sees them", async () => {
    await order(a, scheme, "9000000014", "Plant A shop");
    expect((await listOrders(b.owner)).orders).toEqual([]);
    expect((await pendingSummary(b.owner)).products).toEqual([]);
  });
});

describe("free boxes on the bill", () => {
  async function deliveredScheme(phone: string) {
    const o = await order(a, scheme, phone, "Bikash Kirana");
    await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
    return o;
  }

  it("Make bill copies the free line at ₹0 with its worth as the discount; the bill total is the paid lines", async () => {
    const o = await deliveredScheme("9000000021");
    const made = await makeBill(acct, { order_id: o.id, lines: [{ line_no: 3, description: "12 + 1 free", discount: "50" }] });
    const d = await billDetail(acct, made.id);
    expect(d).toMatchObject({ sub_total: "1500.00", total: "1500.00" });
    expect(d.lines[2]).toMatchObject({ quantity: "1.000", rate: "100.00", discount: "100.00", total: "0.00", description: "12 + 1 free", free: true });
    expect(d.lines[0]).toMatchObject({ discount: "0.00", total: "1200.00", free: false });
  });

  it("a bill discount is shared over paid lines only; without a description the free line says Free", async () => {
    const o = await deliveredScheme("9000000022");
    const made = await makeBill(acct, { order_id: o.id, discount: "150" });
    const d = await billDetail(acct, made.id);
    expect(d.total).toBe("1350.00");
    expect(d.lines[2]).toMatchObject({ total: "0.00", description: "Free" });
  });

  it("GST bill: the free line has no tax; the Zoho file has it as its own row, price 100, discount 100", async () => {
    const o = await deliveredScheme("9000000023");
    const made = await makeBill(acct, { order_id: o.id, needs_gst: true, tax_inclusive: true });
    const d = await billDetail(acct, made.id);
    expect(d.total).toBe("1500.00");
    expect(d.lines[2]).toMatchObject({ tax_amount: "0.00", total: "0.00" });
    const file = await zohoCsvRows(acct, "new");
    const head = file.rows[0] as string[];
    const free = (file.rows as string[][]).find((r) => r[head.indexOf("Item Desc")] === "Free")!;
    expect([free[head.indexOf("Quantity")], free[head.indexOf("Item Price")], free[head.indexOf("Discount Amount")]]).toEqual(["1.000", "100.00", "100.00"]);
  });

  it("Sales by Item: free boxes in their own column, the sold quantity and amount unchanged", async () => {
    const p = plant();
    const o = await order(p, scheme, "9000000031", "Report shop");
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
    await makeBill(p.owner, { order_id: o.id });
    const r = await salesReport(p.owner, "item", readParams({ period: "this_month" }));
    const row = r.groups[0]!.rows.find((x) => x.key === `s:${b1l.id}`)!;
    expect([row.qty, row.free_qty, row.amount]).toEqual([12000n, 1000n, 120000n]);
    expect(r.total.free_qty).toBe(1000n);
  });
});

describe("the database", () => {
  it("refuses a free line with an amount, a paid line whose amount isn't quantity × rate, and a free bill line above 0", async () => {
    const o = await order(a, scheme, "9000000041", "DB shop");
    const ins = (free: boolean, total: string, sku: string) =>
      asApp(a.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total, free)
        values ('${a.tenantId}', '${o.id}', 9, 1, '${sku}', 'X', 'box', 1, 100, ${total}, ${free})`);
    expect(await dbError(ins(true, "100", b1l.id))).toMatch(/order_lines_total_check/);
    expect(await dbError(ins(false, "50", b1l.id))).toMatch(/order_lines_total_check/);
    // one paid and one free line of the same product are fine; a second free one is not
    await ins(false, "100", b1l.id);
    await asApp(a.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total, free)
        values ('${a.tenantId}', '${o.id}', 9, 2, '${b1l.id}', 'X', 'box', 1, 100, 0, true)`);
    expect(await dbError(asApp(a.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total, free)
        values ('${a.tenantId}', '${o.id}', 9, 3, '${b1l.id}', 'X', 'box', 1, 100, 0, true)`))).toMatch(/order_lines_product_once/);
  });

  it("free lines need the owner's or Order desk's order rights like any line", async () => {
    const p = plant();
    expect((await refused(() => createOrder(p.staff, OrderInput.parse({ request_key: "free-staff-1", customer: { phone: "9876543210", name: "X Shop", place: "Bijepur" }, lines: scheme })))).status).toBe(403);
  });
});

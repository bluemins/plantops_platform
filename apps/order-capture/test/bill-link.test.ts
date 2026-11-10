// Link bills to orders (src/lib/bill-link.ts, src/server/bill-link.ts): suggestions and sure matches, link / unlink
// rules (Zoho bills only, one bill per order, delivered orders only), owner only (support reads), another plant sees
// nothing, Order to Payment moves the order on.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { linkRows, type LinkBill, type LinkOrder } from "@/lib/bill-link";
import { makeBill } from "@/server/bill-make";
import { linkBill, linkList, linkSure, linkSuggestions, unlinkBill } from "@/server/bill-link";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { createOrder, OrderInput } from "@/server/orders";
import { orderFlowReport, readFlowParams } from "@/server/reports";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, auditRows, ocUser, plant, refused } from "./helpers";

describe("suggestions and sure matches (rules)", () => {
  const o = (id: string, customer: string, total: bigint, delivered: string): LinkOrder => ({ id, ref_no: Number(id.slice(1)), customer_id: customer, customer_name: customer, place: null, total, delivered });
  const b = (id: string, customer: string | null, total: bigint, date: string): LinkBill => ({ id, number: id.toUpperCase(), bill_date: date, total, customer_id: customer, customer_name: customer ?? "Retail Sales" });

  it("ranked: same customer + amount, same customer, same amount elsewhere; within 7 days only", () => {
    const [row] = linkRows([o("o1", "rudra", 120_000n, "2026-10-16")], [
      b("far", "rudra", 120_000n, "2026-10-30"),
      b("retail", "retail", 120_000n, "2026-10-16"),
      b("other-amount", "rudra", 90_000n, "2026-10-15"),
      b("exact", "rudra", 120_000n, "2026-10-17"),
      b("unrelated", "someone", 50_000n, "2026-10-16"),
    ]);
    expect(row!.suggestions.map((s) => [s.id, s.rank, s.gap])).toEqual([["exact", 0, 1], ["other-amount", 1, 1], ["retail", 2, 0]]);
    expect(row!.sure?.id).toBe("exact");
  });

  it("no sure match when two exact bills fit, when two orders want the same bill, or when more than 3 days apart", () => {
    const two = linkRows([o("o1", "c", 100n, "2026-10-20")], [b("x", "c", 100n, "2026-10-20"), b("y", "c", 100n, "2026-10-21")]);
    expect(two[0]!.sure).toBeNull();
    const shared = linkRows([o("o1", "c", 100n, "2026-10-20"), o("o2", "c", 100n, "2026-10-21")], [b("x", "c", 100n, "2026-10-20")]);
    expect(shared.map((r) => r.sure)).toEqual([null, null]);
    expect(linkRows([o("o1", "c", 100n, "2026-10-20")], [b("x", "c", 100n, "2026-10-25")])[0]!.sure).toBeNull();
  });
});

let platform: FakePlatform;
const a = plant();
const other = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
const [b1l] = SKUS as [TenantSku];
let k = 0;
const ids: Record<string, string> = {};

async function delivered(name: string, phone: string, qty: number) {
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `link-${Date.now()}-${++k}`,
    customer: { phone, name, place: "Bijepur" },
    lines: [{ sku_id: b1l.id, quantity: qty, rate: "100" }],
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  return o.id;
}
const one = async (q: string) => ((await asApp(a.tenantId, q)).rows[0] as { id: string }).id;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  ids.sure = await delivered("Rudra Dhaba", "9811111111", 12); // ₹1,200
  ids.retail = await delivered("Sarala hotel", "9822222222", 13); // ₹1,300, bill under Retail Sales
  ids.none = await delivered("Test Order Customer", "9833333333", 5); // no bill anywhere
  const cust = async (phone: string) => one(`select id from order_capture.customers where tenant_id = '${a.tenantId}' and phone = '${phone}'`);
  const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${a.tenantId}', gen_random_uuid(), 'Sujata') returning id`);
  const retail = await one(`insert into order_capture.customers (tenant_id, phone_typed, phone, name, place, created_by, created_by_name) values ('${a.tenantId}', '9899999999', '9899999999', 'Retail Sales', 'Bijepur', gen_random_uuid(), 'Sujata') returning id`);
  const zbill = (n: string, customer: string, total: number, date = today) =>
    one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, due_date, customer_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', '${n}', 'zi-${n}', '${date}', '${date}', '${customer}', 'x', ${total}, ${total}, '${imp}', gen_random_uuid(), 'Sujata') returning id`);
  ids.billSure = await zbill("INV-001759", await cust("9811111111"), 1200);
  ids.billRetail = await zbill("INV-001755", retail, 1300);
  ids.billSpare = await zbill("INV-001900", await cust("9833333333"), 99999, "2026-01-01"); // months before: never suggested
});
afterAll(() => platform.close());

describe("Link bills to orders on real rows", () => {
  it("the list: one sure match, a Retail Sales suggestion, an order with nothing", async () => {
    const rows = await linkList(a.owner);
    const by = (id: string) => rows.find((r) => r.order.id === id)!;
    expect(by(ids.sure!).sure?.number).toBe("INV-001759");
    expect(by(ids.retail!).suggestions.map((s) => [s.number, s.rank, s.customer_name])).toEqual([["INV-001755", 2, "Retail Sales"]]);
    expect(by(ids.retail!).sure).toBeNull();
    expect(by(ids.none!).suggestions).toEqual([]);
  });

  it("owner only (support reads the list); Accounts and Order desk refused; another plant sees nothing", async () => {
    expect((await linkList(a.support)).length).toBeGreaterThan(0);
    for (const who of [acct, a.desk, a.support]) expect((await refused(() => linkBill(who, ids.retail!, { bill_id: ids.billRetail! }))).status).toBe(403);
    for (const who of [acct, a.desk]) expect((await refused(() => linkList(who))).status).toBe(403);
    expect(await linkList(other.owner)).toEqual([]);
    expect((await refused(() => linkBill(other.owner, ids.retail!, { bill_id: ids.billRetail! }))).status).toBe(404);
  });

  it("link all sure matches: only the pairs still sure are linked; the order moves to Billed", async () => {
    const r = await linkSure(a.owner, { pairs: [{ order_id: ids.sure!, bill_id: ids.billSure! }, { order_id: ids.retail!, bill_id: ids.billRetail! }] });
    expect(r).toEqual({ linked: 1, skipped: 1 });
    const flow = await orderFlowReport(a.owner, readFlowParams({ customer: "Rudra" }));
    expect(flow.rows.map((x) => [x.stage, x.bill?.number])).toEqual([["billed", "INV-001759"]]);
    expect(await linkSuggestions(a.owner, ids.sure!)).toBeNull(); // it has its bill now
  });

  it("link one by number (a Retail Sales bill stays in Retail Sales' account); refusals", async () => {
    expect(await linkBill(a.owner, ids.retail!, { number: "inv-001755" })).toEqual({ order: expect.stringMatching(/^O-/), number: "INV-001755" });
    const billCustomer = await one(`select c.name as id from order_capture.bills b join order_capture.customers c on c.tenant_id = b.tenant_id and c.id = b.customer_id where b.tenant_id = '${a.tenantId}' and b.id = '${ids.billRetail}'`);
    expect(billCustomer).toBe("Retail Sales");
    expect((await refused(() => linkBill(a.owner, ids.retail!, { bill_id: ids.billSpare! }))).message).toMatch(/already has bill INV-001755/);
    expect((await refused(() => linkBill(a.owner, ids.none!, { bill_id: ids.billSure! }))).message).toMatch(/already linked to another order/);
    expect((await refused(() => linkBill(a.owner, ids.none!, { number: "INV-404" }))).status).toBe(404);
    // a PlantOps bill is never linked or unlinked here
    const own = await delivered("Own bill shop", "9844444444", 2);
    const made = await makeBill(acct, { order_id: own });
    expect((await refused(() => linkBill(a.owner, ids.none!, { number: made.number }))).message).toMatch(/made in PlantOps/);
    expect((await refused(() => unlinkBill(a.owner, own, { reason: "testing" }))).message).toMatch(/cancel the bill instead/);
  });

  it("unlink with a reason: the order is Delivered, not billed again; Recent changes has both lines", async () => {
    expect(await unlinkBill(a.owner, ids.retail!, { reason: "bill is for another order" })).toMatchObject({ number: "INV-001755" });
    const flow = await orderFlowReport(a.owner, readFlowParams({ customer: "Sarala" }));
    expect(flow.rows.map((x) => x.stage)).toEqual(["delivered"]);
    const actions = (await auditRows(a.tenantId)).map((r: { action: string }) => r.action);
    expect(actions.filter((x: string) => x === "bill.link")).toHaveLength(2);
    expect(actions).toContain("bill.unlink");
  });
});

// Reports on real rows (src/server/reports.ts; docs/REPORTS_PHASE_PLAN.md): PlantOps bills and imported Zoho bills
// together, cancelled and opening-balance bills left out, one row per product, owner only (support reads), another
// plant sees nothing, the dashboard card's number ("reports" summary view).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { makeBill } from "@/server/bill-make";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { cancelBill, cancelPayment, ReceivePaymentInput, receivePayment } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { readParams, readRecParams, receivablesReport, salesReport } from "@/server/reports";
import { summaryFor } from "@/server/summary";
import { KEEPER_ID, SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
const [b1l, b500] = SKUS as [TenantSku, TenantSku];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const thisMonth = () => readParams({ period: "this_month" });
let k = 0;

async function billed(lines: [TenantSku, number, string][], salesperson: string | null = null, phone = "9876543210") {
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `reports-${Date.now()}-${++k}`,
    customer: { phone, name: phone === "9876543210" ? "Sri ram hotel" : "Krupalu Enterprises", place: phone === "9876543210" ? "Bijepur" : "Dhanupali" },
    lines: lines.map(([s, quantity, rate]) => ({ sku_id: s.id, quantity, rate })),
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  return makeBill(acct, { order_id: o.id, salesperson_id: salesperson, vehicle: salesperson ? "OD-17 AB 1234" : undefined });
}

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  await billed([[b1l, 10, "90"], [b500, 2, "140"]], KEEPER_ID); // Atharv: ₹900 + ₹280
  await billed([[b1l, 5, "90"]], null, "9000000009"); // not mentioned: ₹450
  const cancelled = await billed([[b1l, 100, "90"]], KEEPER_ID);
  await cancelBill(a.owner, cancelled.id, { reason: "typed twice" });
  // an imported Zoho bill (salesperson "kedar") with the 1 L product under Zoho's own name, and an opening balance
  const one = async (q: string) => ((await asApp(a.tenantId, q)).rows[0] as { id: string }).id;
  const imp = await one(`insert into order_capture.zoho_imports (tenant_id, imported_by, imported_by_name) values ('${a.tenantId}', gen_random_uuid(), 'Sujata') returning id`);
  const contact = await one(`insert into order_capture.zoho_contacts (tenant_id, zoho_contact_id, name, import_id) values ('${a.tenantId}', 'zc9', 'Uttam Bargarh', '${imp}') returning id`);
  const zb = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, zoho_contact_id, customer_name, sub_total, total, salesperson, import_id, created_by, created_by_name)
    values ('${a.tenantId}', 'zoho', 'INV-001700', 'zi-1700', '${today}', '${contact}', 'Uttam Bargarh', 1000, 1050, 'kedar', '${imp}', gen_random_uuid(), 'Sujata') returning id`);
  await asApp(a.tenantId, `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, sku_code, item_name, quantity, rate, tax_name, tax_percent, tax_amount, line_total)
    values ('${a.tenantId}', '${zb}', 1, '${b1l.id}', 'PV_BM_1', 'Zoho 1 Litre name', 10, 100, 'GST5', 5, 50, 1000)`);
  const ob = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
    values ('${a.tenantId}', 'zoho', 'OB-1', 'ob:zc9', '${today}', '${contact}', 'Uttam Bargarh', 7000, 7000, '${imp}', gen_random_uuid(), 'Sujata') returning id`);
  await asApp(a.tenantId, `insert into order_capture.bill_lines (tenant_id, bill_id, line_no, item_name, quantity, rate, line_total) values ('${a.tenantId}', '${ob}', 1, 'Opening balance', 1, 7000, 7000)`);
});
afterAll(() => platform.close());

describe("Sales by Item / Customer on real bills", () => {
  it("PlantOps + Zoho bills, cancelled and opening balance left out; one row per product; by salesperson", async () => {
    const r = await salesReport(a.owner, "item", { ...thisMonth(), group: "salesperson" });
    expect(r.groups.map((g) => [g.label, Number(g.amount) / 100])).toEqual([
      ["Not mentioned", 450],
      ["Atharv", 1180],
      ["kedar", 1000],
    ]);
    expect(Number(r.total.amount) / 100).toBe(2630);
    expect(r.total.bills).toBe(3);
    const all = await salesReport(a.owner, "item", thisMonth());
    const oneLitre = all.groups[0]!.rows.find((x) => x.sku === "B1L")!;
    expect([oneLitre.label, Number(oneLitre.qty) / 1000, Number(oneLitre.amount) / 100]).toEqual(["Bluemins", 25, 2350]); // the Zoho name joins the product
    expect(Number((await salesReport(a.owner, "item", { ...thisMonth(), amount: "with" })).total.amount) / 100).toBe(2680); // + Zoho's ₹50 GST
  });

  it("by customer: Zoho contacts not matched show under their Zoho name; filters by salesperson and vehicle", async () => {
    const r = await salesReport(a.owner, "customer", thisMonth());
    expect(r.groups[0]!.rows.map((x) => [x.label, x.bills, Number(x.before) / 100])).toEqual([
      ["Sri ram hotel", 1, 1180],
      ["Uttam Bargarh", 1, 1000],
      ["Krupalu Enterprises", 1, 450],
    ]);
    expect(Number((await salesReport(a.owner, "customer", { ...thisMonth(), salesperson: "atharv" })).total.amount) / 100).toBe(1180);
    expect(Number((await salesReport(a.owner, "customer", { ...thisMonth(), vehicle: "OD-17 AB 1234" })).total.amount) / 100).toBe(1180);
    expect((await salesReport(a.owner, "customer", { ...thisMonth(), group: "place" })).groups.map((g) => g.label)).toEqual([
      "No place (Zoho contact not matched)", "Bijepur", "Dhanupali",
    ]);
  });

  it("owner only (support reads); Accounts, Order desk and staff are refused; plant B sees nothing", async () => {
    expect((await salesReport(a.support, "item", thisMonth())).total.bills).toBe(3);
    for (const who of [acct, a.desk, a.staff]) expect((await refused(() => salesReport(who, "item", thisMonth()))).status).toBe(403);
    expect((await salesReport(b.owner, "item", thisMonth())).groups).toEqual([]);
  });

  it("the dashboard card: last month's sales and the change, from the 'reports' summary", async () => {
    // seen from next month, this month's bills are "last month"
    const [y, m] = today.split("-").map(Number) as [number, number];
    const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 10, 6));
    const s = await summaryFor(a.tenantId, "reports", next);
    expect(s.badges[0]!.text).toMatch(/ sales ₹2,630$/);
    expect(s.badges).toHaveLength(1); // nothing the month before, so no change shown
  });
});

describe("Receivables on real rows", () => {
  const rec = (kind: Parameters<typeof readRecParams>[0], q: Record<string, string> = {}) => readRecParams(kind, q);
  const money = (c: unknown) => (typeof c === "bigint" ? Number(c) / 100 : c);
  const lines = (t: Awaited<ReturnType<typeof receivablesReport>>["table"]) => t.groups.flatMap((g) => g.rows.map((r) => [r.label, ...r.cells.map(money)]));

  beforeAll(async () => {
    const id = async (phone: string) => ((await asApp(a.tenantId, `select id from order_capture.customers where tenant_id = '${a.tenantId}' and phone = '${phone}'`)).rows[0] as { id: string }).id;
    // Krupalu pays ₹1,000: ₹450 on their bill, ₹550 stays as advance; Sri ram's ₹500 is cancelled (cheque bounced)
    await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: await id("9000000009"), amount: "1000", payment_date: today, mode: "cash" }));
    const bounced = await receivePayment(acct, ReceivePaymentInput.parse({ customer_id: await id("9876543210"), amount: "500", payment_date: today, mode: "cheque" }));
    await cancelPayment(a.owner, bounced.id, { reason: "cheque bounced" });
  });

  it("aging: the opening balance counts, cancelled bill and payment left out, the advance shown apart", async () => {
    const { table: t } = await receivablesReport(a.owner, rec("aging"));
    expect(lines(t).map((r) => [r[0], r.at(-1)])).toEqual([["Uttam Bargarh", 8050], ["Sri ram hotel", 1180]]);
    expect(t.advance).toBe(55000n);
    expect(t.groups[0]!.rows[0]!.href).toMatch(/^\/customers\/z\/[0-9a-f-]+\?tab=statement$/);
  });

  it("a bill Zoho closed without a payment counts as closed from its bill date (the import dated it the import day)", async () => {
    const one = async (q: string) => ((await asApp(a.tenantId, q)).rows[0] as { id: string }).id;
    const imp = await one(`select id from order_capture.zoho_imports where tenant_id = '${a.tenantId}' limit 1`);
    const contact = await one(`select id from order_capture.zoho_contacts where tenant_id = '${a.tenantId}' and zoho_contact_id = 'zc9'`);
    const zb = await one(`insert into order_capture.bills (tenant_id, source, number, zoho_invoice_id, bill_date, due_date, zoho_contact_id, customer_name, sub_total, total, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', 'INV-000100', 'zi-100', '2026-01-10', '2026-01-10', '${contact}', 'Uttam Bargarh', 300, 300, '${imp}', gen_random_uuid(), 'Sujata') returning id`);
    await asApp(a.tenantId, `insert into order_capture.bill_adjustments (tenant_id, bill_id, kind, amount, reason, adjusted_on, import_id, created_by, created_by_name)
      values ('${a.tenantId}', '${zb}', 'zoho_closed', 300, 'Closed in Zoho without a payment', '${today}', '${imp}', gen_random_uuid(), 'Sujata')`);
    expect((await receivablesReport(a.owner, rec("aging", { as_of: "custom", date: "2026-01-31" }))).table.count).toBe(0);
  });

  it("customer balances this month; bill details", async () => {
    const { table: t } = await receivablesReport(a.owner, rec("balances", { show: "nonzero" }));
    expect(lines(t)).toEqual([
      ["Uttam Bargarh", 0, 8050, 0, 8050],
      ["Sri ram hotel", 0, 1180, 0, 1180],
      ["Krupalu Enterprises", 0, 450, 1000, -550],
    ]);
    const bills = (await receivablesReport(a.owner, rec("bills", { status: "open" }))).table;
    expect(bills.count).toBe(3); // Sri ram's bill, Uttam's Zoho bill and opening balance; Krupalu's is paid, the cancelled one left out
  });

  it("owner only (support reads); Accounts, Order desk and staff are refused; plant B sees nothing", async () => {
    expect((await receivablesReport(a.support, rec("aging"))).table.count).toBe(2);
    for (const who of [acct, a.desk, a.staff]) expect((await refused(() => receivablesReport(who, rec("aging")))).status).toBe(403);
    expect((await receivablesReport(b.owner, rec("balances", { show: "all" }))).table.groups).toEqual([]);
  });
});

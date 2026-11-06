// "Import from Zoho" (docs/ZOHO_IMPORT_PHASE_PLAN.md section 8) with the shapes of plant 001's exports: contacts with
// '+91-… mobiles, a mobile on two contacts, no phone, a place in brackets, an opening balance paid through "Customer
// opening balance", an invoice with the same product twice, an invoice closed in Zoho for more than its payments,
// a draft payment, a payment deposited to the bank; a delivered order linked to its invoice. Owner only; the totals
// must match Zoho; importing again adds nothing; another plant sees none of it.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseCsv } from "@/lib/csv-read";
import { rupees } from "@/lib/ledger";
import { paymentMode, placeFromName, planImport, readContacts, readInvoices, readPayments, zohoMobile, type Existing } from "@/lib/zoho-import";
import { kit } from "@/server/kit";
import { confirmZohoImport, previewZohoImport } from "@/server/zoho-import";
import { asApp, asOwner, auditRows, plant, refused } from "./helpers";

const CONTACTS = [
  "Created Time,Display Name,Company Name,Phone,Opening Balance,Status,MobilePhone,Contact ID,GST Identification Number (GSTIN)",
  "2026-02-15 10:00:00,Sahu Hotel(Bijepur),,,320.000,Active,'+91-9437000001,C1,",
  "2026-03-01 10:00:00,Barpali,,,,Active,'+91-9437000002,C2,",
  "2026-03-02 10:00:00,Barpali Shop 2,,,,Active,'+91-9437000002,C3,",
  "2026-03-03 10:00:00,Ghens,,,,Active,,C4,",
  "2026-03-04 10:00:00,Sri ram hotel,,,,Active,'+91-9876543210,C5,21EKDPS8835J1ZR",
].join("\n");
const INVOICES = [
  "Invoice Date,Invoice ID,Invoice Number,Invoice Status,Customer ID,Customer Name,Due Date,SubTotal,Total,Balance,Adjustment,Entity Discount Amount,Notes,Sales person,Item Name,Item Desc,Quantity,Item Total,Item Price,SKU,HSN/SAC,Item Tax,Item Tax %,Item Tax Amount,Usage unit,Discount Amount",
  "2026-10-01,I1,INV-000001,Closed,C2,Barpali,2026-10-01,1150.00,1150.00,0.00,0.00,0.000,Thanks,kedar,1L Water Bottle,,10.00,1000.00,100.00,PV_BM_1,22011010,,,,,0.0",
  "2026-10-01,I1,INV-000001,Closed,C2,Barpali,2026-10-01,1150.00,1150.00,0.00,0.00,0.000,Thanks,kedar,500ml Water Bottle,,1.00,150.00,150.00,PV_BM_500,22011010,,,,,0.0",
  "2026-10-02,I2,INV-000002,Overdue,C4,Ghens,2026-10-02,500.00,496.40,296.40,-3.60,0.000,,kedar,1L Water Bottle,,5.00,500.00,100.00,PV_BM_1,22011010,,,,,0.0",
  "2026-10-03,I3,INV-000003,Closed,C3,Barpali Shop 2,2026-10-03,300.00,300.00,0.00,0.00,0.000,,kedar,1 Litre Deionised Water,,2.00,240.00,120.00,PV_DM_1,285300,,,,,0.0",
  "2026-10-03,I3,INV-000003,Closed,C3,Barpali Shop 2,2026-10-03,300.00,300.00,0.00,0.00,0.000,,kedar,1 Litre Distilled Water,,1.00,60.00,60.00,PV_DM_1,285300,,,,,0.0",
  "2026-11-02,I4,INV-000004,Closed,C5,Sri ram hotel,2026-11-02,510.00,510.00,0.00,0.00,0.000,,kedar,500ml Water Bottle,,1.00,90.00,90.00,PV_BM_500,,,,,,0.0",
  "2026-11-02,I4,INV-000004,Closed,C5,Sri ram hotel,2026-11-02,510.00,510.00,0.00,0.00,0.000,,kedar,1L Water Bottle,,3.00,420.00,140.00,PV_BM_1,,,,,,0.0",
].join("\n");
const PAYMENTS = [
  "Payment Number,CustomerPayment ID,Mode,CustomerID,Amount,Unused Amount,Reference Number,Customer Name,Date,Deposit To,Payment Status,Invoice Number,Amount Applied to Invoice,Invoice Payment Applied Date",
  "1,P1,Cash,C1,320.000,0.000,,Sahu Hotel(Bijepur),2026-02-20,Petty Cash,Paid,Customer opening balance,320.00,",
  "2,P2,Cash,C2,1150.000,0.000,,Barpali,2026-10-01,PureVibe Enterprises,Paid,INV-000001,1150.00,",
  "3,P3,Cash,C4,200.000,0.000,,Ghens,2026-10-03,Petty Cash,Paid,INV-000002,200.00,",
  "4,P4,Cash,C3,250.000,0.000,,Barpali Shop 2,2026-10-04,Petty Cash,Paid,INV-000003,250.00,",
  "5,P5,Cash,C5,510.000,0.000,,Sri ram hotel,2026-11-03,Petty Cash,Paid,INV-000004,510.00,",
  "6,P6,Cash,C4,40.000,40.000,,Ghens,2026-10-05,Petty Cash,Draft,,,",
].join("\n");

const FILES = { contacts: readContacts(parseCsv(CONTACTS)), invoices: readInvoices(parseCsv(INVOICES)), payments: readPayments(parseCsv(PAYMENTS)) };
const SKU = { bm1: randomUUID(), bm500: randomUUID(), dm1: randomUUID() };
const SKUS = [
  { id: SKU.bm1, sku_code: "PV_BM_1" },
  { id: SKU.bm500, sku_code: "PV_BM_500" },
  { id: SKU.dm1, sku_code: "PV_DM_1" },
];
const none: Existing = { customers: [], contacts: [], bills: [], payment_ids: [], skus: SKUS, orders: [] };

describe("reading Zoho's exports and the small rules", () => {
  it("groups invoice lines and payment rows", () => {
    expect(FILES.invoices.map((i) => [i.number, i.lines.length])).toEqual([["INV-000001", 2], ["INV-000002", 1], ["INV-000003", 2], ["INV-000004", 2]]);
    expect(FILES.payments[0]).toMatchObject({ number: "1", applied: [{ invoice: "Customer opening balance", amount: "320.00", date: "2026-02-20" }] });
    expect(() => readInvoices(parseCsv("Name,Phone\nA,1"))).toThrow(/Invoice export/);
  });
  it("Zoho's '+91-… mobiles, the place in brackets, Cash into the bank = Bank", () => {
    expect([zohoMobile("'+91-9437000001"), zohoMobile("9937459340"), zohoMobile("'+91-123")]).toEqual(["9437000001", "9937459340", null]);
    expect([placeFromName("Sahu Hotel(Bijepur)"), placeFromName("Deepak Meher(Jagannath Temple Bijepur)"), placeFromName("Barpali")]).toEqual(["Bijepur", "Jagannath Temple Bijepur", "Not set"]);
    expect([paymentMode("Cash", "Petty Cash"), paymentMode("Cash", "PureVibe Enterprises"), paymentMode("UPI", ""), paymentMode("Bank Transfer", "x"), paymentMode("Cash", "Opening Balance Adjustments")]).toEqual(["cash", "bank", "upi", "bank", "cash"]);
  });
});

describe("the plan", () => {
  const plan = planImport(FILES, none, "2026-11-06");

  it("contacts: never a new customer; each keeps its own mobile; nothing linked without a customer to link to", () => {
    expect(plan.counts).toMatchObject({ contacts_new: 5, contacts_linked: 0, contacts_unmatched: 5, contacts_no_phone: 1 });
    const by = (z: string) => plan.contacts.find((c) => c.zoho_id === z)!;
    expect(plan.contacts.every((c) => c.link === null)).toBe(true);
    expect([by("C1").mobile, by("C2").mobile, by("C3").mobile, by("C4").mobile]).toEqual(["9437000001", "9437000002", "9437000002", null]);
    expect(plan.shared_mobiles).toEqual([{ mobile: "9437000002", names: ["Barpali", "Barpali Shop 2"] }]);
    expect(by("C5").gstin).toBe("21EKDPS8835J1ZR");
  });

  it("links only an exact mobile that one Zoho contact has; a shared mobile is left for the owner", () => {
    const customers = [{ id: "k1", name: "Sri Ram Hotel", phone: "9876543210" }, { id: "k2", name: "Barpali Store", phone: "9437000002" }];
    const p = planImport(FILES, { ...none, customers }, "2026-11-06");
    expect(p.contacts.filter((c) => c.link).map((c) => [c.zoho_id, c.link!.customer_id])).toEqual([["C5", "k1"]]);
    expect(p.counts).toMatchObject({ contacts_linked: 1, contacts_unmatched: 4 });
  });

  it("bills: Zoho's lines exactly (same product twice), an opening balance as its own bill", () => {
    expect(plan.counts).toMatchObject({ bills_new: 5, opening_balances: 1 });
    const inv3 = plan.bills.find((b) => b.number === "INV-000003")!;
    expect(inv3.lines.map((l) => [l.sku_id, l.item_name, l.quantity])).toEqual([[SKU.dm1, "1 Litre Deionised Water", "2.000"], [SKU.dm1, "1 Litre Distilled Water", "1.000"]]);
    expect(plan.bills.find((b) => b.number === "INV-000002")).toMatchObject({ total: 49640n, adjustment: -360n, zoho_balance: 29640n });
    expect(plan.bills.find((b) => b.opening_balance)).toMatchObject({ number: "OB-C1", total: 32000n, bill_date: "2026-02-15", lines: [] });
  });

  it("payments: drafts skipped, the bank one is Bank, the opening balance paid", () => {
    expect(plan.counts.payments_new).toBe(5);
    expect(plan.skipped).toEqual([{ what: "payment", ref: "6", reason: "Zoho status Draft" }]);
    expect(plan.payments.find((p) => p.number === "2")!.mode).toBe("bank");
    expect(plan.payments.find((p) => p.number === "1")!.allocations).toEqual([{ bill_key: "ob:C1", amount: 32000n, date: "2026-02-20" }]);
  });

  it("closed in Zoho for more than its payments -> an adjustment; every due matches Zoho", () => {
    expect(plan.adjustments).toEqual([{ bill_key: "I3", amount: 5000n, date: "2026-11-06" }]);
    expect(plan.mismatches).toEqual([]);
    expect(Object.fromEntries(Object.entries(plan.totals).map(([k, v]) => [k, rupees(v)]))).toEqual({
      billed: "2776.40", received: "2430.00", adjusted: "50.00", due_after: "296.40", zoho_due: "296.40",
    });
  });

  it("a due that Zoho shows higher than ours is a mismatch (never saved)", () => {
    const bad = planImport({ ...FILES, invoices: FILES.invoices.map((i) => (i.number === "INV-000001" ? { ...i, balance: "100.00" } : i)) }, none, "2026-11-06");
    expect(bad.mismatches.map((m) => [m.number, rupees(m.ours), rupees(m.zoho)])).toEqual([["INV-000001", "0.00", "100.00"]]);
  });

  it("a delivered order with the same mobile, products and quantities, near the invoice date, links to it", () => {
    const order = { id: "o1", ref_no: 1, phone: "9876543210", delivered_on: "2026-11-01", lines: [{ sku_id: SKU.bm500, quantity: 1 }, { sku_id: SKU.bm1, quantity: 3 }] };
    const other = { ...order, id: "o2", ref_no: 2, lines: [{ sku_id: SKU.bm1, quantity: 9 }] };
    const p = planImport(FILES, { ...none, orders: [order, other] }, "2026-11-06");
    expect(p.order_links).toEqual([{ order_id: "o1", ref_no: 1, bill_key: "I4", number: "INV-000004" }]);
    expect(p.check_orders).toEqual([{ order_id: "o2", ref_no: 2, phone: "9876543210", delivered_on: "2026-11-01", candidates: [] }]);
  });
});

describe("through the server", () => {
  const a = plant();
  const b = plant();
  const input = { files: { contacts: "Contacts.csv", invoices: "Invoice.csv", payments: "Customer_Payment.csv" }, export_date: "2026-11-06", ...FILES };
  let customerId: string;
  let orderId: string;

  beforeAll(async () => {
    // plant A already has Sri ram hotel (9876543210) with a delivered order O-0001: 500ml × 1 + 1L × 3, delivered 2 Nov
    const one = async (text: string) => ((await asApp(a.tenantId, text)).rows[0] as { id: string }).id;
    customerId = await one(`insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name)
      values ('${a.tenantId}', 'Sri Ram Hotel', '9876543210', '9876543210', 'Bijepur', gen_random_uuid(), 'Sujata') returning id`);
    orderId = await one(`insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, status, total, entered_by, entered_by_name, delivered_by, delivered_by_name, delivered_at)
      values ('${a.tenantId}', 1, 'key-${randomUUID()}', '${customerId}', 'Sri Ram Hotel', '9876543210', 'Bijepur', 'delivered', 510, gen_random_uuid(), 'Atharv', gen_random_uuid(), 'Atharv', '2026-11-02T06:00:00Z') returning id`);
    await asApp(a.tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
      values ('${a.tenantId}', '${orderId}', 1, 1, '${SKU.bm500}', '500ml', 'box', 1, 90, 90), ('${a.tenantId}', '${orderId}', 1, 2, '${SKU.bm1}', '1L', 'box', 3, 140, 420)`);
  });
  afterEach(() => vi.restoreAllMocks());
  const products = () => vi.spyOn(kit, "products").mockResolvedValue(SKUS.map((s) => ({ ...s, name: s.sku_code, volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" as const })));

  it("only the owner may import", async () => {
    products();
    for (const u of [a.desk, a.staff, a.support]) expect((await refused(() => previewZohoImport(u, input))).status).toBe(403);
  });

  it("owner: preview, then confirm saves it all; the plant's own customer name wins; the order is linked", async () => {
    products();
    const p = await previewZohoImport(a.owner, input);
    expect(p).toMatchObject({ matches_zoho: true, counts: { contacts_linked: 1, contacts_unmatched: 4, orders_linked: 1 }, order_links: [{ ref: "O-0001", bill: "INV-000004" }] });
    expect((await refused(() => confirmZohoImport(a.owner, { ...input, fingerprint: "0".repeat(64) }))).status).toBe(409);
    const saved = await confirmZohoImport(a.owner, { ...input, fingerprint: p.fingerprint });
    expect(saved).toMatchObject({ bills_new: 5, payments_new: 5, billed: "2776.40", received: "2430.00", due_after: "296.40" });

    const q = (text: string) => asOwner(text, [a.tenantId]).then((r) => r.rows);
    expect(await q("select name from order_capture.customers where tenant_id = $1 and phone = '9876543210'")).toEqual([{ name: "Sri Ram Hotel" }]);
    // no customer is made by the import
    expect(await q("select count(*)::int as n from order_capture.customers where tenant_id = $1")).toEqual([{ n: 1 }]);
    expect(await q("select number from order_capture.bills where tenant_id = $1 and order_id is not null")).toEqual([{ number: "INV-000004" }]);
    expect(await q("select mode, count(*)::int as n from order_capture.payments where tenant_id = $1 group by mode order by mode")).toEqual([{ mode: "bank", n: 1 }, { mode: "cash", n: 4 }]);
    // due per bill after the import, worked out from the rows: only INV-000002 owes ₹296.40
    const due = await q(`select b.number, b.total - coalesce((select sum(amount) from order_capture.payment_allocations x where x.bill_id = b.id), 0)
                                  - coalesce((select sum(amount) from order_capture.bill_adjustments x where x.bill_id = b.id), 0) as due
                           from order_capture.bills b where b.tenant_id = $1 order by b.number`);
    expect(due.filter((d) => Number(d.due) !== 0)).toEqual([{ number: "INV-000002", due: "296.40" }]);
    expect((await auditRows(a.tenantId)).map((r) => r.action)).toContain("zoho.import");
  });

  it("importing the same files again adds nothing", async () => {
    products();
    const p = await previewZohoImport(a.owner, input);
    expect(p.counts).toMatchObject({ contacts_new: 0, contacts_already: 5, bills_new: 0, bills_already: 5, payments_new: 0, payments_already: 5, adjustments: 0, orders_linked: 0 });
    expect(p.totals).toMatchObject({ billed: "0.00", received: "0.00" });
    const again = await confirmZohoImport(a.owner, { ...input, fingerprint: p.fingerprint });
    expect(again).toMatchObject({ bills_new: 0, payments_new: 0 });
    expect((await asOwner("select count(*)::int as n from order_capture.bills where tenant_id = $1", [a.tenantId])).rows[0]!.n).toBe(5);
  });

  it("a newer export adds only the new invoice and payment", async () => {
    products();
    const newer = {
      ...input,
      invoices: [...FILES.invoices, { ...FILES.invoices[1]!, zoho_id: "I5", number: "INV-000005", date: "2026-11-05", due_date: "2026-11-05", total: "100.00", sub_total: "100.00", balance: "0.00", adjustment: "0.00" }],
      payments: [...FILES.payments, { ...FILES.payments[2]!, zoho_id: "P7", number: "7", date: "2026-11-05", amount: "100.000", applied: [{ invoice: "INV-000005", amount: "100.00", date: "2026-11-05" }] }],
    };
    const p = await previewZohoImport(a.owner, newer);
    expect(p).toMatchObject({ matches_zoho: true, counts: { bills_new: 1, payments_new: 1, bills_already: 5 } });
  });

  it("another plant sees none of it", async () => {
    expect((await asApp(b.tenantId, "select * from order_capture.bills")).rows).toEqual([]);
    expect((await asApp(b.tenantId, "select * from order_capture.zoho_contacts")).rows).toEqual([]);
  });
});

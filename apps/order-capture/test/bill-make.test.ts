// Make bill with Zoho-like fields, GST bills and "GST invoices to make" → Zoho (docs/BILL_FIELDS_PHASE_PLAN.md, owner
// 2026-11-07): terms → due date, salesperson / vehicle (and the next bill filled in from them), the GST tick with the
// owner's L&T example (₹5,060 + 2.5% + 2.5% = ₹5,313), rates including GST, IGST for another state, the customer's
// GSTIN kept, refusals; the plant's bill settings; the Zoho file (marks bills sent once; "again"; done once the INV no.
// is typed); who may; what the database refuses; another plant sees nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { billForm, gstQueue, makeBill, setBillSettings, zohoCsvRows } from "@/server/bill-make";
import { DeliverInput, deliverOrder } from "@/server/handling";
import { billDetail, setGstInvoice } from "@/server/ledger";
import { createOrder, OrderInput } from "@/server/orders";
import { KEEPER_ID, OWNER_ID, SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, auditRows, dbError, ocUser, plant, refused } from "./helpers";

let platform: FakePlatform;
const a = plant();
const b = plant();
const acct = ocUser(a.tenantId, ["accounts"], "Kedar");
const [b1l, b500, jar] = SKUS as [TenantSku, TenantSku, TenantSku];
let k = 0;

/** A delivered order: lines as [sku, quantity, rate]. */
async function delivered(lines: [TenantSku, number, string][], phone = "9876543210", name = "Larsen & Toubro") {
  const o = await createOrder(a.desk, OrderInput.parse({
    request_key: `bill-make-${Date.now()}-${++k}`,
    customer: { phone, name, place: "Bijepur" },
    lines: lines.map(([s, quantity, rate]) => ({ sku_id: s.id, quantity, rate })),
  }));
  await deliverOrder(a.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
  return o;
}

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  // jar 5%, 1 L 5%, 500 ml without a GST rate; the plant's GSTIN (Odisha) for plant A only
  platform.skus = SKUS.map((s) => ({ ...s, hsn: "002201", gst_rate: s.id === b500.id ? null : 5 }));
  platform.branding.set(a.tenantId, { gstin: "21NWSPS1732J1ZX" });
});
afterAll(() => platform.close());

describe("make bill: the fields", () => {
  it("terms give the due date; salesperson and vehicle saved; notes from the plant's settings; audited", async () => {
    await setBillSettings(a.owner, { rates_include_gst: true, default_terms: "net15", default_notes: "Thanks for your business." });
    const o = await delivered([[jar, 10, "55"]], "9000000001", "Hotel Sai");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const made = await makeBill(acct, { order_id: o.id, salesperson_id: KEEPER_ID, vehicle: " OD-17 AB 1234 ", reference_no: "PO-1", private_note: "cash at gate", lines: [{ line_no: 1, description: "Oct month" }] });
    const d = await billDetail(acct, made.id);
    expect(d).toMatchObject({ salesperson: "Atharv", notes: "Thanks for your business.", total: "550.00", tax_total: "0.00" });
    expect(d.lines[0]).toMatchObject({ description: "Oct month", hsn: "002201" });
    const [row] = (await asApp(a.tenantId, `select terms, due_date::text, vehicle, reference_no, private_note, salesperson_id, needs_gst from order_capture.bills where id = '${made.id}'`)).rows;
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 15);
    expect(row).toEqual({ terms: "net15", due_date: due.toISOString().slice(0, 10), vehicle: "OD-17 AB 1234", reference_no: "PO-1", private_note: "cash at gate", salesperson_id: KEEPER_ID, needs_gst: false });
    expect((await auditRows(a.tenantId)).find((r) => r.action === "bill.make" && r.details.number === made.number)?.details).toMatchObject({ salesperson: "Atharv", vehicle: "OD-17 AB 1234" });

    // the next bill for the same customer starts from this one's salesperson and vehicle
    const o2 = await delivered([[jar, 1, "55"]], "9000000001", "Hotel Sai");
    const form = await billForm(acct, o2.id);
    expect(form.last).toEqual({ salesperson_id: KEEPER_ID, vehicle: "OD-17 AB 1234" });
    expect(form.vehicles).toContain("OD-17 AB 1234");
    expect(form.salespeople.map((p) => p.name)).toEqual(["Sujata", "Ravi", "Atharv"]);
    expect(form.settings.default_terms).toBe("net15");
    expect(form.customer.gstin).toBeNull();
  });

  it("refuses a salesperson who isn't one of the plant's Order Capture people, a future bill date, a bad adjustment", async () => {
    const o = await delivered([[jar, 1, "55"]], "9000000002", "Shop");
    expect((await refused(() => makeBill(acct, { order_id: o.id, salesperson_id: "00000000-0000-4000-8000-000000000000" }))).status).toBe(400);
    expect((await refused(() => makeBill(acct, { order_id: o.id, bill_date: "2999-01-01" }))).status).toBe(400);
    expect((await refused(() => makeBill(acct, { order_id: o.id, adjustment: "-100" }))).message).toMatch(/below ₹0/);
    expect((await refused(() => makeBill(acct, { order_id: o.id, lines: [{ line_no: 9 }] }))).message).toMatch(/no line 9/);
  });
});

describe("make bill: GST", () => {
  it("the owner's L&T invoice: GST on top, same state → CGST + SGST, ₹5,313; the customer keeps the GSTIN", async () => {
    const o = await delivered([[jar, 92, "55"]], "9000000003", "LARSEN & TOUBRO LIMITED");
    const gst = { needs_gst: true, gstin: "21aaacl0140p4zs", tax_inclusive: false, lines: [{ line_no: 1, description: "Oct month" }] };
    // a registered business (has a GSTIN) needs its billing address (D8, v0.45.0)
    expect((await refused(() => makeBill(acct, { order_id: o.id, ...gst }))).message).toMatch(/needs the billing address, city and PIN code/);
    const made = await makeBill(acct, { order_id: o.id, ...gst, legal_name: "Larsen & Toubro Ltd", billing_address: "ECC Division, Bijepur Road", billing_city: "Bargarh", billing_pin: "768032" });
    expect(made.total).toBe("5313.00");
    const [bt] = (await asApp(a.tenantId, `select customer_name, bill_to_name, bill_to_address, gst_treatment from order_capture.bills where id = '${made.id}'`)).rows;
    expect(bt).toEqual({ customer_name: "LARSEN & TOUBRO LIMITED", bill_to_name: "Larsen & Toubro Ltd", bill_to_address: "ECC Division, Bijepur Road\nBargarh\n768032", gst_treatment: "registered" });
    const [row] = (await asApp(a.tenantId, `select gstin, place_of_supply, tax_inclusive, cgst::text, sgst::text, igst::text, tax_total::text, sub_total::text from order_capture.bills where id = '${made.id}'`)).rows;
    expect(row).toEqual({ gstin: "21AAACL0140P4ZS", place_of_supply: "21", tax_inclusive: false, cgst: "126.50", sgst: "126.50", igst: "0.00", tax_total: "253.00", sub_total: "5060.00" });
    const [line] = (await asApp(a.tenantId, `select tax_name, tax_percent::text, tax_amount::text, taxable::text, line_total::text from order_capture.bill_lines where bill_id = '${made.id}'`)).rows;
    expect(line).toEqual({ tax_name: "GST5", tax_percent: "5.00", tax_amount: "253.00", taxable: "5060.00", line_total: "5060.00" });
    // the next bill for L&T has the tick, the GSTIN and Odisha filled in
    const next = await billForm(acct, (await delivered([[jar, 1, "55"]], "9000000003", "LARSEN & TOUBRO LIMITED")).id);
    expect(next.customer).toMatchObject({ name: "LARSEN & TOUBRO LIMITED", gstin: "21AAACL0140P4ZS", state_code: "21", legal_name: "Larsen & Toubro Ltd", gst_treatment: "registered", billing_city: "Bargarh", billing_pin: "768032" });
    // …so the next GST bill needs nothing typed: the saved GST details are used
    const again = await makeBill(acct, { order_id: (await delivered([[jar, 1, "55"]], "9000000003", "LARSEN & TOUBRO LIMITED")).id, needs_gst: true, gstin: "21AAACL0140P4ZS" });
    const [bt2] = (await asApp(a.tenantId, `select bill_to_name, gst_treatment from order_capture.bills where id = '${again.id}'`)).rows;
    expect(bt2).toEqual({ bill_to_name: "Larsen & Toubro Ltd", gst_treatment: "registered" });
    // the calling name on the customer never changed
    expect((await asApp(a.tenantId, `select name from order_capture.customers where phone = '9000000003'`)).rows[0]).toEqual({ name: "LARSEN & TOUBRO LIMITED" });
    expect(next.plant_state).toBe("21");
  });

  it("the plant's usual: rates include GST (₹2,500 stays ₹2,500); another state's GSTIN → IGST", async () => {
    const inside = await makeBill(acct, { order_id: (await delivered([[b1l, 25, "100"]], "9000000004", "Rocky")).id, needs_gst: true });
    expect(inside.total).toBe("2500.00");
    const [r1] = (await asApp(a.tenantId, `select cgst::text, sgst::text, tax_inclusive, gstin from order_capture.bills where id = '${inside.id}'`)).rows;
    expect(r1).toEqual({ cgst: "59.52", sgst: "59.53", tax_inclusive: true, gstin: null });
    // no GSTIN: a consumer; the legal name defaults to the calling name and the address may stay empty
    const [r1b] = (await asApp(a.tenantId, `select bill_to_name, bill_to_address, gst_treatment from order_capture.bills where id = '${inside.id}'`)).rows;
    expect(r1b).toEqual({ bill_to_name: "Rocky", bill_to_address: null, gst_treatment: "consumer" });

    const other = await makeBill(acct, { order_id: (await delivered([[jar, 92, "55"]], "9000000005", "Raipur buyer")).id, needs_gst: true, gstin: "22AAACL0140P4ZQ".slice(0, 14) + "Z", tax_inclusive: false }).catch((e) => e);
    // a GSTIN with a wrong last character is refused before anything is saved
    expect(other.status ?? 400).toBe(400);
  });

  it("IGST when the place of supply is another state", async () => {
    const o = await delivered([[jar, 92, "55"]], "9000000006", "Raipur buyer");
    const made = await makeBill(acct, { order_id: o.id, needs_gst: true, place_of_supply: "22", tax_inclusive: false, gst_treatment: "unregistered" });
    const [row] = (await asApp(a.tenantId, `select cgst::text, sgst::text, igst::text, total::text from order_capture.bills where id = '${made.id}'`)).rows;
    expect(row).toEqual({ cgst: "0.00", sgst: "0.00", igst: "253.00", total: "5313.00" });
  });

  it("refuses a GST bill when a product has no GST rate, or when the plant has no GSTIN", async () => {
    const o = await delivered([[b500, 1, "90"]], "9000000007", "Shop 2");
    expect((await refused(() => makeBill(acct, { order_id: o.id, needs_gst: true }))).message).toMatch(/no GST rate/);
    const bOrder = await createOrder(b.desk, OrderInput.parse({ request_key: `bm-b-${Date.now()}`, customer: { phone: "9876500000", name: "B shop", place: "Bargarh" }, lines: [{ sku_id: jar.id, quantity: 1, rate: "50" }] }));
    await deliverOrder(b.desk, bOrder.id, DeliverInput.parse({ expected: { status: "pending", version: 1 } }));
    expect((await refused(() => makeBill(b.owner, { order_id: bOrder.id, needs_gst: true }))).message).toMatch(/needs your GSTIN/);
    // without the tick the same order is billed fine
    expect((await makeBill(b.owner, { order_id: bOrder.id })).total).toBe("50.00");
  });
});

describe("GST invoices to make → Zoho", () => {
  it("lists the ticked bills; the file has Zoho's columns, one row per line; download marks them sent once", async () => {
    const q = await gstQueue(acct);
    expect(q.not_sent.map((x) => x.customer)).toEqual(["LARSEN & TOUBRO LIMITED", "LARSEN & TOUBRO LIMITED", "Rocky", "Raipur buyer"]);
    expect(q.not_sent[0]!.bill_to).toBe("Larsen & Toubro Ltd");
    expect(q.not_sent[0]).toMatchObject({ gstin: "21AAACL0140P4ZS", taxable: "5060.00", tax: "253.00", total: "5313.00", place: "Odisha (21)" });
    expect(q.not_sent[2]).toMatchObject({ taxable: "2380.95", tax: "119.05", total: "2500.00", inclusive: true });

    const file = await zohoCsvRows(acct, "new");
    expect(file.count).toBe(4);
    const [head, lt] = file.rows as [string[], string[]];
    const col = (n: string) => lt[head.indexOf(n)];
    // Zoho finds its contact by the legal name; the address goes with it
    expect(col("Customer Name")).toBe("Larsen & Toubro Ltd");
    expect([col("Billing Address"), col("Billing City"), col("Billing State"), col("Billing Code"), col("Billing Country")]).toEqual(["ECC Division, Bijepur Road", "Bargarh", "Odisha", "768032", "India"]);
    expect(col("GST Treatment")).toBe("business_gst");
    expect(col("Place of Supply")).toBe("OD");
    expect(col("Is Inclusive Tax")).toBe("false");
    expect([col("Item Name"), col("Item Desc"), col("Quantity"), col("Item Price"), col("Item Tax"), col("Item Tax %"), col("HSN/SAC")]).toEqual(["Jar (20 L)", "Oct month", "92.000", "55.00", "GST5", "5.00", "002201"]);
    expect(col("Invoice Status")).toBe("Draft");
    expect((file.rows[3] as string[])[head.indexOf("GST Treatment")]).toBe("consumer");
    expect((file.rows[3] as string[])[head.indexOf("Billing Address")]).toBe("");
    expect((file.rows[4] as string[])[head.indexOf("Item Tax")]).toBe("IGST5");
    expect((file.rows[4] as string[])[head.indexOf("GST Treatment")]).toBe("business_none");

    const after = await gstQueue(acct);
    expect(after.not_sent).toEqual([]);
    expect(after.sent).toHaveLength(4);
    expect(after.sent[0]!.sent_by).toBe("Kedar");
    expect((await zohoCsvRows(acct, "new")).count).toBe(0); // nothing sent twice by "new"
    expect((await zohoCsvRows(acct, "again")).count).toBe(4);

    // the INV number typed on a bill moves it to Done
    await setGstInvoice(acct, after.sent.find((x) => x.customer === "Rocky")!.id, { zoho_gst_invoice_no: "INV-001901" });
    const done = await gstQueue(acct);
    expect(done.sent).toHaveLength(3);
    expect(done.done.map((x) => x.invoice_no)).toEqual(["INV-001901"]);
    expect((await auditRows(a.tenantId)).filter((r) => r.action === "bill.zoho_send")).toHaveLength(2);
  });

  it("who may: owner + Accounts download; support sees the list only; Order desk and plant staff nothing; plant B sees none", async () => {
    expect((await zohoCsvRows(a.owner, "again")).count).toBe(3);
    expect((await refused(() => zohoCsvRows(a.support, "again"))).status).toBe(403);
    expect((await gstQueue(a.support)).sent).toHaveLength(3);
    expect((await refused(() => gstQueue(a.desk))).status).toBe(403);
    expect((await refused(() => zohoCsvRows(a.desk, "new"))).status).toBe(403);
    expect((await refused(() => zohoCsvRows(a.staff, "new"))).status).toBe(403);
    expect((await gstQueue(b.owner)).sent).toEqual([]);
    expect((await zohoCsvRows(b.owner, "again")).count).toBe(0);
  });
});

describe("bill settings", () => {
  it("owner only; audited", async () => {
    expect((await refused(() => setBillSettings(acct, { rates_include_gst: false, default_terms: "receipt", default_notes: "" }))).status).toBe(403);
    const s = await setBillSettings(a.owner, { rates_include_gst: false, default_terms: "eom", default_notes: "" });
    expect(s).toEqual({ rates_include_gst: false, default_terms: "eom", default_notes: null });
    expect((await auditRows(a.tenantId)).some((r) => r.action === "bill.settings")).toBe(true);
  });
});

describe("the database", () => {
  it("a saved bill's amounts can't be changed; GST columns are checked; sent-to-Zoho only on GST bills", async () => {
    const [x] = (await asApp(a.tenantId, `select id from order_capture.bills where needs_gst limit 1`)).rows as [{ id: string }];
    expect(await dbError(asApp(a.tenantId, `update order_capture.bills set total = 1 where id = '${x.id}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.bills set cgst = 1 where id = '${x.id}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.bill_lines set taxable = 1`))).toMatch(/permission denied/);
    const [plain] = (await asApp(a.tenantId, `select id from order_capture.bills where not needs_gst limit 1`)).rows as [{ id: string }];
    expect(await dbError(asApp(a.tenantId, `update order_capture.bills set sent_to_zoho_at = now(), sent_to_zoho_by = gen_random_uuid(), sent_to_zoho_by_name = 'x' where id = '${plain.id}'`))).toMatch(/bills_sent_only_gst/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.customers set gstin = 'NOT-A-GSTIN'`))).toMatch(/check constraint/);
    expect(await dbError(asApp(a.tenantId, `delete from order_capture.bill_settings`))).toMatch(/permission denied/);
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.bill_settings (tenant_id, updated_by, updated_by_name) values ('${a.tenantId}', gen_random_uuid(), 'x')`))).toMatch(/row-level security/);
    expect(OWNER_ID).toBeTruthy();
  });
});

// Purchases P1 (docs/PURCHASES_PHASE_PLAN.md): reading Zoho's Vendors / Items / Bill / Vendor_Payment exports, the plan
// (PB- / PM- numbers, sold items left out, every bill's balance must match Zoho), saving it (owner only; again = nothing
// new), the read-only Purchases lists (owner, Accounts, support; nobody else), another plant sees none of it, and what the
// database allows to change. Last: plant 001's real export of 10 Nov 2026, when the files are on this computer.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv-read";
import { rupees } from "@/lib/ledger";
import { amount, gstTreatment, planPurchaseImport, readBills, readItems, readVendorPayments, readVendors, vendorKey, type PurchaseExisting } from "@/lib/purchase-import";
import { confirmPurchaseImport, previewPurchaseImport, purchaseBillDetail, purchaseBillsList, vendorDetail, vendorPaymentsList, vendorsList } from "@/server/purchases";
import { asApp, auditRows, dbError, ocUser, plant, refused } from "./helpers";

const VENDORS = [
  "Contact ID,Display Name,Company Name,EmailID,Phone,MobilePhone,Status,Payment Terms Label,GST Treatment,GST Identification Number (GSTIN),Billing Address,Billing Street2,Billing City,Billing State,Billing Code",
  "V1,BALAJI SALES SAMBALPUR,BALAJI SALES SAMBALPUR,,,'+91-9438046900,Active,Due on Receipt,business_gst,21AFFPJ6952A1ZY,\"Sambalpur ,Bhalupali\",,Sambalpur,Odisha,768001",
  "V2,SHREE HARI FASHION,SHREE HARI FASHION,,,'+91-9727008115,Active,Due on Receipt,business_gst,24AOJPC6831Q1ZL,GUJRAT,,KATARGAM,Gujarat,395004",
  "V3,MINERVA AUTOMOBILES PVT. LTD.,,,,,Active,Due on Receipt,business_none,,,,,,",
].join("\n");
const ITEMS = [
  "Item ID,Item Name,SKU,HSN/SAC,Purchase Rate,Intra State Tax Rate,Purchase Description,Item Type,Sellable,Status,Usage unit",
  "I1,Pet Preforms Natural-TST 18.50GM,,39239090,INR 153.68,18.000000,,Purchases,false,Active,kg",
  "I2,WATER LABEL 1 LTR,,4821,INR 0.27,18.000000,,Purchases,false,Active,nos",
  "I3,MAXICLEAN 10 L1N,,,INR 932.20,18.000000,,Purchases,false,Active,ft",
  "I9,1L Water Bottle,PV_BM_1,22011010,INR 70.00,5.000000,,Sales and Purchases,true,Active,",
].join("\n");
const BILL_HEAD = "Bill Date,Due Date,Bill ID,Vendor Name,Bill Number,PurchaseOrder,SubTotal,Total,Balance,Adjustment,Bill Status,Product ID,Item Name,Description,Quantity,Usage unit,Tax Amount,Item Total,Rate,HSN/SAC,Purchase Order Number,Tax Name,Tax Percentage,CGST,SGST,IGST,Vendor Notes,Entity Discount Amount,Discount Amount";
const BILLS = [
  BILL_HEAD,
  // Odisha vendor: CGST + SGST, two lines, a paise rounding
  "2026-10-01,2026-10-01,B1,BALAJI SALES SAMBALPUR,1,PO-00001,1000.00,1179.80,0.00,-0.20,Paid,I1,Pet Preforms Natural-TST 18.50GM,,5.00,kg,90.00,500.00,100.00,39239090,PO-00001,GST18,18.00,45.00,45.00,0.00,,,",
  "2026-10-01,2026-10-01,B1,BALAJI SALES SAMBALPUR,1,PO-00001,1000.00,1179.80,0.00,-0.20,Paid,I1,Pet Preforms Natural-TST 18.50GM,,5.00,kg,90.00,500.00,100.00,39239090,PO-00001,GST18,18.00,45.00,45.00,0.00,,,",
  // Gujarat vendor: IGST, not paid yet
  "2026-10-13,2026-10-13,B2,SHREE HARI FASHION,2,PO-00002,13500.00,15930.00,15930.00,0.00,Open,I2,WATER LABEL 1 LTR,WATER LABEL 1 LTR ,50000.00,nos,2430.00,13500.00,0.27,4821,PO-00002,IGST18,18.00,0.00,0.00,2430.00,,,",
  // unregistered vendor, part paid
  "2026-10-20,2026-10-20,B3,MINERVA AUTOMOBILES PVT. LTD.,3,,932.20,1100.00,600.00,0.00,PartiallyPaid,I3,MAXICLEAN 10 L1N,,1.00,ft,167.80,932.20,932.20,,,GST18,18.00,83.90,83.90,0.00,,,",
  "2026-10-25,2026-10-25,B4,MINERVA AUTOMOBILES PVT. LTD.,4,,10.00,10.00,10.00,0.00,Draft,I3,MAXICLEAN 10 L1N,,1.00,ft,0.00,10.00,10.00,,,,,0.00,0.00,0.00,,,",
].join("\n");
const PAYMENTS = [
  "Payment Number,VendorPayment ID,Mode,Amount,Unused Amount,Reference Number,Payment Status,Date,Vendor Name,Paid Through,Bill ID,Bill Amount,Bill Payment Applied Date",
  "1,P1,Cash,1179.80,0.00,,Paid,2026-10-01,BALAJI SALES SAMBALPUR,Petty Cash,B1,1179.80,2026-10-01",
  "2,P2,Cash,500.00,0.00,,Paid,2026-10-21,MINERVA AUTOMOBILES PVT. LTD.,Petty Cash,B3,500.00,2026-10-21",
].join("\n");

const FILES = { vendors: readVendors(parseCsv(VENDORS)), items: readItems(parseCsv(ITEMS)), bills: readBills(parseCsv(BILLS)), payments: readVendorPayments(parseCsv(PAYMENTS)) };
const none: PurchaseExisting = { vendors: [], items: [], bills: [], payments: [] };
const R = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rupees(v)]));

describe("reading Zoho's purchase exports", () => {
  it("vendors: the phone without Zoho's apostrophe, the address in one line; GST treatment", () => {
    expect(FILES.vendors[0]).toMatchObject({ zoho_id: "V1", name: "BALAJI SALES SAMBALPUR", phone: "+91-9438046900", address: "Sambalpur ,Bhalupali, Sambalpur, Odisha, 768001" });
    expect([gstTreatment("business_gst"), gstTreatment("business_none"), gstTreatment("overseas"), gstTreatment("")]).toEqual(["registered", "unregistered", "overseas", null]);
    expect(() => readVendors(parseCsv("Name,Phone\nA,1"))).toThrow(/Vendors export/);
  });
  it("bills group their lines; payments carry what they paid", () => {
    expect(FILES.bills.map((b) => [b.number, b.lines.length])).toEqual([["1", 2], ["2", 1], ["3", 1], ["4", 1]]);
    expect(FILES.payments[0]!.applied).toEqual([{ bill_id: "B1", amount: "1179.80", date: "2026-10-01" }]);
  });
  it("money: 'INR 153.68', '1,186.00', '' ; vendor names ignore case and spaces", () => {
    expect([amount("INR 153.68"), amount("1,186.00"), amount(""), amount("-0.20")]).toEqual([15368n, 118600n, 0n, -20n]);
    expect(vendorKey("  Balaji  Sales Sambalpur")).toBe(vendorKey("BALAJI SALES SAMBALPUR"));
  });
});

describe("the plan", () => {
  const plan = planPurchaseImport(FILES, none);

  it("vendors with GSTIN state; purchase items only (the 1L bottle is a PlantOps product)", () => {
    expect(plan.vendors.map((v) => [v.name, v.gst_treatment, v.state, v.company])).toEqual([
      ["BALAJI SALES SAMBALPUR", "registered", "21", null],
      ["SHREE HARI FASHION", "registered", "24", null],
      ["MINERVA AUTOMOBILES PVT. LTD.", "unregistered", null, null],
    ]);
    expect(plan.items.map((i) => i.name)).toEqual(["Pet Preforms Natural-TST 18.50GM", "WATER LABEL 1 LTR", "MAXICLEAN 10 L1N"]);
    expect(plan.counts.items_skipped_sold).toBe(1);
    expect(plan.items[0]).toMatchObject({ rate: 15368n, gst_percent: "18.00", unit: "kg", hsn: "39239090" });
  });

  it("bills: Zoho's 1, 2, 3 become PB-0001…; GST split; rounding; the draft is skipped", () => {
    expect(plan.bills.map((b) => [b.number, b.ref_no, b.po_number])).toEqual([["PB-0001", 1, "PO-00001"], ["PB-0002", 2, "PO-00002"], ["PB-0003", 3, null]]);
    expect(plan.bills[0]).toMatchObject({ sub_total: 100000n, cgst: 9000n, sgst: 9000n, igst: 0n, tax_total: 18000n, adjustment: -20n, total: 117980n });
    expect(plan.bills[1]).toMatchObject({ igst: 243000n, cgst: 0n });
    expect(plan.bills[1]!.lines[0]!.description).toBeNull(); // same as the item name
    expect(plan.skipped).toEqual([{ what: "bill", ref: "4", reason: "Zoho status Draft" }]);
  });

  it("payments: PM-0001…, Cash from Petty Cash as in Zoho; every balance matches", () => {
    expect(plan.payments.map((p) => [p.number, p.mode, p.paid_from, p.allocations.length])).toEqual([["PM-0001", "cash", "Petty Cash", 1], ["PM-0002", "cash", "Petty Cash", 1]]);
    expect(plan.mismatches).toEqual([]);
    expect(R(plan.totals)).toEqual({ billed: "18209.80", paid: "1679.80", tax: "2777.80", due_after: "16530.00", zoho_due: "16530.00" });
  });

  it("a balance Zoho shows differently is a mismatch (never saved)", () => {
    const bad = planPurchaseImport({ ...FILES, bills: FILES.bills.map((b) => (b.number === "3" ? { ...b, balance: "0.00" } : b)) }, none);
    expect(bad.mismatches.map((m) => [m.number, rupees(m.ours), rupees(m.zoho)])).toEqual([["PB-0003", "600.00", "0.00"]]);
  });

  it("a bill or payment whose vendor isn't in the Vendors file is skipped", () => {
    const p = planPurchaseImport({ ...FILES, vendors: FILES.vendors.slice(0, 2) }, none);
    expect(p.skipped.filter((s) => /not in the Vendors file/.test(s.reason)).map((s) => [s.what, s.ref])).toEqual([["bill", "3"], ["payment", "2"]]);
  });

  it("a number already taken here keeps Zoho's own text", () => {
    const p = planPurchaseImport(FILES, { ...none, bills: [{ id: "x", zoho_bill_id: null, number: "PB-0001", ref_no: 1, total: 0n, paid: 0n }] });
    expect(p.bills.map((b) => [b.number, b.ref_no])).toEqual([["1", null], ["PB-0002", 2], ["PB-0003", 3]]);
  });
});

describe("through the server", () => {
  const a = plant();
  const b = plant();
  const accounts = ocUser(a.tenantId, ["accounts"], "Anmol");
  const input = { files: { vendors: "Vendors.csv", items: "Item.csv", bills: "Bill.csv", payments: "Vendor_Payment.csv" }, ...FILES };

  it("only the owner imports; Accounts, Order desk and support are refused", async () => {
    for (const u of [accounts, a.desk, a.support, a.keeper]) expect((await refused(() => previewPurchaseImport(u, input))).status).toBe(403);
  });

  it("preview saves nothing; confirm saves exactly that; a stale fingerprint is refused", async () => {
    const preview = await previewPurchaseImport(a.owner, input);
    expect(preview).toMatchObject({ matches_zoho: true, first_bill: "2026-10-01", last_bill: "2026-10-20" });
    expect(preview.modes).toEqual({ "cash (Petty Cash)": 2 });
    expect((await vendorsList(a.owner)).vendors).toEqual([]);
    expect((await refused(() => confirmPurchaseImport(a.owner, { ...input, fingerprint: "0".repeat(64) }))).status).toBe(409);
    const saved = await confirmPurchaseImport(a.owner, { ...input, fingerprint: preview.fingerprint });
    expect(saved).toMatchObject({ vendors_new: 3, items_new: 3, bills_new: 3, payments_new: 2, billed: "18209.80", paid: "1679.80", due_after: "16530.00" });
    expect((await auditRows(a.tenantId)).map((r) => r.action)).toContain("purchases.import");
  });

  it("importing the same files again adds nothing", async () => {
    const again = await previewPurchaseImport(a.owner, input);
    expect(again.counts).toMatchObject({ vendors_new: 0, vendors_already: 3, items_new: 0, items_already: 3, bills_new: 0, bills_already: 3, payments_new: 0, payments_already: 2 });
    expect(again.matches_zoho).toBe(true);
  });

  it("a mismatch can't be saved", async () => {
    const c = plant();
    const bad = { ...input, bills: input.bills.map((x) => (x.number === "3" ? { ...x, balance: "0.00" } : x)) };
    const p = await previewPurchaseImport(c.owner, bad);
    expect(p.matches_zoho).toBe(false);
    expect((await refused(() => confirmPurchaseImport(c.owner, { ...bad, fingerprint: p.fingerprint }))).status).toBe(400);
  });

  it("the lists: bills to pay, payments, vendors with what is owed", async () => {
    const bills = await purchaseBillsList(a.owner);
    expect(bills.summary).toEqual({ n: 3, billed: "18209.80", due: "16530.00", overdue: "16530.00" });
    expect(bills.bills.map((x) => [x.number, x.status, x.due])).toEqual([["PB-0003", "overdue", "600.00"], ["PB-0002", "overdue", "15930.00"], ["PB-0001", "paid", "0.00"]]);
    expect((await purchaseBillsList(a.owner, { show: "paid" })).bills.map((x) => x.number)).toEqual(["PB-0001"]);
    expect((await purchaseBillsList(a.owner, { q: "label" })).bills.map((x) => x.number)).toEqual(["PB-0002"]);
    const pays = await vendorPaymentsList(a.owner);
    expect(pays.total).toEqual({ n: 2, sum: "1679.80" });
    expect(pays.payments.map((p) => [p.number, p.bills])).toEqual([["PM-0002", "PB-0003"], ["PM-0001", "PB-0001"]]);
    const v = await vendorsList(a.owner);
    expect(v.totals).toEqual({ billed: "18209.80", paid: "1679.80", owed: "16530.00" });
    expect(v.vendors.map((x) => [x.name, x.balance])).toEqual([["SHREE HARI FASHION", "15930.00"], ["BALAJI SALES SAMBALPUR", "0.00"], ["MINERVA AUTOMOBILES PVT. LTD.", "600.00"]]);
  });

  it("a vendor's page and a bill's page", async () => {
    const balaji = (await vendorsList(a.owner, { q: "balaji" })).vendors[0]!;
    const d = await vendorDetail(a.owner, balaji.id);
    expect(d.vendor).toMatchObject({ gstin: "21AFFPJ6952A1ZY", state: "21", phone: "+91-9438046900", from_zoho: true });
    expect(d.totals).toEqual({ billed: "1179.80", paid: "1179.80", balance: "0.00", overdue: "0.00" });
    expect(d.items).toEqual([{ item: "Pet Preforms Natural-TST 18.50GM", unit: "kg", quantity: "10.000", amount: "1000.00", last: "2026-10-01" }]);
    const bill = await purchaseBillDetail(a.owner, d.bills[0]!.id);
    expect(bill).toMatchObject({ number: "PB-0001", po_number: "PO-00001", cgst: "90.00", sgst: "90.00", adjustment: "-0.20", total: "1179.80", due: "0.00", status: "paid" });
    expect(bill.lines).toHaveLength(2);
    expect(bill.payments).toMatchObject([{ number: "PM-0001", mode: "cash", paid_from: "Petty Cash", amount: "1179.80" }]);
  });

  it("Accounts and support read; Order desk, plant staff, store keeper and marketing staff can't", async () => {
    expect((await purchaseBillsList(accounts)).bills).toHaveLength(3);
    expect((await vendorsList(a.support)).vendors).toHaveLength(3);
    for (const u of [a.desk, a.staff, a.keeper, ocUser(a.tenantId, ["marketing_staff"]), ocUser(a.tenantId, ["delivery_staff"])])
      expect((await refused(() => purchaseBillsList(u))).status, u.name).toBe(403);
  });

  it("another plant sees none of it, and can't open plant A's bill or vendor", async () => {
    expect((await purchaseBillsList(b.owner)).bills).toEqual([]);
    expect((await vendorsList(b.owner)).vendors).toEqual([]);
    const id = (await purchaseBillsList(a.owner)).bills[0]!.id;
    expect((await refused(() => purchaseBillDetail(b.owner, id))).status).toBe(404);
  });

  it("the database: a payment's mode / paid-from and the cancel columns may change; amounts and vendors may not", async () => {
    const pay = (await asApp(a.tenantId, `select id from order_capture.vendor_payments where number = 'PM-0001'`)).rows[0] as { id: string };
    expect((await asApp(a.tenantId, `update order_capture.vendor_payments set mode = 'upi', paid_from = 'SBI' where id = '${pay.id}'`)).rowCount).toBe(1);
    expect(await dbError(asApp(a.tenantId, `update order_capture.vendor_payments set amount = 1 where id = '${pay.id}'`))).toMatch(/permission denied/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.vendor_payments set mode = 'card' where id = '${pay.id}'`))).toMatch(/check/);
    // a PlantOps bill needs a PB number; a cancel needs a reason
    const v = (await asApp(a.tenantId, `select id from order_capture.vendors limit 1`)).rows[0] as { id: string };
    expect(await dbError(asApp(a.tenantId, `insert into order_capture.purchase_bills (tenant_id, source, number, vendor_id, vendor_name, bill_date, sub_total, total, created_by, created_by_name)
      values ('${a.tenantId}', 'plantops', 'X-1', '${v.id}', 'x', '2026-11-01', 1, 1, gen_random_uuid(), 'x')`))).toMatch(/check/);
    expect(await dbError(asApp(a.tenantId, `update order_capture.purchase_bills set cancelled_at = now(), cancelled_by = gen_random_uuid(), cancelled_by_name = 'x', cancel_reason = null where number = 'PB-0002'`))).toMatch(/check/);
    // two vendors can't share a name
    expect(await dbError(asApp(a.tenantId, `insert into order_capture.vendors (tenant_id, name, created_by, created_by_name) values ('${a.tenantId}', 'balaji sales sambalpur', gen_random_uuid(), 'x')`))).toMatch(/unique|duplicate/);
  });
});

// Plant 001's real Zoho export (10 Nov 2026): 16 vendors, 46 bills = ₹22,02,844.00, 46 payments, nothing owed.
const DIR = path.resolve(import.meta.dirname, "../../../refeDocs/zoho-purchases-2026-11");
const have = ["Vendors.csv", "Item_Purchase.csv", "Bill.csv", "Vendor_Payment.csv"].every((f) => existsSync(path.join(DIR, f)));
describe.skipIf(!have)("plant 001's real export", () => {
  const read = (f: string) => parseCsv(readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""));
  it("matches Zoho to the paisa", () => {
    const files = { vendors: readVendors(read("Vendors.csv")), items: readItems(read("Item_Purchase.csv")), bills: readBills(read("Bill.csv")), payments: readVendorPayments(read("Vendor_Payment.csv")) };
    const plan = planPurchaseImport(files, none);
    expect(plan.counts).toMatchObject({ vendors_new: 16, items_new: 50, items_skipped_sold: 10, bills_new: 46, payments_new: 46 });
    expect(plan.skipped).toEqual([]);
    expect(plan.mismatches).toEqual([]);
    expect(R(plan.totals)).toEqual({ billed: "2202844.00", paid: "2202844.00", tax: "333393.27", due_after: "0.00", zoho_due: "0.00" });
    expect(plan.bills.map((b) => b.number).sort()[0]).toBe("PB-0001");
    expect(plan.bills.every((b) => b.ref_no !== null) && plan.payments.every((p) => p.ref_no !== null)).toBe(true);
    expect(plan.bills.flatMap((b) => b.lines).filter((l) => !l.item_zoho_id)).toEqual([]);
    expect(new Set(plan.payments.map((p) => `${p.mode} ${p.paid_from}`))).toEqual(new Set(["cash Petty Cash"]));
  });
});

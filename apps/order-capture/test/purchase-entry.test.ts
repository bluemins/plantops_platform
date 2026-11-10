// Purchases P2 (docs/PURCHASES_PHASE_PLAN.md): Accounts and the owner enter purchases. The arithmetic (qty × rate, GST on
// top, CGST + SGST in the plant's state, IGST outside, rounding); vendors (GSTIN check, state from the GSTIN, one name per
// plant, switched-off vendors take no bills); purchase bills (new items made, PB numbers after the imported ones, "Paid
// now", a vendor's invoice no. only once, an advance used first); paying a vendor (oldest first, ticked, advance);
// correcting a payment's mode; the owner's cancels; the bells; who may do what; another plant can't touch any of it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rupees } from "@/lib/ledger";
import { lineAmount, purchaseAmounts } from "@/lib/purchase-amounts";
import { kit } from "@/server/kit";
import {
  addVendor, cancelPurchaseBill, cancelVendorPayment, payVendor, purchaseBillNotification, recordPurchaseBill, setPaymentMode, updateVendor, vendorPaymentNotification,
} from "@/server/purchase-entry";
import { purchaseBillDetail, vendorDetail, vendorsList } from "@/server/purchases";
import { asApp, auditRows, ocUser, plant, refused } from "./helpers";

const a = plant();
const b = plant();
const accounts = ocUser(a.tenantId, ["accounts"], "Anmol");
const V = (over: Record<string, unknown> = {}) => ({ name: "Balaji Sales Sambalpur", gstin: "21AFFPJ6952A1ZY", terms: "Due on Receipt", active: true, ...over }) as Parameters<typeof addVendor>[1];
const L = (over: Record<string, unknown> = {}) => ({ item_name: "Preform 18.5 g", quantity: "25", unit: "kg", rate: "153.68", gst_rate: 18, ...over });
const bill = (vendor_id: string, over: Record<string, unknown> = {}) => ({ vendor_id, bill_date: "2026-11-05", adjustment: "0", lines: [L()], ...over }) as Parameters<typeof recordPurchaseBill>[1];

beforeEach(() => {
  vi.spyOn(kit, "branding").mockResolvedValue({ name: "Bluemins", brand_color: "#2a3a9a", logo_url: null, gstin: "21ABCDE1234F1Z5" } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("the arithmetic", () => {
  it("quantity × rate in paise, rounded half up", () => {
    expect([lineAmount("50000", "0.27"), lineAmount("25", "153.68"), lineAmount("0.7", "825.71"), lineAmount("1.005", "1")]).toEqual([1350000n, 384200n, 57800n, 101n]);
  });
  it("same state: CGST + SGST; other state: IGST; rounding added", () => {
    const intra = purchaseAmounts([{ quantity: "25", rate: "153.68", gst_rate: 18 }, { quantity: "100", rate: "1", gst_rate: 5 }], -20n, true);
    expect([intra.sub_total, intra.cgst, intra.sgst, intra.igst, intra.total].map(rupees)).toEqual(["3942.00", "348.28", "348.28", "0.00", "4638.36"]);
    const inter = purchaseAmounts([{ quantity: "50000", rate: "0.27", gst_rate: 18 }], 0n, false);
    expect([inter.igst, inter.total].map(rupees)).toEqual(["2430.00", "15930.00"]);
  });
});

describe("vendors", () => {
  it("Accounts adds a vendor; the GSTIN gives the state; a wrong GSTIN and a second same name are refused", async () => {
    const v = await addVendor(accounts, V());
    expect((await vendorDetail(a.owner, v.id)).vendor).toMatchObject({ gstin: "21AFFPJ6952A1ZY", state: "21", gst_treatment: "registered", from_zoho: false });
    expect((await refused(() => addVendor(a.owner, V({ name: "Other", gstin: "21AFFPJ6952A1ZX" })))).status).toBe(400);
    expect((await refused(() => addVendor(a.owner, V({ name: "  BALAJI sales  sambalpur" })))).status).toBe(409);
    expect((await auditRows(a.tenantId)).some((r) => r.action === "vendor.add")).toBe(true);
  });
  it("a vendor without a GSTIN can have a state; edit and switch off", async () => {
    const v = await addVendor(a.owner, V({ name: "Shree Hari Fashion", gstin: "", state: "24" }));
    const d = await vendorDetail(a.owner, v.id);
    expect(d.vendor).toMatchObject({ gstin: null, state: "24", gst_treatment: "unregistered" });
    const u = await updateVendor(accounts, v.id, V({ name: "Shree Hari Fashion", gstin: "24AOJPC6831Q1ZL", phone: "9727008115" }));
    expect(u.changed.sort()).toEqual(["gstTreatment", "gstin", "phone"]);
    await updateVendor(a.owner, v.id, V({ name: "Shree Hari Fashion", gstin: "24AOJPC6831Q1ZL", active: false }));
    expect((await refused(() => recordPurchaseBill(accounts, bill(v.id)))).message).toMatch(/switched off/);
    await updateVendor(a.owner, v.id, V({ name: "Shree Hari Fashion", gstin: "24AOJPC6831Q1ZL", active: true }));
  });
  it("Order desk, plant staff, store keeper, marketing and support can't add vendors", async () => {
    for (const u of [a.desk, a.staff, a.keeper, a.support, ocUser(a.tenantId, ["marketing_staff"])]) expect((await refused(() => addVendor(u, V({ name: `X ${u.name}` })))).status, u.name).toBe(403);
  });
});

describe("purchase bills and payments", () => {
  const ids = { balaji: "", shree: "" };
  it("setup", async () => {
    const list = (await vendorsList(a.owner)).vendors;
    ids.balaji = list.find((v) => v.name === "Balaji Sales Sambalpur")!.id;
    ids.shree = list.find((v) => v.name === "Shree Hari Fashion")!.id;
    // an imported Zoho bill PB-0046 is already here: the next is PB-0047
    const imp = (await asApp(a.tenantId, `insert into order_capture.purchase_imports (tenant_id, imported_by, imported_by_name) values ('${a.tenantId}', gen_random_uuid(), 'x') returning id`)).rows[0] as { id: string };
    await asApp(a.tenantId, `insert into order_capture.purchase_bills (tenant_id, source, number, ref_no, zoho_bill_id, vendor_id, vendor_name, bill_date, sub_total, total, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', 'PB-0046', 46, 'zb-46', '${ids.balaji}', 'Balaji', '2026-10-31', 100, 100, '${imp.id}', gen_random_uuid(), 'x')`);
    await asApp(a.tenantId, `insert into order_capture.vendor_payments (tenant_id, source, number, ref_no, zoho_payment_id, vendor_id, vendor_name, payment_date, mode, amount, import_id, created_by, created_by_name)
      values ('${a.tenantId}', 'zoho', 'PM-0048', 48, 'zp-48', '${ids.balaji}', 'Balaji', '2026-10-31', 'cash', 100, '${imp.id}', gen_random_uuid(), 'x')`);
    await asApp(a.tenantId, `insert into order_capture.vendor_payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name)
      select '${a.tenantId}', p.id, b.id, 100, '2026-10-31', gen_random_uuid(), 'x' from order_capture.vendor_payments p, order_capture.purchase_bills b where p.number = 'PM-0048' and b.number = 'PB-0046' and p.tenant_id = '${a.tenantId}' and b.tenant_id = '${a.tenantId}'`);
  });

  it("Odisha vendor: CGST + SGST, PB-0047, a new purchase item made, to pay", async () => {
    const r = await recordPurchaseBill(accounts, bill(ids.balaji, { vendor_invoice_no: "BS/551", adjustment: "-0.20", lines: [L(), L({ item_name: "Caps D Blue", quantity: "8000", unit: "pcs", rate: "0.30" })] }));
    expect(r).toMatchObject({ number: "PB-0047", total: "7365.36", cgst: "561.78", sgst: "561.78", igst: "0.00", new_items: 2, payment: null });
    const d = await purchaseBillDetail(a.owner, r.id);
    expect(d).toMatchObject({ status: "overdue", due: "7365.36", vendor_invoice_no: "BS/551", adjustment: "-0.20", source: "plantops" });
    expect(d.lines.map((l) => [l.item, l.tax, l.total])).toEqual([["Preform 18.5 g", "GST18", "3842.00"], ["Caps D Blue", "GST18", "2400.00"]]);
  });

  it("the same vendor invoice no. twice is refused; the next bill reuses the item by name; future dates refused", async () => {
    expect((await refused(() => recordPurchaseBill(a.owner, bill(ids.balaji, { vendor_invoice_no: "bs/551" })))).status).toBe(409);
    const r = await recordPurchaseBill(a.owner, bill(ids.balaji, { lines: [L({ item_name: "preform 18.5 G", quantity: "10" })] }));
    expect(r).toMatchObject({ number: "PB-0048", new_items: 0, total: "1813.42" });
    expect((await refused(() => recordPurchaseBill(a.owner, bill(ids.balaji, { bill_date: "2999-01-01" })))).status).toBe(400);
  });

  it("Gujarat vendor: IGST; Paid now = PM after the imported PM-0048, bill paid", async () => {
    const r = await recordPurchaseBill(accounts, bill(ids.shree, { lines: [L({ item_name: "WATER LABEL 1 LTR", quantity: "50000", unit: "nos", rate: "0.27" })], paid_now: { mode: "bank", paid_from: "SBI", reference: "UTR123" } }));
    expect(r).toMatchObject({ number: "PB-0049", igst: "2430.00", cgst: "0.00", total: "15930.00", payment: { number: "PM-0049", amount: "15930.00" } });
    expect((await purchaseBillDetail(a.owner, r.id))).toMatchObject({ status: "paid", due: "0.00", payments: [{ number: "PM-0049", mode: "bank", paid_from: "SBI" }] });
  });

  it("pay vendor: oldest first; more than owed stays as advance; the next bill uses it", async () => {
    const p = await payVendor(accounts, { vendor_id: ids.balaji, payment_date: "2026-11-06", amount: "10000", mode: "cash", paid_from: "Petty Cash", reference: null, note: null, bill_ids: [] });
    expect(p).toMatchObject({ number: "PM-0050", bills: ["PB-0047", "PB-0048"], advance: "821.22" });
    expect((await vendorDetail(a.owner, ids.balaji)).totals).toMatchObject({ balance: "-821.22" });
    const next = await recordPurchaseBill(a.owner, bill(ids.balaji, { lines: [L({ quantity: "2" })] }));
    expect(next).toMatchObject({ number: "PB-0050", from_advance: "362.68", total: "362.68" });
    expect((await purchaseBillDetail(a.owner, next.id)).status).toBe("paid");
    expect((await vendorDetail(a.owner, ids.balaji)).payments.find((x) => x.number === "PM-0050")!.unused).toBe("458.54");
  });

  it("ticked bills only; a bill already paid can't be ticked", async () => {
    const one = await recordPurchaseBill(a.owner, bill(ids.balaji, { lines: [L({ quantity: "5" })] })); // 906.72, 458.54 of it from the advance
    const two = await recordPurchaseBill(a.owner, bill(ids.balaji, { bill_date: "2026-11-07", lines: [L({ quantity: "1" })] })); // 181.34
    const p = await payVendor(a.owner, { vendor_id: ids.balaji, payment_date: "2026-11-07", amount: "181.34", mode: "upi", paid_from: null, reference: null, note: null, bill_ids: [two.id] });
    expect(p.bills).toEqual(["PB-0052"]);
    expect((await purchaseBillDetail(a.owner, one.id)).due).toBe("448.18");
    expect((await refused(() => payVendor(a.owner, { vendor_id: ids.balaji, payment_date: "2026-11-07", amount: "1", mode: "cash", paid_from: null, reference: null, note: null, bill_ids: [two.id] })))).toMatchObject({ status: 409 });
  });

  it("Accounts corrects an imported payment's mode; cancelled payments can't be changed", async () => {
    const zp = (await vendorDetail(a.owner, ids.balaji)).payments.find((x) => x.number === "PM-0048")!;
    expect(await setPaymentMode(accounts, zp.id, { mode: "bank", paid_from: "SBI current" })).toEqual({ number: "PM-0048", mode: "bank", paid_from: "SBI current" });
    expect((await auditRows(a.tenantId)).find((r) => r.action === "purchase.payment_mode")!.details).toMatchObject({ from: "cash", to: "bank (SBI current)" });
  });

  it("only the owner cancels; a cancelled bill frees its payment as advance; a cancelled payment makes its bills due again", async () => {
    const d = await vendorDetail(a.owner, ids.balaji);
    const pb48 = d.bills.find((x) => x.number === "PB-0048")!;
    expect((await refused(() => cancelPurchaseBill(accounts, pb48.id, { reason: "typed twice" })))).toMatchObject({ status: 403 });
    await cancelPurchaseBill(a.owner, pb48.id, { reason: "typed twice" });
    expect((await vendorDetail(a.owner, ids.balaji)).payments.find((x) => x.number === "PM-0050")!.unused).toBe("1813.42");
    const pm = d.payments.find((x) => x.number === "PM-0049") ?? (await vendorDetail(a.owner, ids.shree)).payments.find((x) => x.number === "PM-0049")!;
    await cancelVendorPayment(a.owner, pm.id, { reason: "bounced" });
    const shreeBill = (await vendorDetail(a.owner, ids.shree)).bills[0]!;
    expect(shreeBill).toMatchObject({ status: "overdue", due: "15930.00" });
    expect((await refused(() => setPaymentMode(a.owner, pm.id, { mode: "cash", paid_from: null })))).toMatchObject({ status: 409 });
    expect((await refused(() => cancelVendorPayment(a.owner, pm.id, { reason: "again" })))).toMatchObject({ status: 409 });
  });

  it("the bells: owners and ticked people, never whoever did it", () => {
    const n = purchaseBillNotification(accounts, { id: "x", number: "PB-0047", vendor: "Balaji Sales Sambalpur", total: "7362.36", payment: null });
    expect(n).toMatchObject({ kind: "order_capture.purchase_bill", title: "Purchase ₹7,362.36 from Balaji Sales Sambalpur", body: "PB-0047, to pay (by Anmol)", level: "bell", exclude_user_id: accounts.userId });
    const p = vendorPaymentNotification(accounts, { id: "y", number: "PM-0050", vendor: "Balaji", amount: "10000.00", mode: "cash", bills: ["PB-0047"], advance: "821.22" });
    expect(p.body).toBe("PM-0050, cash. Paid PB-0047; ₹821.22 advance (by Anmol)");
  });

  it("another plant can't pay, bill or edit plant A's vendor", async () => {
    expect((await refused(() => payVendor(b.owner, { vendor_id: ids.balaji, payment_date: "2026-11-07", amount: "1", mode: "cash", paid_from: null, reference: null, note: null, bill_ids: [] })))).toMatchObject({ status: 404 });
    expect((await refused(() => recordPurchaseBill(b.owner, bill(ids.balaji))))).toMatchObject({ status: 404 });
    expect((await refused(() => updateVendor(b.owner, ids.balaji, V({ name: "Hacked" }))))).toMatchObject({ status: 404 });
    expect((await vendorsList(b.owner)).vendors).toEqual([]);
  });
});

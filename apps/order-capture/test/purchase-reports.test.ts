// Purchases P3 + P5 (docs/PURCHASES_PHASE_PLAN.md): the pure rules (by item with two units and the average rate, by
// vendor, GST per month, age bands, payables less advances), then the server on real rows: Payables (owner, Accounts),
// Reports → Purchases (owner), and the Store keeper's "Purchases received" (no money field at all), their tile, and that
// a Store keeper can't see anything else in Sales. Another plant sees none of it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rupees } from "@/lib/ledger";
import { ageBand, byItem, byVendor, gstByMonth, payables, qtyText, type PurchaseBillRow, type PurchaseLine } from "@/lib/purchase-report";
import { can, requireAccess } from "@/server/access";
import { kit } from "@/server/kit";
import { addVendor, payVendor, recordPurchaseBill } from "@/server/purchase-entry";
import { payablesReport, purchaseReport, purchasesReceived, purchasesTile } from "@/server/purchase-reports";
import { purchaseBillsList } from "@/server/purchases";
import { roleLabel } from "@/server/session";
import { ocUser, plant, refused } from "./helpers";

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({ bill_id: "b1", bill_date: "2026-10-01", vendor: "Balaji", item: "Preform 18.5", unit: "kg", qty_milli: 25_000n, amount: 384_200n, tax: 69_156n, ...over });
const bill = (over: Partial<PurchaseBillRow>): PurchaseBillRow => ({
  id: "b1", number: "PB-0001", bill_date: "2026-10-01", due_date: "2026-10-01", vendor_id: "v1", vendor: "Balaji",
  sub_total: 100_000n, cgst: 9_000n, sgst: 9_000n, igst: 0n, tax: 18_000n, total: 118_000n, paid: 0n, ...over,
});

describe("the rules", () => {
  it("by item: quantities per unit, the average rate only for one unit, biggest first", () => {
    const rows = byItem([
      line({}),
      line({ bill_id: "b2", bill_date: "2026-10-09", qty_milli: 12_500n, amount: 200_000n, tax: 36_000n }),
      line({ bill_id: "b3", item: "Caps", unit: "pcs", qty_milli: 8_000_000n, amount: 240_000n, tax: 43_200n, vendor: "Shlok" }),
      line({ bill_id: "b4", item: "caps", unit: "box", qty_milli: 1_000n, amount: 30_000n, tax: 5_400n, vendor: "Balaji" }),
    ]);
    expect(rows.map((r) => [r.label, r.bills, rupees(r.amount), r.avg_rate === null ? null : rupees(r.avg_rate), r.last])).toEqual([
      ["Preform 18.5", 2, "5842.00", "155.79", "2026-10-09"],
      ["Caps", 2, "2700.00", null, "2026-10-01"],
    ]);
    expect(rows[1]!.qty).toEqual([{ unit: "pcs", milli: 8_000_000n }, { unit: "box", milli: 1_000n }]);
    expect(rows[1]!.vendors).toEqual(["Balaji", "Shlok"]);
    expect([qtyText(12_500n), qtyText(8_000_000n), qtyText(700n)]).toEqual(["12.5", "8,000", "0.7"]);
  });

  it("by vendor and GST per month", () => {
    const bills = [bill({}), bill({ id: "b2", bill_date: "2026-10-20", paid: 118_000n }), bill({ id: "b3", bill_date: "2026-11-02", vendor_id: "v2", vendor: "Shree Hari", cgst: 0n, sgst: 0n, igst: 18_000n })];
    expect(byVendor(bills).map((v) => [v.label, v.bills, rupees(v.total), rupees(v.paid), rupees(v.due)])).toEqual([
      ["Balaji", 2, "2360.00", "1180.00", "1180.00"],
      ["Shree Hari", 1, "1180.00", "0.00", "1180.00"],
    ]);
    expect(gstByMonth(bills).map((m) => [m.label, m.bills, rupees(m.cgst), rupees(m.sgst), rupees(m.igst), rupees(m.tax)])).toEqual([
      ["Oct 2026", 2, "180.00", "180.00", "0.00", "360.00"],
      ["Nov 2026", 1, "0.00", "0.00", "180.00", "180.00"],
    ]);
  });

  it("age bands by the due date (no due date = the bill date)", () => {
    const t = "2026-11-10";
    expect([
      ageBand({ bill_date: "2026-11-10", due_date: "2026-11-25" }, t),
      ageBand({ bill_date: "2026-11-10", due_date: null }, t),
      ageBand({ bill_date: "2026-10-26", due_date: null }, t),
      ageBand({ bill_date: "2026-10-25", due_date: null }, t),
      ageBand({ bill_date: "2026-10-11", due_date: null }, t),
      ageBand({ bill_date: "2026-09-26", due_date: null }, t),
      ageBand({ bill_date: "2026-09-25", due_date: null }, t),
    ].map((x) => `${x.band}:${x.days}`)).toEqual(["not_due:-15", "not_due:0", "d1_15:15", "d16_30:16", "d16_30:30", "d31_45:45", "d45:46"]);
  });

  it("payables: open bills only, oldest first, less advances", () => {
    const p = payables(
      [bill({ id: "x", bill_date: "2026-10-20", due_date: "2026-10-20", paid: 18_000n }), bill({ id: "y", bill_date: "2026-09-01", due_date: "2026-09-01" }), bill({ id: "z", paid: 118_000n })],
      [{ vendor_id: "v1", unused: 5_000n }, { vendor_id: "v9", unused: 1n }],
      "2026-11-10",
    );
    expect(p.vendors.map((v) => [v.label, rupees(v.owed), rupees(v.advance), rupees(v.net), v.bills.map((b) => `${b.id}:${b.band}`)])).toEqual([
      ["Balaji", "2180.00", "50.00", "2130.00", ["y:d45", "x:d16_30"]],
    ]);
    expect(rupees(p.totals.d45)).toBe("1180.00");
    expect([rupees(p.owed), rupees(p.advance)]).toEqual(["2180.00", "50.00"]);
  });
});

describe("through the server", () => {
  const a = plant();
  const b = plant();
  const accounts = ocUser(a.tenantId, ["accounts"], "Anmol");
  const keeper = ocUser(a.tenantId, ["store_keeper"], "Bindu");
  const ids = { v: "", w: "" };

  beforeEach(() => {
    vi.spyOn(kit, "branding").mockResolvedValue({ name: "Bluemins", brand_color: "#2a3a9a", logo_url: null, gstin: "21ABCDE1234F1Z5" } as never);
  });
  afterEach(() => vi.restoreAllMocks());
  beforeAll(async () => {
    vi.spyOn(kit, "branding").mockResolvedValue({ name: "Bluemins", gstin: "21ABCDE1234F1Z5" } as never);
    ids.v = (await addVendor(a.owner, { name: "Balaji Sales", gstin: "21AFFPJ6952A1ZY", active: true } as never)).id;
    ids.w = (await addVendor(a.owner, { name: "Shree Hari Fashion", gstin: "24AOJPC6831Q1ZL", active: true } as never)).id;
    const L = (o: Record<string, unknown> = {}) => ({ item_name: "Preform 18.5 g", quantity: "25", unit: "kg", rate: "100", gst_rate: 18, ...o });
    await recordPurchaseBill(accounts, { vendor_id: ids.v, bill_date: "2026-09-01", adjustment: "0", lines: [L()] } as never); // 2950.00
    await recordPurchaseBill(accounts, { vendor_id: ids.v, bill_date: "2026-10-20", adjustment: "0", lines: [L({ quantity: "10" })] } as never); // 1180.00
    await recordPurchaseBill(accounts, { vendor_id: ids.w, bill_date: "2026-10-05", adjustment: "0", lines: [L({ item_name: "Label 1 L", quantity: "1000", unit: "nos", rate: "1" })], paid_now: { mode: "bank", paid_from: "SBI", reference: null } } as never); // 1180.00 paid
    await payVendor(accounts, { vendor_id: ids.v, payment_date: "2026-10-21", amount: "500", mode: "cash", paid_from: null, reference: null, note: null, bill_ids: [] });
    vi.restoreAllMocks();
  });

  it("payables: Balaji owed 3,630 (2,450 + 1,180), oldest first; Shree Hari paid, not listed", async () => {
    const p = await payablesReport(accounts);
    expect(p.vendors.map((v) => [v.label, rupees(v.owed), v.bills.map((x) => [x.number, rupees(x.due)])])).toEqual([["Balaji Sales", "3630.00", [["PB-0001", "2450.00"], ["PB-0002", "1180.00"]]]]);
    expect((await refused(() => payablesReport(a.desk))).status).toBe(403);
    expect((await refused(() => payablesReport(keeper))).status).toBe(403);
  });

  it("Reports → Purchases: by item, by vendor, GST per month (owner only)", async () => {
    const custom = { period: "custom", from: "2026-09-01", to: "2026-10-31" };
    const item = await purchaseReport(a.owner, "item", custom);
    expect(item.kind === "item" && item.items.map((i) => [i.label, i.bills, rupees(i.amount), i.avg_rate === null ? null : rupees(i.avg_rate)])).toEqual([
      ["Preform 18.5 g", 2, "3500.00", "100.00"],
      ["Label 1 L", 1, "1000.00", "1.00"],
    ]);
    expect(rupees(item.totals.total)).toBe("5310.00");
    const vendor = await purchaseReport(a.owner, "vendor", custom);
    expect(vendor.kind === "vendor" && vendor.vendors.map((v) => [v.label, rupees(v.due)])).toEqual([["Balaji Sales", "3630.00"], ["Shree Hari Fashion", "0.00"]]);
    const gst = await purchaseReport(a.owner, "gst", custom);
    expect(gst.kind === "gst" && gst.months.map((m) => [m.label, rupees(m.cgst), rupees(m.igst)])).toEqual([["Sep 2026", "225.00", "0.00"], ["Oct 2026", "90.00", "180.00"]]);
    for (const u of [accounts, keeper, a.desk]) expect((await refused(() => purchaseReport(u, "item", custom))).status, u.name).toBe(403);
  });

  it("purchases received: date, vendor, item, quantity, unit, bill no., and no money field at all", async () => {
    const r = await purchasesReceived(keeper, { from: "2026-09-01", to: "2026-10-31" });
    expect(r.lines.map((l) => [l.date, l.vendor, l.item, l.quantity, l.unit, l.number])).toEqual([
      ["2026-10-20", "Balaji Sales", "Preform 18.5 g", "10.000", "kg", "PB-0002"],
      ["2026-10-05", "Shree Hari Fashion", "Label 1 L", "1000.000", "nos", "PB-0003"],
      ["2026-09-01", "Balaji Sales", "Preform 18.5 g", "25.000", "kg", "PB-0001"],
    ]);
    const keys = new Set(r.lines.flatMap((l) => Object.keys(l)));
    for (const money of ["rate", "amount", "line_total", "tax", "tax_amount", "total", "paid"]) expect(keys.has(money), money).toBe(false);
    expect((await purchasesReceived(keeper, { from: "2026-09-01", to: "2026-10-31", q: "label" })).lines).toHaveLength(1);
    expect((await purchasesReceived(accounts)).to).toMatch(/^\d{4}-\d{2}-\d{2}$/); // default: the last 30 days
  });

  it("a Store keeper sees nothing else in Sales: no orders, bills, purchase amounts, customers", async () => {
    expect(keeper.who).toBe("store");
    expect(roleLabel(keeper)).toBe("Store keeper");
    for (const action of ["read", "see_amounts", "view_customers", "ledger_view", "purchases_view", "purchase_enter", "calls_view", "reports"] as const) expect(can(keeper, action), action).toBe(false);
    expect((await refused(() => purchaseBillsList(keeper))).message).toBe("Store keepers see purchases received only.");
    expect(() => requireAccess(keeper, "enter")).toThrow(/purchases received only/);
    // with another Sales role, they keep the page
    const both = ocUser(a.tenantId, ["store_keeper", "plant_staff"], "Gaja");
    expect([both.who, can(both, "purchases_received"), can(both, "see_amounts")]).toEqual(["viewer", true, false]);
    const desk = ocUser(a.tenantId, ["store_keeper", "order_desk"], "Ramu");
    expect([desk.who, can(desk, "purchases_received")]).toEqual(["desk", true]);
  });

  it("the Store keeper's tile: counts only", async () => {
    const t = await purchasesTile(a.tenantId, new Date("2026-10-22T06:00:00Z"));
    expect(t.badges).toEqual([{ text: "1 purchase this week", tone: "info" }, { text: "Last: Balaji Sales, 20 Oct", tone: "info" }]);
    expect(JSON.stringify(t)).not.toMatch(/₹/);
  });

  it("another plant sees none of it", async () => {
    const bk = ocUser(b.tenantId, ["store_keeper"], "X");
    expect((await purchasesReceived(bk, { from: "2026-01-01", to: "2026-12-31" })).lines).toEqual([]);
    expect((await payablesReport(b.owner)).vendors).toEqual([]);
    expect((await purchasesTile(b.tenantId)).badges).toEqual([{ text: "No purchases this week", tone: "ok" }]);
  });
});

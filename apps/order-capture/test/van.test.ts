// Cash book step C3 (docs/CASHBOOK_PHASE_PLAN.md section 3.2): the van report. The rules with the RB payments group's real
// reports (Mini 21 Oct: 1,150 deposit; Mini 7 Nov: 5,200), saving (cash entry, lines, rates pre-filled), the owner's rule
// that customer lines wait in To post ("not paid" → a bill only when posted), cancelling, who may do what, another plant.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantSku } from "@plantops/types";
import { paise, rupees } from "@/lib/cash";
import { byBrand, vanDifferenceText, vanSums, vanWhatsapp } from "@/lib/van";
import { addListItem, cancelEntry, cashLists, daySheet, startCashBook } from "@/server/cash";
import { collectionsList, postLine, waitingToPost } from "@/server/collections";
import { kit } from "@/server/kit";
import { account, cancelBill } from "@/server/ledger";
import { addVanReport, billCredit, creditList, turnDownCredit, TurnDownCreditInput, vanForm, vanReport, vanReportsList, vanShortNotification, type VanInput } from "@/server/van";
import { asApp, auditRows, dbError, ocUser, plant, refused } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const S = (product: string, brand: string, quantity: number, rate: string) => ({ product, brand, quantity, rate });
const none = { not_paid: [], collected_cash: [], collected_online: [], online: "", meal: "", tiffin: "", diesel: "", toll: "" };

describe("the van rules (src/lib/van.ts), with the group's real reports", () => {
  it("Mini 21 Oct: 12,450 − not paid 3,300 + collected 500 − online 8,500 = 1,150 deposit", () => {
    const s = vanSums({ ...none, sales: [S("Bluemins 1L", "Bluemins", 83, "150")], not_paid: ["700", "800", "1800"], collected_cash: ["500"], online: "8500" });
    expect(rupees(s.sales)).toBe("12450.00");
    expect(rupees(s.expected)).toBe("1150.00");
  });

  it("Mini 7 Nov: Bluemins 10,730 + DM Water 1,470 − not paid 5,500 − online 1,500 = 5,200; by brand", () => {
    const sales = [S("Bluemins 1L", "Bluemins", 55, "150"), S("Bluemins 500ml", "Bluemins", 16, "155"), S("DM Water 1L", "DM Water", 14, "105")];
    const s = vanSums({ ...none, sales, not_paid: ["5500"], online: "1500" });
    expect(byBrand(sales).map((b) => [b.brand, rupees(b.amount)])).toEqual([["Bluemins", "10730.00"], ["DM Water", "1470.00"]]);
    expect(rupees(s.sales)).toBe("12200.00");
    expect(rupees(s.expected)).toBe("5200.00");
    expect([vanDifferenceText(paise("1150"), paise("1150")), vanDifferenceText(paise("1100"), paise("1150")), vanDifferenceText(paise("1200"), paise("1150"))]).toEqual(["Matches", "Short ₹50", "Extra ₹50"]);
    // meal, tiffin, diesel and toll come out of the van's money before it is handed in; collected online never in the cash
    expect(rupees(vanSums({ ...none, sales: [S("x", "B", 10, "100")], meal: "80", tiffin: "20", diesel: "200", toll: "50", collected_online: ["300"] }).expected)).toBe("650.00");
  });

  it("the WhatsApp group's layout", () => {
    const text = vanWhatsapp({
      date: "2026-10-21",
      vehicle: "Mini",
      person: "Jay Lal",
      sales: [S("Bluemins 1L", "Bluemins", 83, "150")],
      not_paid: [{ name: "Google sahu", amount: "700" }, { name: "Jitu dhaba", amount: "800" }, { name: "Dipak dhaba", amount: "1800" }],
      collected: [{ name: "Jitu dhaba", amount: "500", mode: "cash" }],
      online: "8500",
      meal: "0",
      tiffin: "0",
      diesel: "0",
      toll: "0",
      handed_in: "1150",
    });
    expect(text.split("\n")).toEqual([
      "21/10/2026",
      "Mini = 12450 rs (Jay Lal)",
      "Bluemins = 12450 rs",
      "Online = 8500 rs",
      "Google sahu = 700 rs not paid",
      "Jitu dhaba = 800 rs not paid",
      "Dipak dhaba = 1800 rs not paid",
      "Jitu dhaba 500 rs paid",
      "Meal = 0 rs",
      "Tiffin = 0 rs",
      "Total deposit = 1150 rs",
    ]);
  });
});

describe("van reports, in the database", () => {
  const TODAY = "2026-11-09";
  const SKUS = [
    { id: randomUUID(), name: "Bluemins", sku_code: "B1L", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" },
    { id: randomUUID(), name: "Bluemins", sku_code: "B500", volume_ml: 500, units_per_pack: 24, pack_type: "case", status: "active" },
    { id: randomUUID(), name: "DM Water", sku_code: "DM1L", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" },
  ] as TenantSku[];
  const [b1l, b500, dm] = SKUS.map((s) => s.id) as [string, string, string];

  const setup = async () => {
    const p = plant();
    const accounts = ocUser(p.tenantId, ["accounts"], "Anmol");
    vi.spyOn(kit, "products").mockResolvedValue(SKUS);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    await startCashBook(p.owner, { date: "2026-11-07", counted: "14435" }, TODAY);
    await addListItem(p.owner, { list: "vehicle", name: "Mini" });
    const mini = (await cashLists(p.owner)).vehicles[0]!.id;
    const cust = async (name: string, phone: string) =>
      ((await asApp(p.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${p.tenantId}', '${name}', '${phone}', '${phone}', 'Bijepur', gen_random_uuid(), 'S') returning id`)).rows[0] as { id: string }).id;
    const jitu = await cust("Jitu dhaba", "9000000001");
    const dipak = await cust("Dipak dhaba", "9000000002");
    // 21 Oct, as the group posted it (cash on 9 Nov, for the 7th)
    const report = (over: Partial<VanInput> = {}): VanInput => ({
      cash_date: TODAY,
      work_date: "2026-11-07",
      vehicle_id: mini,
      person_name: "Jay Lal",
      lines: [{ sku_id: b1l, quantity: 83, rate: "150" }],
      not_paid: [{ customer_id: jitu, amount: "800" }, { customer_id: dipak, amount: "1800" }, { customer_id: dipak, amount: "700", note: "Google sahu" }],
      collected: [{ customer_id: jitu, amount: "500", mode: "cash" }],
      online: "8500",
      meal: "0",
      tiffin: "0",
      diesel: "0",
      toll: "0",
      handed_in: "1150",
      ...over,
    });
    return { ...p, accounts, mini, jitu, dipak, report };
  };

  it("the form: products by brand with Rates' rate, then the last van report's", async () => {
    const p = await setup();
    await asApp(p.tenantId, `insert into order_capture.product_rates (tenant_id, sku_id, unit, default_rate, updated_by) values ('${p.tenantId}', '${b1l}', 'box', 160, gen_random_uuid())`);
    let f = await vanForm(p.accounts);
    expect(f.items.map((i) => [i.brand, i.rate])).toEqual([["Bluemins", "160.00"], ["Bluemins", ""], ["DM Water", ""]]);
    expect(f.vehicles.map((v) => v.name)).toEqual(["Mini"]);
    await addVanReport(p.accounts, p.report(), TODAY);
    f = await vanForm(p.accounts);
    expect(f.items[0]!.rate).toBe("150.00");
    expect((await refused(() => vanForm(p.desk))).status).toBe(403);
  });

  it("saving: one 'van' cash entry for the cash handed in; nothing on customers' accounts until posted", async () => {
    const p = await setup();
    for (const u of [p.desk, p.staff, p.keeper, p.support]) expect((await refused(() => addVanReport(u, p.report(), TODAY))).status).toBe(403);
    const v = await addVanReport(p.accounts, p.report(), TODAY);
    expect(v).toMatchObject({ ref: "C-0001", vehicle: "Mini", person: "Jay Lal", sales: "12450.00", expected: "1150.00", handed_in: "1150.00", difference: "0.00", not_paid: 3, collected: 1 });
    const sheet = await daySheet(p.accounts, TODAY, TODAY);
    expect(sheet.started && [sheet.in, sheet.expected, sheet.entries[0]!.kind, sheet.entries[0]!.work_date]).toEqual(["1150.00", "15585.00", "van", "2026-11-07"]);
    // the owner's rule: no bill, no payment yet
    expect((await account(p.owner, { kind: "customer", id: p.jitu })).totals.due).toBe("0.00");
    expect((await account(p.owner, { kind: "customer", id: p.jitu })).totals.advance).toBe("0.00");
    expect((await creditList(p.accounts)).waiting).toEqual({ count: 3, amount: "3300.00" });
    expect((await collectionsList(p.accounts)).waiting).toEqual({ count: 1, amount: "500.00" });
    expect(await waitingToPost(p.accounts)).toBe(4);
    const r = await vanReport(p.support, v.id);
    expect([r.vehicle, r.lines[0]!.amount, r.credits.length, r.collected[0]!.entry]).toEqual(["Mini", "12450.00", 3, "C-0001"]);
    expect((await vanReportsList(p.accounts))[0]).toMatchObject({ vehicle: "Mini", ref: "C-0001", handed_in: "1150.00" });
    expect(vanShortNotification(p.accounts, v)).toBeNull();
    expect((await auditRows(p.tenantId)).map((a) => a.action)).toContain("cash.van");
  });

  it("short or extra is saved as typed; ₹100 or more off alerts the owners", async () => {
    const p = await setup();
    const v = await addVanReport(p.accounts, p.report({ handed_in: "1000", note: "tea money" }), TODAY);
    expect([v.difference, v.expected]).toEqual(["-150.00", "1150.00"]);
    const n = vanShortNotification(p.accounts, v)!;
    expect([n.kind, n.level, n.title]).toEqual(["order_capture.cash_short", "push", "Van Mini short ₹150 (07/11)"]);
  });

  it("refusals: a closed day, no cash handed in, a product twice, an unknown product or customer, loaded / returned only", async () => {
    const p = await setup();
    expect((await refused(() => addVanReport(p.accounts, p.report({ cash_date: "2026-11-07" }), TODAY))).message).toMatch(/already closed/);
    expect((await refused(() => addVanReport(p.accounts, p.report({ handed_in: "0" }), TODAY))).message).toMatch(/more than ₹0/);
    expect((await refused(() => addVanReport(p.accounts, p.report({ lines: [{ sku_id: b1l, quantity: 1, rate: "1" }, { sku_id: b1l, quantity: 2, rate: "1" }] }), TODAY))).message).toMatch(/twice/);
    expect((await refused(() => addVanReport(p.accounts, p.report({ lines: [{ sku_id: randomUUID(), quantity: 1, rate: "1" }] }), TODAY))).message).toMatch(/active products/);
    expect((await refused(() => addVanReport(p.accounts, p.report({ not_paid: [{ customer_id: randomUUID(), amount: "5" }] }), TODAY))).message).toMatch(/isn't in Sales/);
    expect((await refused(() => addVanReport(p.accounts, p.report({ lines: [], collected: [] }), TODAY))).message).toMatch(/boxes sold/);
    // a product only counted out and back is kept (the placeholder), with no sale
    const v = await addVanReport(p.accounts, p.report({ lines: [{ sku_id: b1l, quantity: 83, rate: "150", loaded: 90, returned: 7 }, { sku_id: dm, quantity: 0, rate: "0", loaded: 10, returned: 10 }, { sku_id: b500, quantity: 0, rate: "140" }] }), TODAY);
    const r = await vanReport(p.owner, v.id);
    expect(r.lines.map((l) => [l.product, l.quantity, l.loaded, l.returned])).toEqual([["Bluemins (1 L × 12)", 83, 90, 7], ["DM Water (1 L × 12)", 0, 10, 10]]);
  });

  it("posting 'not paid': a B-number bill on the account (vehicle, salesperson); another customer; turn down; cancel", async () => {
    const p = await setup();
    const v = await addVanReport(p.accounts, p.report(), TODAY);
    const [jitu, dipak1, dipak2] = (await creditList(p.owner)).lines;
    expect([jitu!.customer.name, dipak1!.amount, dipak2!.note]).toEqual(["Jitu dhaba", "1800.00", "Google sahu"]);
    expect((await refused(() => billCredit(p.desk, jitu!.id, {}))).status).toBe(403);
    expect((await refused(() => billCredit(p.support, jitu!.id, {}))).status).toBe(403);

    const b = await billCredit(p.accounts, jitu!.id, {});
    expect([b.number, b.customer, b.amount]).toEqual(["B-0001", "Jitu dhaba", "800.00"]);
    const bill = (await asApp(p.tenantId, `select source, bill_date::text, vehicle, salesperson, total::text, (select item_name from order_capture.bill_lines l where l.bill_id = b.id) as item from order_capture.bills b where number = 'B-0001'`)).rows[0];
    expect(bill).toEqual({ source: "plantops", bill_date: "2026-11-07", vehicle: "Mini", salesperson: "Jay Lal", total: "800.00", item: "Van sale (Mini, 7 Nov)" });
    expect((await account(p.owner, { kind: "customer", id: p.jitu })).totals.due).toBe("800.00");
    expect((await refused(() => billCredit(p.accounts, jitu!.id, {}))).status).toBe(409);

    // Google sahu's credit was typed under Dipak: bill the right customer
    const google = (await asApp(p.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${p.tenantId}', 'Google sahu', '9000000003', '9000000003', 'Bijepur', gen_random_uuid(), 'S') returning id`)).rows[0] as { id: string };
    expect((await billCredit(p.owner, dipak2!.id, { customer_id: google.id })).customer).toBe("Google sahu");
    expect(TurnDownCreditInput.safeParse({ reason: "x" }).success).toBe(false);
    await turnDownCredit(p.accounts, dipak1!.id, { reason: "paid the same evening" });
    expect((await creditList(p.owner)).waiting.count).toBe(0);

    // the collected ₹500 goes onto Jitu's new bill when posted
    const line = (await collectionsList(p.owner)).lines[0]!;
    expect((await postLine(p.accounts, line.id, { bill_ids: [] })).bills).toEqual(["B-0001"]);
    expect((await account(p.owner, { kind: "customer", id: p.jitu })).totals.due).toBe("300.00");

    // the report can't be cancelled while its lines are on accounts
    const entry = (await vanReport(p.owner, v.id)).entry_id;
    expect((await refused(() => cancelEntry(p.owner, entry, { reason: "wrong van" }))).message).toMatch(/B-0001|B-0002|P-0001/);
    expect((await refused(() => cancelEntry(p.accounts, entry, { reason: "wrong van" }))).status).toBe(403);
    // a cancelled bill: that line waits again
    await cancelBill(p.owner, b.id, { reason: "wrong amount" });
    expect((await creditList(p.owner)).waiting.count).toBe(1);
  });

  it("another plant sees none of it", async () => {
    const a = await setup();
    const v = await addVanReport(a.accounts, a.report(), TODAY);
    const b = plant();
    expect(await vanReportsList(b.owner)).toEqual([]);
    expect((await creditList(b.owner)).lines).toEqual([]);
    expect((await refused(() => vanReport(b.owner, v.id))).status).toBe(404);
    const credit = (await creditList(a.owner)).lines[0]!;
    expect((await refused(() => billCredit(b.owner, credit.id, {}))).status).toBe(404);
    expect((await asApp(b.tenantId, `select * from order_capture.van_reports`)).rows).toEqual([]);
  });

  it("the database keeps the sums honest", async () => {
    const p = await setup();
    const v = await addVanReport(p.accounts, p.report(), TODAY);
    const r = await vanReport(p.owner, v.id);
    const bad = (sql: string) => dbError(asApp(p.tenantId, sql));
    expect(await bad(`insert into order_capture.van_report_lines (tenant_id, report_id, line_no, sku_id, product_name, unit, quantity, rate, amount) values ('${p.tenantId}', '${v.id}', 9, gen_random_uuid(), 'x', 'box', 2, 10, 25)`)).toMatch(/check/);
    expect(await bad(`insert into order_capture.van_reports (tenant_id, cash_entry_id, vehicle_id, work_date, person_name, sales, expected, handed_in, difference, created_by, created_by_name) values ('${p.tenantId}', '${r.entry_id}', '${p.mini}', '2026-11-09', 'x', 100, 90, 90, 0, gen_random_uuid(), 'x')`)).toMatch(/check|duplicate/);
  });
});

// Cash book step C5 (docs/CASHBOOK_PHASE_PLAN.md section 9; owner 2026-11-12): the monthly 20 L "Remaining" import.
// Per 20 L customer: report higher than PlantOps' 20 L due → a month bill for the difference (J20-<ref>-<month>, dated the
// month's last day, due the same day); the same → nothing; lower or negative → flagged; also buys boxes / shares the
// customer → left for the owner, who may type the amount. A month comes in once until the owner undoes it (refused while
// a month bill has a payment). Owner only; another plant sees none of it.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jarMonthPlan, monthEnd, monthNumber, readJarSheet, type KnownJar } from "@/lib/jar-import";
import { jarImport, jarList, jarPreview, type JarImportInput } from "@/server/collections";
import { createCustomer } from "@/server/customers";
import { monthHistory, monthImport, monthLines, monthPreview, monthUndo, type MonthInput } from "@/server/jar-month";
import { account, receivePayment } from "@/server/ledger";
import { asOwner, auditRows, ocUser, plant, refused } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const HEAD = ["Ref. No.", "Customer Name", "Payment Preference", "Status", "Mobile No.", "Group", "Total Due  \n Till ( Nov )"];
const row = (ref: unknown, name: string, mobile: unknown, due: number) => [ref, name, "Daily", "-", mobile, "5   Bijepur Area", due];
const sheet = (rows: unknown[][], total?: number) => [HEAD, ...rows, ...(total === undefined ? [] : [["", "", "", "", "", "Total", total]])];

describe("the month rules (src/lib/jar-import.ts)", () => {
  const K = (due: number, mixed: KnownJar["mixed"] = null): KnownJar => ({ jar_customer_id: randomUUID(), customer_id: randomUUID(), customer_name: "X", due: BigInt(due * 100), mixed });
  it("higher → bill the difference; same → nothing; lower / negative → flagged; mixed → left (or the owner's amount); new and missing refs listed", () => {
    const s = readJarSheet(sheet([row(1, "Up", "", 900), row(2, "Same", "", 280), row(3, "Down", "", 100), row(4, "Ahead", "", -40), row(5, "Boxes", "", 150), row(6, "New", "", 70)], 1460), { negative: true });
    const known = new Map([["1", K(300)], ["2", K(280)], ["3", K(250)], ["4", K(0)], ["5", K(80, "boxes")], ["9", K(10)]]);
    const names = new Map([["1", "Up"], ["2", "Same"], ["3", "Down"], ["4", "Ahead"], ["5", "Boxes"], ["9", "Gone"]]);
    const p = jarMonthPlan(s, known, names);
    expect(p.rows.map((r) => [r.ref, r.action, r.reason, r.bill])).toEqual([
      ["1", "billed", null, "600.00"],
      ["2", "matches", null, null],
      ["3", "flagged", "lower", null],
      ["4", "flagged", "negative", null],
      ["5", "left", "mixed", null],
    ]);
    expect(p.new_refs).toEqual([{ ref: "6", name: "New", due: "70.00" }]);
    expect(p.missing).toEqual([{ ref: "9", name: "Gone" }]);
    expect([p.totals, p.total_mismatch]).toEqual([{ file: "1460.00", rows: "1460.00", billed: "600.00" }, false]);
    const typed = jarMonthPlan(s, known, names, { "5": { action: "bill", amount: "70" }, "1": { action: "leave" } });
    expect(typed.rows.filter((r) => ["1", "5"].includes(r.ref)).map((r) => [r.ref, r.action, r.reason, r.bill])).toEqual([["1", "left", null, null], ["5", "billed", "typed", "70.00"]]);
    expect(jarMonthPlan(s, known, names, { "5": { action: "bill", amount: "seventy" } }).counts.errors).toBe(1);
    expect(() => readJarSheet(sheet([row(1, "A", "", -5)]))).toThrow(/negative/); // the first import still refuses it
  });
  it("numbers and dates", () => {
    expect([monthNumber("3287", "2026-11"), monthNumber("#000123811/ Nov-2024", "2026-11"), monthNumber("3287", "2026-11", 2)]).toEqual(["J20-3287-2026-11", "J20-000123811-2026-11", "J20-3287-2026-11-2"]);
    expect([monthEnd("2026-11"), monthEnd("2026-02"), monthEnd("2028-02")]).toEqual(["2026-11-30", "2026-02-28", "2028-02-29"]);
  });
});

describe("the month update, in the database", () => {
  const TODAY = "2026-11-12";
  // the first import: Ekart 500, Padmalochan 280, Seth Fancy 80 (added to "Fancy Store", who also buys boxes)
  async function setup() {
    const p = plant();
    const fancy = (await createCustomer(p.owner, { name: "Fancy Store", phone: "8114733613", place: "Bijepur" })).customer;
    await asOwner(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, sub_total, total, created_by, created_by_name)
      values ($1, 'plantops', 'B-0001', 1, '2026-11-01', $2, 'Fancy Store', 850, 850, gen_random_uuid(), 'Sujata')`, [p.tenantId, fancy.id]);
    const s = readJarSheet(sheet([row(3287, "Ekart Logistics Bijepur", 9658363636, 500), row("#000123811/ Nov-2024", "Padmalochan Mirdha Bijepur", 9938819283, 280), row(1521, "Seth Fancy Bijepur", "8114733613", 80)], 860));
    const first: JarImportInput = { file_name: "oct.xlsx", rows: s.rows, file_total: s.file_total, choices: {}, place: "Bijepur" };
    const pv = await jarPreview(p.owner, first);
    await jarImport(p.owner, { ...first, expect: { create: pv.counts.create, add: pv.counts.add, imported: pv.totals.imported } }, "2026-10-05");
    const id = async (phone: string) => ((await asOwner(`select id from order_capture.customers where tenant_id = $1 and phone = $2`, [p.tenantId, phone])).rows[0] as { id: string }).id;
    const ekart = await id("9658363636");
    const input = (rows: unknown[][], month = "2026-10", over: Partial<MonthInput> = {}): MonthInput => {
      const total = rows.reduce((t, r) => t + (r[6] as number), 0);
      const m = readJarSheet(sheet(rows, total), { negative: true });
      return { file_name: "nov.xlsx", month, rows: m.rows, file_total: m.file_total, choices: {}, ...over };
    };
    const bring = async (i: MonthInput, today = TODAY) => {
      const pv = await monthPreview(p.owner, i, today);
      return monthImport(p.owner, { ...i, expect: { billed: pv.counts.billed, total: pv.totals.billed } }, today);
    };
    const due = async (cust: string) => (await account(p.owner, { kind: "customer", id: cust })).totals.due;
    return { p, fancy, ekart, input, bring, due };
  }
  const NOV = (ekart: number, padma: number, fancy: number, extra: unknown[][] = []) => [
    row(3287, "Ekart Logistics Bijepur", 9658363636, ekart),
    row("#000123811/ Nov-2024", "Padmalochan Mirdha Bijepur", 9938819283, padma),
    row(1521, "Seth Fancy Bijepur", "8114733613", fancy),
    ...extra,
  ];

  it("bills what the report shows more (after a payment in PlantOps), matches the rest, leaves Fancy (also buys boxes) to the owner", async () => {
    const s = await setup();
    await receivePayment(s.p.owner, { customer_id: s.ekart, amount: "200", payment_date: "2026-10-20", mode: "cash", bill_ids: [] });
    expect(await s.due(s.ekart)).toBe("300.00");
    const pv = await monthPreview(s.p.owner, s.input(NOV(900, 280, 150, [row(4000, "New Shop", 9437000001, 70)])), TODAY);
    expect(pv.rows.map((r) => [r.ref, r.action, r.plantops, r.bill, r.mixed])).toEqual([
      ["3287", "billed", "300.00", "600.00", null],
      ["#000123811/ Nov-2024", "matches", "280.00", null, null],
      ["1521", "left", "80.00", null, "boxes"],
    ]);
    expect([pv.counts.new_refs, pv.bill_date, pv.already]).toEqual([1, "2026-10-31", null]);
    const r = await s.bring(s.input(NOV(900, 280, 150, [row(4000, "New Shop", 9437000001, 70)])));
    expect(r).toMatchObject({ month: "2026-10", billed: 1, billed_total: "600.00", matches: 1, left: 1, new_refs: 1 });
    const bill = (await asOwner(`select number, source, bill_date::text, due_date::text, total::text, ref_no, order_id from order_capture.bills where tenant_id = $1 and source = 'jar_month'`, [s.p.tenantId])).rows;
    expect(bill).toEqual([{ number: "J20-3287-2026-10", source: "jar_month", bill_date: "2026-10-31", due_date: "2026-10-31", total: "600.00", ref_no: null, order_id: null }]);
    expect(await s.due(s.ekart)).toBe("900.00");
    expect((await jarList(s.p.owner)).customers.find((c) => c.customer_id === s.ekart)!.due).toBe("900.00");
    const hist = await monthHistory(s.p.owner);
    expect(hist.map((h) => [h.month, h.live, h.undone])).toEqual([["2026-10", 1, false]]);
    const lines = await monthLines(s.p.owner, hist[0]!.id);
    expect(lines.lines.map((l) => [l.ref, l.action, l.reason])).toEqual([["1521", "left", "mixed"], ["3287", "billed", null], ["#000123811/ Nov-2024", "matches", null]]);
    expect((await auditRows(s.p.tenantId)).filter((a) => a.action === "jar.month").length).toBe(1);
    // next month: November's bills come on top of October's, which counts as PlantOps' 20 L due now
    const nov = await monthPreview(s.p.owner, s.input(NOV(1250, 280, 150), "2026-11"), "2026-12-02");
    expect(nov.rows[0]).toMatchObject({ ref: "3287", plantops: "900.00", bill: "350.00" });
  });

  it("the owner types Fancy's amount; lower and negative are flagged and nothing is saved for them", async () => {
    const s = await setup();
    const i = s.input([row(3287, "Ekart Logistics Bijepur", 9658363636, 400), row("#000123811/ Nov-2024", "Padmalochan Mirdha Bijepur", 9938819283, -20), row(1521, "Seth Fancy Bijepur", "8114733613", 150)], "2026-10", { choices: { "1521": { action: "bill", amount: "70" } } });
    const r = await s.bring(i);
    expect(r).toMatchObject({ billed: 1, billed_total: "70.00", flagged: 2 });
    expect(await s.due(s.fancy.id)).toBe("1000.00"); // 850 box bill + 80 opening + 70 typed
    expect(await s.due(s.ekart)).toBe("500.00");
  });

  it("once per month: again → refused; undo cancels its bills (not while one has a payment); then it comes in again", async () => {
    const s = await setup();
    await s.bring(s.input(NOV(900, 280, 80)));
    const again = await refused(() => s.bring(s.input(NOV(900, 280, 80))));
    expect(again.status).toBe(409);
    expect(again.message).toMatch(/already imported/);
    // a payment on the month bill blocks the undo
    const bill = ((await asOwner(`select id from order_capture.bills where tenant_id = $1 and source = 'jar_month'`, [s.p.tenantId])).rows[0] as { id: string }).id;
    await receivePayment(s.p.owner, { customer_id: s.ekart, amount: "100", payment_date: "2026-11-11", mode: "cash", bill_ids: [bill] });
    expect((await refused(() => monthUndo(s.p.owner, "2026-10", { reason: "wrong file" }))).message).toMatch(/J20-3287-2026-10/);
    const pay = ((await asOwner(`select id from order_capture.payments where tenant_id = $1 order by created_at desc limit 1`, [s.p.tenantId])).rows[0] as { id: string }).id;
    const { cancelPayment } = await import("@/server/ledger");
    await cancelPayment(s.p.owner, pay, { reason: "test" });
    expect(await monthUndo(s.p.owner, "2026-10", { reason: "wrong file" })).toEqual({ month: "2026-10", bills: 1, total: "400.00" });
    expect((await monthHistory(s.p.owner))[0]!.undone).toBe(true);
    await s.bring(s.input(NOV(700, 280, 80)));
    const numbers = (await asOwner(`select number, cancelled_at is not null as c from order_capture.bills where tenant_id = $1 and source = 'jar_month' order by created_at`, [s.p.tenantId])).rows;
    expect(numbers).toEqual([{ number: "J20-3287-2026-10", c: true }, { number: "J20-3287-2026-10-2", c: false }]);
  });

  it("owner only; no future month; the preview must still be true; another plant sees none of it", async () => {
    const s = await setup();
    const accounts = ocUser(s.p.tenantId, ["accounts"], "Anmol");
    for (const u of [accounts, s.p.desk, s.p.support]) expect((await refused(() => monthPreview(u, s.input(NOV(900, 280, 80)), TODAY))).status).toBe(403);
    expect((await refused(() => monthPreview(s.p.owner, s.input(NOV(900, 280, 80), "2026-12"), TODAY))).message).toMatch(/hasn't come yet/);
    expect((await refused(() => monthImport(s.p.owner, { ...s.input(NOV(900, 280, 80)), expect: { billed: 1, total: "1.00" } }, TODAY))).status).toBe(409);
    expect((await refused(() => monthImport(s.p.owner, s.input(NOV(900, 280, 80)), TODAY))).status).toBe(409); // no preview
    const other = plant();
    expect((await refused(() => monthPreview(other.owner, s.input(NOV(900, 280, 80)), TODAY))).message).toMatch(/No 20 L customers yet/);
    expect(await monthHistory(other.owner)).toEqual([]);
  });
});

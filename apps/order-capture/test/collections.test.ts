// Cash book step C2 (docs/CASHBOOK_PHASE_PLAN.md section 6a): the 20 L import (rules, the owner's real file, saving,
// importing again), opening balances that count as money owed but never as sales, and collections: the cash goes into
// the cash book at once, but a customer's bills change only when a line is posted (owner, 2026-11-11). Who may do what;
// another plant sees none of it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commonPlace, jarPlan, openingNumber, readJarSheet, type JarSheet } from "@/lib/jar-import";
import { isOpeningBill } from "@/lib/ledger";
import { cancelEntry, daySheet, startCashBook } from "@/server/cash";
import { addCollection, collectionSearch, collectionsList, jarImport, jarList, jarPreview, postLine, TurnDownInput, turnDownLine, type JarImportInput } from "@/server/collections";
import { kit } from "@/server/kit";
import { account, cancelPayment } from "@/server/ledger";
import { readParams, salesReport } from "@/server/reports";
import { asApp, auditRows, dbError, ocUser, plant, refused } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const HEAD = ["Ref. No.", "Customer Name", "Payment Preference", "Status", "Mobile No.", "Group", "Past Due \n Till ( Oct )", "Total Due  \n Till ( Nov )", "Security Deposit"];
const row = (ref: unknown, name: string, mobile: unknown, group: string, due: number) => [ref, name, "Daily", "-", mobile, group, due, due, 0];
const SAMPLE: unknown[][] = [
  HEAD,
  row(3324, "Police Party", "", "0   Event", 360),
  row(3287, "Ekart Logistics Bijepur", 9658363636, "1   Institutions", 500),
  row("#000123811/ Nov-2024", "Padmalochan Mirdha Bijepur", 9938819283, "5   Bijepur Area", 280),
  row(3225, "Goru Sahu Pahandi", 1730445774, "52   Outskirts Area", 50),
  row(1521, "Seth Fancy Bijepur", "8114733613", "Default Group", 80),
  ["", "", "", "", "", "Total", 1270, 1270, 0],
];

describe("reading the 20 L pending report (src/lib/jar-import.ts)", () => {
  it("rows, groups, the Total row; old invoice refs get their own OB20 number", () => {
    const s = readJarSheet(SAMPLE);
    expect(s.rows.length).toBe(5);
    expect(s.file_total).toBe("1270.00");
    expect(s.rows[1]).toEqual({ ref: "3287", name: "Ekart Logistics Bijepur", mobile_typed: "9658363636", group: "Institutions", pref: "Daily", due: "500.00" });
    expect(s.rows[4]!.group).toBe("Default Group");
    expect([openingNumber("3324"), openingNumber("#000123811/ Nov-2024")]).toEqual(["OB20-3324", "OB20-000123811"]);
    expect(commonPlace(s.rows)).toBe("Bijepur");
    expect(() => readJarSheet([["Name", "Phone"]])).toThrow(/isn't the 20 L pending report/);
    expect(() => readJarSheet([HEAD, row(1, "A", "", "", 10), row(1, "B", "", "", 10)])).toThrow(/twice/);
    expect(() => readJarSheet([HEAD, row(1, "A", "", "", -5)])).toThrow(/negative/);
  });

  it("the plan: new / already a customer (added by default) / no real mobile (left out by default) / typed mobile / imported before", () => {
    const s = readJarSheet(SAMPLE);
    const shop = { id: randomUUID(), name: "Fancy Store", phone: "8114733613" };
    const of = (p: string) => (p === shop.phone ? shop : null);
    const p = jarPlan(s, of, new Set());
    const by = Object.fromEntries(p.rows.map((r) => [r.ref, [r.kind, r.result]]));
    expect(by).toEqual({
      "3324": ["no_mobile", "skip"],
      "3287": ["new", "create"],
      "#000123811/ Nov-2024": ["new", "create"],
      "3225": ["no_mobile", "skip"], // 1730445774 is the other app's placeholder, not a mobile
      "1521": ["existing", "add"],
    });
    expect(p.totals).toEqual({ file: "1270.00", rows: "1270.00", imported: "860.00", left_out: "410.00", already: "0.00" });
    expect(p.counts).toMatchObject({ create: 2, add: 1, skip: 2, opening_bills: 3, errors: 0 });
    expect(p.total_mismatch).toBe(false);

    const c = jarPlan(s, of, new Set(["3287"]), { "3324": { action: "mobile", mobile: "+91 70080 11223" }, "1521": { action: "mobile", mobile: "9000" }, "3225": { action: "mobile", mobile: "81147 33613" } });
    const r = Object.fromEntries(c.rows.map((x) => [x.ref, x]));
    expect([r["3324"]!.result, r["3324"]!.use_phone]).toEqual(["create", "7008011223"]);
    expect(r["1521"]!.error).toMatch(/not a 10-digit/);
    expect([r["3225"]!.result, r["3225"]!.customer?.name]).toEqual(["add", "Fancy Store"]);
    expect(r["3287"]!.result).toBe("already");
    expect(c.totals.already).toBe("500.00");

    const off: JarSheet = { ...s, file_total: "1300.00" };
    expect(jarPlan(off, of, new Set()).total_mismatch).toBe(true);
  });
});

// the owner's real file (never committed: refeDocs/payments/ is private)
const DIR = path.resolve(import.meta.dirname, "../../../refeDocs/payments/WhatsApp Chat with Payments");
const REAL = existsSync(DIR) ? readdirSync(DIR).find((f) => f.startsWith("customer_remaining_payment_report") && f.endsWith(".xlsx")) : undefined;
describe.skipIf(!REAL)("plant 001's real 20 L report (11 Nov 2026)", () => {
  it("178 customers, ₹64,324; 27 without a real mobile (₹4,036) left out by default", () => {
    const wb = XLSX.read(readFileSync(path.join(DIR, REAL!)));
    const s = readJarSheet(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Remaining Payment"]!, { header: 1, raw: true, defval: null }));
    expect(s.rows.length).toBe(178);
    const p = jarPlan(s, () => null, new Set());
    expect(p.totals).toEqual({ file: "64324.00", rows: "64324.00", imported: "60288.00", left_out: "4036.00", already: "0.00" });
    expect(p.counts).toMatchObject({ create: 151, skip: 27, opening_bills: 151, errors: 0 });
    expect(p.rows.filter((r) => r.ref.includes("/")).length).toBe(13);
    expect(new Set(p.rows.map((r) => r.number)).size).toBe(178);
  });
});

describe("20 L import and collections, in the database", () => {
  const TODAY = "2026-11-09";
  const make = () => {
    const p = plant();
    return { ...p, accounts: ocUser(p.tenantId, ["accounts"], "Anmol") };
  };
  const input = (over: Partial<JarImportInput> = {}): JarImportInput => {
    const s = readJarSheet(SAMPLE);
    return { file_name: "report.xlsx", rows: s.rows, file_total: s.file_total, choices: {}, place: "Bijepur", ...over };
  };
  const confirm = async (u: ReturnType<typeof make>["owner"], i: JarImportInput, today?: string) => {
    const pv = await jarPreview(u, i);
    return jarImport(u, { ...i, expect: { create: pv.counts.create, add: pv.counts.add, imported: pv.totals.imported } }, today);
  };
  const customerId = async (t: string, phone: string) => ((await asApp(t, `select id from order_capture.customers where phone = '${phone}'`)).rows[0] as { id: string }).id;
  const due = async (u: ReturnType<typeof make>["owner"], id: string) => (await account(u, { kind: "customer", id })).totals.due;

  it("owner only; customers + 20 L marks + OB20 opening bills; the same file again adds nothing", async () => {
    const p = make();
    expect((await refused(() => jarPreview(p.accounts, input()))).status).toBe(403);
    expect((await refused(() => jarPreview(p.support, input()))).status).toBe(403);
    // the preview's numbers must still hold at confirm
    expect((await refused(() => jarImport(p.owner, { ...input(), expect: { create: 9, add: 0, imported: "860.00" } }))).status).toBe(409);
    const done = await confirm(p.owner, input());
    expect(done).toMatchObject({ customers_new: 3, added_to_existing: 0, opening_bills: 3, imported: "860.00", left_out: 2 }); // 1521 is new here too (no Sales customer has its mobile)
    const bills = (await asApp(p.tenantId, `select number, source, ref_no, total::text, customer_name from order_capture.bills order by number`)).rows;
    expect(bills).toEqual([
      { number: "OB20-000123811", source: "opening", ref_no: null, total: "280.00", customer_name: "Padmalochan Mirdha Bijepur" },
      { number: "OB20-1521", source: "opening", ref_no: null, total: "80.00", customer_name: "Seth Fancy Bijepur" },
      { number: "OB20-3287", source: "opening", ref_no: null, total: "500.00", customer_name: "Ekart Logistics Bijepur" },
    ]);
    const ekart = await customerId(p.tenantId, "9658363636");
    expect(await due(p.owner, ekart)).toBe("500.00");
    const list = await jarList(p.accounts);
    expect([list.totals.count, list.totals.due]).toEqual([3, "860.00"]);
    expect(list.customers.find((c) => c.customer_id === ekart)).toMatchObject({ ref: "3287", group_name: "Institutions", pref: "Daily" });
    // again: nothing new
    const again = await jarPreview(p.owner, input());
    expect(again.counts).toMatchObject({ create: 0, add: 0, already: 3, skip: 2 });
    expect((await refused(() => confirm(p.owner, input()))).message).toMatch(/Nothing new/);
    expect((await auditRows(p.tenantId)).filter((a) => a.action === "jar.import").length).toBe(1);
  });

  it("a mobile already in Sales: the due goes to that customer (or another typed mobile)", async () => {
    const p = make();
    await asApp(p.tenantId, `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, created_by, created_by_name) values ('${p.tenantId}', 'Fancy Store', '8114733613', '8114733613', 'Bijepur', gen_random_uuid(), 'Sujata')`);
    const fancy = await customerId(p.tenantId, "8114733613");
    await confirm(p.owner, input({ choices: { "3324": { action: "mobile", mobile: "7008011223" } } }));
    expect(await due(p.owner, fancy)).toBe("80.00");
    const police = await customerId(p.tenantId, "7008011223");
    expect((await asApp(p.tenantId, `select name from order_capture.customers where id = '${police}'`)).rows[0]).toEqual({ name: "Police Party" });
    expect(await due(p.owner, police)).toBe("360.00");
  });

  it("opening balances are money owed, never sales", async () => {
    const p = make();
    await confirm(p.owner, input()); // dated today: inside "this month"
    const r = await salesReport(p.owner, "customer", readParams({ period: "this_month" }));
    expect(r.total.amount).toBe(0n);
    const a = await account(p.owner, { kind: "customer", id: await customerId(p.tenantId, "9658363636") });
    expect(a.bills[0]).toMatchObject({ number: "OB20-3287", opening_balance: true });
    expect([a.insights.ordering.purchases, a.insights.year.ytd, a.insights.year.bills_12m]).toEqual([0, 0n, 0]); // "Buying & paying" leaves it out
    expect(isOpeningBill({ source: "opening" }) && isOpeningBill({ source: "zoho", zohoInvoiceId: "ob:1" }) && !isOpeningBill({ source: "plantops" })).toBe(true);
  });

  it("a collection: cash into the cash book now, the bills untouched until posted; online lines never in the box", async () => {
    const p = make();
    await confirm(p.owner, input());
    await startCashBook(p.owner, { date: "2026-11-07", counted: "1000" }, TODAY);
    const ekart = await customerId(p.tenantId, "9658363636");
    const seth = await customerId(p.tenantId, "8114733613");
    // who may: owner, Accounts; not Order desk, plant staff, store keepers, support
    const lines = [{ customer_id: ekart, amount: "200", mode: "cash" as const }, { customer_id: seth, amount: "50", mode: "cash" as const }, { customer_id: seth, amount: "30", mode: "upi" as const }];
    for (const u of [p.desk, p.staff, p.keeper, p.support]) expect((await refused(() => addCollection(u, { cash_date: TODAY, lines }, TODAY))).status).toBe(403);
    expect((await refused(() => addCollection(p.accounts, { cash_date: TODAY, lines: [{ customer_id: randomUUID(), amount: "5", mode: "cash" }] }, TODAY))).message).toMatch(/isn't in Sales/);
    const saved = await addCollection(p.accounts, { cash_date: TODAY, work_date: "2026-11-08", lines }, TODAY);
    expect(saved).toEqual({ ref: "C-0001", cash: "250.00", online: "30.00", lines: 3, cash_date: TODAY, work_date: "2026-11-08" });
    const sheet = await daySheet(p.accounts, TODAY, TODAY);
    expect(sheet.started && [sheet.in, sheet.expected, sheet.entries[0]!.kind]).toEqual(["250.00", "1250.00", "collection"]);
    // the owner's rule: nothing on the accounts yet
    expect([await due(p.owner, ekart), await due(p.owner, seth)]).toEqual(["500.00", "80.00"]);
    const waiting = await collectionsList(p.accounts);
    expect(waiting.waiting).toEqual({ count: 3, amount: "280.00" });
    expect((await jarList(p.owner)).totals.waiting).toBe("280.00");
    // the search puts 20 L customers first and pre-fills the last amount
    const found = await collectionSearch(p.accounts, "bijepur");
    expect(found.every((c) => c.jar)).toBe(true);
    expect(found.find((c) => c.id === seth)?.last).toBe("30.00");

    // only online lines: payments-to-be only, nothing for the box
    const online = await addCollection(p.owner, { cash_date: TODAY, lines: [{ customer_id: ekart, amount: "100", mode: "upi" }] }, TODAY);
    expect([online.ref, online.cash]).toEqual([null, "0.00"]);
    const after = await daySheet(p.owner, TODAY, TODAY);
    expect(after.started && after.entries.length).toBe(1);
  });

  it("posting: a payment on the account (oldest first), once; another customer; turn down; a cancelled payment waits again", async () => {
    const p = make();
    await confirm(p.owner, input());
    await startCashBook(p.owner, { date: "2026-11-07", counted: "1000" }, TODAY);
    const ekart = await customerId(p.tenantId, "9658363636");
    const seth = await customerId(p.tenantId, "8114733613");
    await addCollection(p.accounts, { cash_date: TODAY, lines: [{ customer_id: ekart, amount: "200", mode: "cash" }, { customer_id: seth, amount: "50", mode: "cash" }, { customer_id: seth, amount: "999", mode: "cash" }] }, TODAY);
    const [a, b, c] = (await collectionsList(p.owner)).lines;
    expect([a!.customer.id, b!.customer.id, c!.amount]).toEqual([ekart, seth, "999.00"]);
    expect((await refused(() => postLine(p.desk, a!.id, { bill_ids: [] }))).status).toBe(403);
    expect((await refused(() => postLine(p.support, a!.id, { bill_ids: [] }))).status).toBe(403);

    const pay = await postLine(p.accounts, a!.id, { bill_ids: [] });
    expect([pay.number, pay.amount, pay.mode, pay.bills]).toEqual(["P-0001", "200.00", "cash", ["OB20-3287"]]);
    expect(await due(p.owner, ekart)).toBe("300.00");
    expect((await refused(() => postLine(p.accounts, a!.id, { bill_ids: [] }))).status).toBe(409);

    // the money was Ekart's, typed under Seth
    const other = await postLine(p.owner, b!.id, { customer_id: ekart, bill_ids: [] });
    expect(other.customer).toBe("Ekart Logistics Bijepur");
    expect([await due(p.owner, ekart), await due(p.owner, seth)]).toEqual(["250.00", "80.00"]);

    expect(TurnDownInput.safeParse({ reason: "x" }).success).toBe(false); // a reason is needed (checked on every request)
    await turnDownLine(p.accounts, c!.id, { reason: "typed twice" });
    expect((await refused(() => postLine(p.owner, c!.id, { bill_ids: [] }))).message).toMatch(/turned down/);
    expect((await collectionsList(p.owner)).waiting.count).toBe(0);

    // the cash entry can't be cancelled while its lines are on accounts
    const day = await daySheet(p.owner, TODAY, TODAY);
    if (!day.started) throw new Error("the cash book should be started");
    const entry = day.entries[0]!;
    expect((await refused(() => cancelEntry(p.owner, entry.id, { reason: "wrong" }))).message).toMatch(/P-0001, P-0002|P-0002, P-0001/);
    await cancelPayment(p.owner, pay.id, { reason: "wrong customer" });
    expect((await collectionsList(p.owner)).waiting.count).toBe(1); // that line waits again
    expect(await due(p.owner, ekart)).toBe("450.00");
    await cancelPayment(p.owner, other.id, { reason: "wrong customer" });
    await cancelEntry(p.owner, entry.id, { reason: "entered on the wrong day" });
    const all = await collectionsList(p.owner, "all");
    expect(all.lines.map((l) => l.status).sort()).toEqual(["turned_down", "void", "void"]);
    expect((await refused(() => postLine(p.owner, a!.id, { bill_ids: [] }))).message).toMatch(/was cancelled/);
    const acts = (await auditRows(p.tenantId)).map((x) => x.action);
    expect(acts.filter((x) => x === "collection.post").length).toBe(2);
    expect(acts).toContain("collection.turn_down");
  });

  it("another plant sees none of it and can't post its lines", async () => {
    const a = make();
    const b = make();
    await confirm(a.owner, input());
    await startCashBook(a.owner, { date: "2026-11-07", counted: "0" }, TODAY);
    const ekart = await customerId(a.tenantId, "9658363636");
    await addCollection(a.owner, { cash_date: TODAY, lines: [{ customer_id: ekart, amount: "10", mode: "cash" }] }, TODAY);
    const line = (await collectionsList(a.owner)).lines[0]!;
    expect((await jarList(b.owner)).customers).toEqual([]);
    expect((await collectionsList(b.owner)).lines).toEqual([]);
    expect((await refused(() => postLine(b.owner, line.id, { bill_ids: [] }))).status).toBe(404);
    await startCashBook(b.owner, { date: "2026-11-07", counted: "0" }, TODAY);
    expect((await refused(() => addCollection(b.owner, { cash_date: TODAY, lines: [{ customer_id: ekart, amount: "10", mode: "cash" }] }, TODAY))).message).toMatch(/isn't in Sales/);
    expect((await asApp(b.tenantId, `select * from order_capture.jar_customers`)).rows).toEqual([]);
  });

  it("the database refuses a bad opening bill and an online line counted as cash", async () => {
    const p = make();
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    await confirm(p.owner, input());
    const ekart = await customerId(p.tenantId, "9658363636");
    const bad = (sql: string) => dbError(asApp(p.tenantId, sql));
    expect(await bad(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, sub_total, total, created_by, created_by_name) values ('${p.tenantId}', 'opening', 'OB20-x', 7, '2026-11-11', '${ekart}', 'E', 1, 1, gen_random_uuid(), 'S')`)).toMatch(/check/);
    expect(await bad(`insert into order_capture.collection_lines (tenant_id, batch_id, line_no, customer_id, amount, mode, work_date, created_by, created_by_name) values ('${p.tenantId}', gen_random_uuid(), 1, '${ekart}', 5, 'cash', '2026-11-11', gen_random_uuid(), 'S')`)).toMatch(/check/);
    expect(await bad(`insert into order_capture.cash_entries (tenant_id, ref_no, cash_date, work_date, kind, direction, amount, created_by, created_by_name) values ('${p.tenantId}', 99, '2026-11-11', '2026-11-11', 'collection', 'out', 5, gen_random_uuid(), 'S')`)).toMatch(/check/);
  });
});

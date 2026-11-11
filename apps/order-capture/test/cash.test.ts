// Cash book step C1 (docs/CASHBOOK_PHASE_PLAN.md): the rules with the RB payments group's real numbers (6-9 Nov 2026:
// 10,375 → 9,435 → 14,435 → 26,825), who may do what (owner, Accounts; support reads; Order desk, plant staff, store
// keepers nothing), the date window, closing and correcting, cancelling, another plant sees none of it, the alerts.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookDays, differenceText, expectedOn, paise, rupees, signedMoney, type MathEntry } from "@/lib/cash";
import { addEntry, cancelEntry, cashBook, cashLists, closeDay, daySheet, editListItem, addListItem, notClosedPlants, startCashBook, type EntryInput } from "@/server/cash";
import { closeNotifications, expenseNotification } from "@/server/cash-notify";
import { kit } from "@/server/kit";
import { auditRows, ocUser, plant, refused } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const E = (cash_date: string, direction: "in" | "out", amount: string, cancelled = false): MathEntry => ({ cash_date, direction, amount, cancelled });

describe("the cash rules (src/lib/cash.ts)", () => {
  it("expected = last close + in − out since, with the chat's 9 Nov: 14,435 + 22,550 − 10,160 = 26,825", () => {
    const closes = [{ cash_date: "2026-11-07", counted: "14435.00" }];
    const entries = [E("2026-11-09", "in", "2020"), E("2026-11-09", "in", "19170"), E("2026-11-09", "in", "590"), E("2026-11-09", "in", "270"), E("2026-11-09", "in", "500"),
      E("2026-11-09", "out", "160"), E("2026-11-09", "out", "6500"), E("2026-11-09", "out", "1000"), E("2026-11-09", "out", "2500"), E("2026-11-09", "out", "999", true)];
    const r = expectedOn("2026-11-09", closes, entries)!;
    expect([r.from, rupees(r.opening), rupees(r.in), rupees(r.out), rupees(r.expected)]).toEqual(["2026-11-07", "14435.00", "22550.00", "10160.00", "26825.00"]);
    expect(expectedOn("2026-11-07", closes, entries)).toBeNull(); // nothing before the first close
  });

  it("the book carries each day's count (or its expected cash, when not closed) into the next day", () => {
    const closes = [{ cash_date: "2026-11-05", counted: "10375" }, { cash_date: "2026-11-06", counted: "9435" }, { cash_date: "2026-11-09", counted: "26800" }];
    const entries = [E("2026-11-06", "in", "8150"), E("2026-11-06", "out", "9090"), E("2026-11-07", "in", "5200"), E("2026-11-07", "out", "200"), E("2026-11-09", "in", "22550"), E("2026-11-09", "out", "10160")];
    const days = bookDays(closes, entries).map((d) => [d.date, rupees(d.opening), rupees(d.expected), d.counted === null ? null : rupees(d.counted), d.difference === null ? null : rupees(d.difference)]);
    expect(days).toEqual([
      ["2026-11-05", "10375.00", "10375.00", "10375.00", "0.00"],
      ["2026-11-06", "10375.00", "9435.00", "9435.00", "0.00"],
      ["2026-11-07", "9435.00", "14435.00", null, null], // not closed: 9 Nov starts from its expected cash
      ["2026-11-09", "14435.00", "26825.00", "26800.00", "-25.00"],
    ]);
  });

  it("money words", () => {
    expect([differenceText(0n), differenceText(-32500n), differenceText(5000n)]).toEqual(["Matches", "Short ₹325", "Extra ₹50"]);
    expect([signedMoney(2682500n), signedMoney(-12050n)]).toEqual(["₹26,825", "−₹120.50"]);
  });
});

describe("the cash book, in the database", () => {
  const TODAY = "2026-11-09";
  const make = () => {
    const p = plant();
    return { ...p, accounts: ocUser(p.tenantId, ["accounts"], "Anmol") };
  };
  const exp = (over: Partial<EntryInput> = {}) => ({ kind: "expense" as const, amount: "160", cash_date: TODAY, ...over });

  it("nothing before the owner starts it; only the owner starts it, once, and gets the starter expense types", async () => {
    const p = make();
    expect((await refused(() => addEntry(p.accounts, { ...exp(), category_id: randomUUID() }, TODAY))).message).toMatch(/hasn't been started/);
    expect((await refused(() => startCashBook(p.accounts, { date: TODAY, counted: "1000" }, TODAY))).status).toBe(403);
    expect((await refused(() => startCashBook(p.owner, { date: "2026-11-10", counted: "1000" }, TODAY))).status).toBe(400); // future
    await startCashBook(p.owner, { date: "2026-11-07", counted: "14435" }, TODAY);
    expect((await refused(() => startCashBook(p.owner, { date: TODAY, counted: "1" }, TODAY))).status).toBe(409);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const lists = await cashLists(p.owner);
    expect(lists.categories.map((c) => c.name)).toContain("Diesel");
    expect((await daySheet(p.accounts, TODAY, TODAY)).started).toBe(true);
  });

  it("who may do what: owner and Accounts enter and close; support reads; Order desk, plant staff and store keepers nothing", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "14435" }, TODAY);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const cat = (await cashLists(p.owner)).categories.find((c) => c.name === "Cleaning")!;
    await addEntry(p.accounts, exp({ category_id: cat.id, paid_to: "Phenyl" }), TODAY);
    for (const u of [p.desk, p.staff, p.keeper, p.support]) expect((await refused(() => addEntry(u, exp({ category_id: cat.id }), TODAY))).status, u.name).toBe(403);
    for (const u of [p.desk, p.staff, p.keeper]) expect((await refused(() => daySheet(u, TODAY, TODAY))).status).toBe(403);
    const sheet = await daySheet(p.support, TODAY, TODAY);
    expect(sheet.started && sheet.entries.length).toBe(1);
    expect((await refused(() => closeDay(p.support, { date: TODAY, counted: "1" }, TODAY))).status).toBe(403);
    expect((await refused(() => addListItem(p.accounts, { list: "vehicle", name: "Mini" }))).message).toBe("Only the plant owner can do this");
  });

  it("dates: after the last close, up to today, at most 7 days back; the work day can be earlier ('for 7 Nov')", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-01", counted: "10000" }, TODAY);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const cat = (await cashLists(p.owner)).categories[0]!;
    const e = (over: Partial<EntryInput>) => addEntry(p.accounts, exp({ category_id: cat.id, ...over }), TODAY);
    expect((await refused(() => e({ cash_date: "2026-11-10" }))).message).toMatch(/after today/);
    expect((await refused(() => e({ cash_date: "2026-11-01" }))).message).toMatch(/already closed/);
    expect((await refused(() => e({ cash_date: "2026-11-01", amount: "5" }))).status).toBe(400);
    const s = await e({ cash_date: "2026-11-02" }); // exactly 7 days back
    expect(s.ref).toBe("C-0001");
    expect((await refused(() => e({ work_date: "2026-11-10" }))).message).toMatch(/can't be after/);
    const late = await e({ work_date: "2026-11-07" });
    expect([late.ref, late.work_date, late.cash_date]).toEqual(["C-0002", "2026-11-07", TODAY]);
  });

  it("staff cash: by name or a plant person; never to yourself; an advance needs its purpose", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "14435" }, TODAY);
    const sujataId = p.owner.userId;
    vi.spyOn(kit, "contacts").mockResolvedValue([{ user_id: sujataId, display_name: "Sujata", phone: null, roles: ["tenant_admin"] }, { user_id: p.accounts.userId, display_name: "Anmol", phone: null, roles: ["accounts"] }]);
    const s = (u: typeof p.owner, over: Partial<EntryInput>) => addEntry(u, { kind: "staff_out", amount: "1000", cash_date: TODAY, staff_purpose: "advance", ...over }, TODAY);
    expect((await refused(() => s(p.accounts, { person_name: "anmol" }))).message).toMatch(/given to yourself/);
    expect((await refused(() => s(p.accounts, { person_user_id: p.accounts.userId }))).message).toMatch(/given to yourself/);
    expect((await refused(() => s(p.accounts, { person_name: "Kedar", staff_purpose: undefined }))).message).toMatch(/what the cash was for/);
    expect((await refused(() => s(p.accounts, { person_user_id: randomUUID() }))).message).toMatch(/isn't one of the plant's people/);
    expect((await s(p.owner, { person_user_id: p.accounts.userId })).person).toBe("Anmol");
    expect((await s(p.accounts, { person_name: "Kedar", amount: "6500" })).purpose).toBe("advance");
    const back = await addEntry(p.accounts, { kind: "staff_in", amount: "300", cash_date: TODAY, person_name: "Bindu" }, TODAY);
    expect(back.purpose).toBeNull();
  });

  it("closing: expected from the entries, a difference needs a reason, the next day starts from the count; owner corrects with a reason", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "14435" }, TODAY);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    await addEntry(p.accounts, { kind: "other_in", amount: "22550", cash_date: TODAY, note: "chat total" }, TODAY);
    await addEntry(p.accounts, { kind: "staff_out", amount: "10160", cash_date: TODAY, person_name: "Kedar", staff_purpose: "advance" }, TODAY);
    let sheet = await daySheet(p.accounts, TODAY, TODAY);
    expect(sheet.started && [sheet.opening, sheet.in, sheet.out, sheet.expected, sheet.can_close]).toEqual(["14435.00", "22550.00", "10160.00", "26825.00", true]);
    expect((await refused(() => closeDay(p.accounts, { date: TODAY, counted: "26500" }, TODAY))).message).toMatch(/short by 325.00/);
    const c = await closeDay(p.accounts, { date: TODAY, counted: "26500", reason: "tea not entered" }, TODAY);
    expect([c.version, c.expected, c.difference]).toEqual([1, "26825.00", "-325.00"]);
    expect((await refused(() => closeDay(p.accounts, { date: "2026-11-08", counted: "1" }, TODAY))).message).toMatch(/are closed/);
    expect((await refused(() => closeDay(p.accounts, { date: TODAY, counted: "26825", reason: "counted again" }, TODAY))).status).toBe(403);
    expect((await refused(() => closeDay(p.owner, { date: TODAY, counted: "26825" }, TODAY))).message).toMatch(/needs a reason/);
    const fix = await closeDay(p.owner, { date: TODAY, counted: "26825", reason: "counted again" }, TODAY);
    expect([fix.version, fix.difference]).toEqual([2, "0.00"]);
    sheet = await daySheet(p.accounts, "2026-11-10", "2026-11-10");
    expect(sheet.started && [sheet.opening, sheet.expected, sheet.can_enter]).toEqual(["26825.00", "26825.00", true]);
    // an entry on a closed day is refused; tomorrow is fine
    expect((await refused(() => addEntry(p.accounts, { kind: "other_in", amount: "1", cash_date: TODAY }, "2026-11-10"))).message).toMatch(/already closed/);
    const audit = (await auditRows(p.tenantId)).map((r) => r.action);
    expect(audit).toEqual(["cash.start", "cash.entry", "cash.entry", "cash.close", "cash.close_fix"]);
  });

  it("cancel: owner only, with a reason, once; the cancelled entry counts for nothing", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "1000" }, TODAY);
    const e = await addEntry(p.accounts, { kind: "owner_out", amount: "400", cash_date: TODAY }, TODAY);
    expect((await refused(() => cancelEntry(p.accounts, e.id, { reason: "twice" }))).status).toBe(403);
    expect((await refused(() => cancelEntry(p.owner, e.id, { reason: "x" }))).status).toBe(0); // zod in the route; here the database check refuses
    await cancelEntry(p.owner, e.id, { reason: "entered twice" });
    expect((await refused(() => cancelEntry(p.owner, e.id, { reason: "again" }))).status).toBe(409);
    const sheet = await daySheet(p.owner, TODAY, TODAY);
    expect(sheet.started && [sheet.expected, sheet.entries[0]!.cancelled?.reason]).toEqual(["1000.00", "entered twice"]);
  });

  it("the month's cash book: days, expenses by type, staff cash, late entries", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-05", counted: "10375" }, TODAY);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const cats = (await cashLists(p.owner)).categories;
    const diesel = cats.find((c) => c.name === "Diesel")!.id;
    await addEntry(p.accounts, { kind: "other_in", amount: "8150", cash_date: "2026-11-06" }, TODAY);
    await addEntry(p.accounts, { kind: "expense", category_id: diesel, amount: "2000", cash_date: "2026-11-06" }, TODAY);
    await addEntry(p.accounts, { kind: "staff_out", amount: "7090", cash_date: "2026-11-06", person_name: "Sushil", staff_purpose: "plant" }, TODAY);
    await closeDay(p.accounts, { date: "2026-11-06", counted: "9435" }, TODAY);
    await addEntry(p.accounts, { kind: "other_in", amount: "5200", cash_date: "2026-11-07", work_date: "2026-11-05" }, TODAY);
    const book = await cashBook(p.owner, "2026-11");
    expect(book.started && book.days.map((d) => [d.date, d.expected, d.counted])).toEqual([
      ["2026-11-05", "10375.00", "10375.00"],
      ["2026-11-06", "9435.00", "9435.00"],
      ["2026-11-07", "14635.00", null],
    ]);
    expect(book.categories).toEqual([{ name: "Diesel", amount: "2000.00" }]);
    expect(book.staff.map((s) => [s.person, s.purpose, s.amount])).toEqual([["Sushil", "plant", "7090.00"]]);
    expect(book.totals).toMatchObject({ expenses: "2000.00", entries: 4, late: 1 });
  });

  it("another plant sees none of it and can't use this plant's expense types", async () => {
    const a = make();
    const b = make();
    await startCashBook(a.owner, { date: "2026-11-07", counted: "500" }, TODAY);
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const cat = (await cashLists(a.owner)).categories[0]!;
    const e = await addEntry(a.accounts, exp({ category_id: cat.id }), TODAY);
    expect((await daySheet(b.owner, TODAY, TODAY)).started).toBe(false);
    await startCashBook(b.owner, { date: "2026-11-07", counted: "1" }, TODAY);
    expect((await refused(() => addEntry(b.accounts, exp({ category_id: cat.id }), TODAY))).message).toMatch(/isn't on the list/);
    expect((await refused(() => cancelEntry(b.owner, e.id, { reason: "not ours" }))).status).toBe(404);
    expect((await refused(() => editListItem(b.owner, cat.id, { list: "category", active: false }))).status).toBe(404);
  });

  it("lists: owner adds, renames and switches off; a switched-off type can't be used; no two with the same name", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "500" }, TODAY);
    const v = await addListItem(p.owner, { list: "vehicle", name: "Mini" });
    expect((await refused(() => addListItem(p.owner, { list: "vehicle", name: "mini" }))).status).toBe(409);
    await editListItem(p.owner, v.id, { list: "vehicle", name: "Mini van" });
    vi.spyOn(kit, "contacts").mockResolvedValue([]);
    const cat = (await cashLists(p.owner)).categories[0]!;
    await editListItem(p.owner, cat.id, { list: "category", active: false });
    expect((await refused(() => addEntry(p.accounts, exp({ category_id: cat.id }), TODAY))).message).toMatch(/isn't on the list/);
    const lists = await cashLists(p.owner);
    expect(lists.vehicles.map((x) => x.name)).toEqual(["Mini van"]);
  });

  it("daily job: a plant with entries after its last close, up to yesterday, is reminded", async () => {
    const p = make();
    await startCashBook(p.owner, { date: "2026-11-07", counted: "500" }, TODAY);
    await addEntry(p.accounts, { kind: "other_in", amount: "50", cash_date: "2026-11-08" }, TODAY);
    const list = await notClosedPlants(async () => [p.tenantId], "2026-11-10");
    expect(list).toEqual([{ tenantId: p.tenantId, since: "2026-11-07", days: ["2026-11-08"], yesterday: "2026-11-09" }]);
    expect(await notClosedPlants(async () => [p.tenantId], "2026-11-09")).toEqual([{ tenantId: p.tenantId, since: "2026-11-07", days: ["2026-11-08"], yesterday: "2026-11-08" }]);
    await closeDay(p.accounts, { date: "2026-11-08", counted: "550" }, TODAY);
    expect(await notClosedPlants(async () => [p.tenantId], "2026-11-10")).toEqual([]);
  });
});

describe("cash alerts", () => {
  const p = plant();
  const anmol = ocUser(p.tenantId, ["accounts"], "Anmol");
  it("a close is a bell; ₹100 or more off is also a phone alert", () => {
    const base = { id: "c1", date: "2026-11-09", version: 1, counted: "26825.00", expected: "26825.00", difference: "0.00" };
    const ok = closeNotifications(anmol, base);
    expect(ok.map((n) => [n.kind, n.level, n.title])).toEqual([["order_capture.cash_closed", "bell", "Cash in hand ₹26,825 (9 Nov)"]]);
    expect(ok[0]!.exclude_user_id).toBe(anmol.userId);
    expect(closeNotifications(anmol, { ...base, counted: "26775.00", difference: "-50.00" })).toHaveLength(1);
    const short = closeNotifications(anmol, { ...base, counted: "26500.00", difference: "-325.00" });
    expect(short.map((n) => [n.kind, n.level, n.title])).toEqual([
      ["order_capture.cash_closed", "bell", "Cash in hand ₹26,500 (9 Nov)"],
      ["order_capture.cash_short", "push", "Cash short ₹325 on 9 Nov"],
    ]);
  });
  it("an expense of ₹2,000 or more goes to the phone; smaller ones and other kinds don't", () => {
    const e = { id: "e1", ref: "C-0007", kind: "expense" as const, amount: "8000.00", cash_date: "2026-10-26", work_date: "2026-10-26", category: "Building", person: null, purpose: null, paid_to: "Tiles", note: null };
    expect(expenseNotification(anmol, e)).toMatchObject({ kind: "order_capture.cash_expense", level: "push", title: "Expense ₹8,000: Building", body: "Tiles (C-0007, by Anmol)" });
    expect(expenseNotification(anmol, { ...e, amount: "1999.00" })).toBeNull();
    expect(expenseNotification(anmol, { ...e, kind: "staff_out" })).toBeNull();
    expect(paise("2000")).toBe(200000n);
  });
});

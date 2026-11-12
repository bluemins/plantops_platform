// Cash book step C4 (docs/CASHBOOK_PHASE_PLAN.md section 9; owner 2026-11-12): staff cash linked to Attendance.
// - an "Advance against salary" goes to one picked employee (Plant staff) and is sent to Attendance after the save;
//   refused → red with a bell to owners, Send again after the fix; unreachable → waiting, the daily job sends it
// - "Took back" for an advance names it, never more than is left, needs Attendance's yes first (refused once that month
//   is paid: nothing saved)
// - cancelling an advance in Attendance sends a correction; cash brought back that is in Attendance can't be cancelled
// - With staff: given − brought back − spent; "spent" never more than is open, never your own; owner cancels it
// - a plant without the link works as before (typed names, nothing sent)
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrySends, sendAgain } from "@/server/attendance-link";
import { addEntry, cancelEntry, cashLists, daySheet, startCashBook, type EntryInput } from "@/server/cash";
import { kit } from "@/server/kit";
import { addSpend, cancelSpend, openWithStaff } from "@/server/staff-cash";
import { asOwner, ocUser, plant, refused } from "./helpers";

const TODAY = "2026-11-12";
const KEY = `atc_${"k".repeat(43)}`;

type Call = { url: string; auth: string | null; body: Record<string, unknown> };
let calls: Call[] = [];
/** What the fake Attendance answers next (by action); default 201 with a new id. */
let answer: (b: Record<string, unknown>) => { status: number; body: unknown } | "down" = () => ({ status: 201, body: { id: randomUUID(), already: false } });

beforeEach(() => {
  calls = [];
  answer = () => ({ status: 201, body: { id: randomUUID(), already: false } });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, auth: new Headers(init?.headers).get("authorization"), body });
    const a = answer(body);
    if (a === "down") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "content-type": "application/json" } });
  });
  vi.spyOn(kit, "notify").mockResolvedValue(undefined as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ATTEND_CASHBOOK_KEYS;
  delete process.env.ATTEND_URL;
});

async function setup({ link = true } = {}) {
  const p = plant();
  const accounts = ocUser(p.tenantId, ["accounts"], "Bindu");
  const ramu = { user_id: randomUUID(), display_name: "Ramu", phone: null, roles: ["plant_staff", "store_keeper"] };
  const helper = { user_id: randomUUID(), display_name: "Maheshwar", phone: null, roles: ["store_keeper"] };
  vi.spyOn(kit, "contacts").mockResolvedValue([ramu, helper, { user_id: accounts.userId, display_name: "Bindu", phone: null, roles: ["accounts", "plant_staff"] }] as never);
  if (link) {
    process.env.ATTEND_CASHBOOK_KEYS = JSON.stringify({ [p.tenantId]: KEY });
    process.env.ATTEND_URL = "https://attend.test/";
  }
  await startCashBook(p.owner, { date: "2026-11-11", counted: "20000" }, TODAY);
  const entry = (by: typeof accounts, over: Partial<EntryInput>) => addEntry(by, { amount: "2000", cash_date: TODAY, ...over } as EntryInput, TODAY);
  const advance = (amount = "2000") => entry(accounts, { kind: "staff_out", staff_purpose: "advance", person_user_id: ramu.user_id, amount });
  const sends = async () => (await asOwner(`select action, source_ref, status, attempts, last_error from order_capture.attendance_sends where tenant_id = $1 order by created_at`, [p.tenantId])).rows;
  return { p, accounts, ramu, helper, entry, advance, sends };
}

describe("an advance against salary", () => {
  it("goes to a picked employee only, and is sent to Attendance right after the save with the plant's key", async () => {
    const s = await setup();
    expect((await refused(() => s.entry(s.accounts, { kind: "staff_out", staff_purpose: "advance", person_name: "Ramu" }))).message).toMatch(/Pick the person from the list/);
    expect((await refused(() => s.entry(s.accounts, { kind: "staff_out", staff_purpose: "advance", person_user_id: s.helper.user_id }))).message).toMatch(/isn't Plant staff/);
    expect((await refused(() => s.entry(s.accounts, { kind: "staff_out", staff_purpose: "advance", person_user_id: s.accounts.userId }))).message).toMatch(/yourself/);
    const e = await s.advance();
    expect(e.attendance).toEqual({ status: "sent", message: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://attend.test/api/cashbook/v1/advances", auth: `Bearer ${KEY}` });
    expect(calls[0]!.body).toEqual({ action: "advance", source_ref: e.ref, user_id: s.ramu.user_id, by_id: s.accounts.userId, by_name: "Bindu", on_date: TODAY, amount: "2000.00" });
    const sheet = await daySheet(s.p.owner, TODAY, TODAY);
    expect(sheet.started && sheet.entries[0]!.attendance).toEqual({ status: "sent", message: null });
    // plant spending and salary in cash are never sent
    await s.entry(s.accounts, { kind: "staff_out", staff_purpose: "plant", person_name: "Maheshwar", amount: "5000" });
    expect(calls).toHaveLength(1);
  });

  it("refused by Attendance: red with the reason, a bell to owners, and Send again works after the fix", async () => {
    const s = await setup();
    answer = () => ({ status: 400, body: { error: "Set Ramu's salary in Attendance first, then send it again" } });
    const e = await s.advance();
    expect(e.attendance).toEqual({ status: "refused", message: "Set Ramu's salary in Attendance first, then send it again" });
    expect(vi.mocked(kit.notify).mock.calls.map((c) => (c[1] as { kind: string }).kind)).toEqual(["order_capture.cash_advance_failed"]);
    answer = () => ({ status: 201, body: { id: randomUUID(), already: false } });
    expect((await refused(() => sendAgain(s.p.desk, e.id))).status).toBe(403);
    expect(await sendAgain(s.accounts, e.id)).toEqual({ status: "sent", message: null });
    expect((await s.sends()).map((r) => [r.status, r.attempts])).toEqual([["sent", 2]]);
  });

  it("Attendance down: the entry is saved and waits; the daily job sends it once Attendance is back", async () => {
    const s = await setup();
    answer = () => "down";
    const e = await s.advance();
    expect(e.attendance?.status).toBe("waiting");
    answer = () => ({ status: 500, body: { error: "boom" } });
    await retrySends();
    expect((await s.sends())[0]).toMatchObject({ status: "waiting", attempts: 2 });
    answer = () => ({ status: 200, body: { id: randomUUID(), already: true } });
    await retrySends();
    expect((await s.sends())[0]).toMatchObject({ status: "sent", attempts: 3 });
  });

  it("a plant without the link: typed names, nothing sent", async () => {
    const s = await setup({ link: false });
    const e = await s.entry(s.accounts, { kind: "staff_out", staff_purpose: "advance", person_name: "Gaja" });
    expect(e.attendance ?? null).toBeNull();
    expect(calls).toHaveLength(0);
    expect((await cashLists(s.accounts)).link).toBe(false);
  });
});

describe("cash brought back for an advance", () => {
  it("names the advance, never more than is left, after Attendance says yes; the person is the advance's", async () => {
    const s = await setup();
    const adv = await s.advance("2000");
    const back = await s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: adv.id, amount: "500" });
    expect(back.person).toBe("Ramu");
    expect(calls.map((c) => [c.body.action, c.body.check ?? false])).toEqual([["advance", false], ["return", true], ["return", false]]);
    expect(calls[2]!.body).toMatchObject({ source_ref: back.ref, of_ref: adv.ref, amount: "500.00" });
    expect((await refused(() => s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: adv.id, amount: "1600" }))).message).toBe(`Only 1500.00 of ${adv.ref} is left to bring back`);
    expect((await refused(() => s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", amount: "1" }))).message).toMatch(/Pick which advance/);
    const lists = await cashLists(s.p.owner);
    expect(lists.advances.map((a) => [a.ref, a.left])).toEqual([[adv.ref, "1500.00"]]);
  });

  it("refused when that month is paid (owner, 2026-11-12): nothing is saved", async () => {
    const s = await setup();
    const adv = await s.advance();
    answer = (b) => (b.action === "return" ? { status: 409, body: { error: `${adv.ref} was already taken from Ramu's Nov 2026 salary (paid). Nothing to bring back.` } } : { status: 201, body: { id: randomUUID() } });
    expect((await refused(() => s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: adv.id, amount: "500" }))).message).toMatch(/already taken from .* salary \(paid\)/);
    const sheet = await daySheet(s.p.owner, TODAY, TODAY);
    expect(sheet.started && sheet.entries.map((e) => e.kind)).toEqual(["staff_out"]);
  });

  it("waits until the advance itself is in Attendance", async () => {
    const s = await setup();
    answer = () => ({ status: 400, body: { error: "Set Ramu's salary first" } });
    const adv = await s.advance();
    answer = () => ({ status: 201, body: { id: randomUUID() } });
    expect((await refused(() => s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: adv.id, amount: "100" }))).message).toMatch(/isn't in Attendance yet/);
  });
});

describe("cancelling", () => {
  it("an advance in Attendance sends a correction; cash brought back that is in Attendance can't be cancelled", async () => {
    const s = await setup();
    const adv = await s.advance();
    const back = await s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: adv.id, amount: "500" });
    expect((await refused(() => cancelEntry(s.p.owner, back.id, { reason: "typed twice" }))).message).toMatch(/already in Attendance/);
    await cancelEntry(s.p.owner, adv.id, { reason: "wrong person" });
    expect(calls.at(-1)!.body).toEqual({ action: "cancel", source_ref: `${adv.ref}/cancel`, user_id: s.ramu.user_id, by_id: s.p.owner.userId, by_name: "Sujata", of_ref: adv.ref, reason: "wrong person" });
    expect((await s.sends()).map((r) => [r.action, r.status])).toEqual([["advance", "sent"], ["return", "sent"], ["cancel", "sent"]]);
  });

  it("an advance that never reached Attendance is just not sent", async () => {
    const s = await setup();
    answer = () => "down";
    const adv = await s.advance();
    await cancelEntry(s.p.owner, adv.id, { reason: "wrong amount" });
    expect((await s.sends()).map((r) => [r.action, r.status, r.last_error])).toEqual([["advance", "refused", "Cancelled in the cash book before it reached Attendance"]]);
    answer = () => ({ status: 201, body: { id: randomUUID() } });
    await retrySends();
    expect(calls.filter((c) => c.body.action !== "advance")).toHaveLength(0);
  });
});

describe("With staff", () => {
  it("open = given − brought back − spent; spent never more than is open or your own; owner cancels; support reads", async () => {
    const s = await setup({ link: false });
    await s.entry(s.p.owner, { kind: "staff_out", staff_purpose: "plant", person_user_id: s.helper.user_id, amount: "5000", note: "mess lagi" });
    await s.entry(s.p.owner, { kind: "staff_in", staff_purpose: "plant", person_user_id: s.helper.user_id, amount: "1000" });
    const cat = (await cashLists(s.p.owner)).categories.find((c) => c.name === "Meal")!;
    let row = (await openWithStaff(s.p.owner)).find((r) => r.person === "Maheshwar")!;
    expect(row.open).toBe("4000.00");
    const spent = await addSpend(s.accounts, { person_key: row.key, spent_on: TODAY, category_id: cat.id, amount: "1500", paid_to: "Mess" }, TODAY);
    expect(spent.open).toBe("2500.00");
    expect((await refused(() => addSpend(s.accounts, { person_key: row.key, spent_on: TODAY, category_id: cat.id, amount: "2600" }, TODAY))).message).toBe("Only 2500.00 is open with Maheshwar");
    for (const u of [s.p.desk, s.p.keeper, s.p.support]) expect((await refused(() => addSpend(u, { person_key: row.key, spent_on: TODAY, category_id: cat.id, amount: "1" }, TODAY))).status).toBe(403);
    expect((await refused(() => openWithStaff(s.p.desk))).status).toBe(403);
    row = (await openWithStaff(s.p.support)).find((r) => r.person === "Maheshwar")!;
    expect([row.given, row.back, row.spent, row.open, row.lines.map((l) => l.kind)]).toEqual(["5000.00", "1000.00", "1500.00", "2500.00", ["given", "back", "spent"]]);
    // the cash box is not touched by "spent": expected = 20,000 − 5,000 + 1,000
    const sheet = await daySheet(s.p.owner, TODAY, TODAY);
    expect(sheet.started && sheet.expected).toBe("16000.00");
    expect((await refused(() => cancelSpend(s.accounts, spent.id, "wrong"))).status).toBe(403);
    await cancelSpend(s.p.owner, spent.id, "entered twice");
    expect((await openWithStaff(s.p.owner)).find((r) => r.person === "Maheshwar")!.open).toBe("4000.00");
  });

  it("your own spending can't be entered by you", async () => {
    const s = await setup({ link: false });
    await s.entry(s.p.owner, { kind: "staff_out", staff_purpose: "plant", person_user_id: s.accounts.userId, amount: "800" });
    const cat = (await cashLists(s.p.owner)).categories[0]!;
    const row = (await openWithStaff(s.p.owner)).find((r) => r.person === "Bindu")!;
    expect((await refused(() => addSpend(s.accounts, { person_key: row.key, spent_on: TODAY, category_id: cat.id, amount: "100" }, TODAY))).message).toMatch(/your own spending/);
  });

  it("another plant sees none of it", async () => {
    const s = await setup({ link: false });
    await s.entry(s.p.owner, { kind: "staff_out", staff_purpose: "plant", person_name: "Maheshwar", amount: "100" });
    const other = plant();
    expect(await openWithStaff(other.owner)).toEqual([]);
  });
});

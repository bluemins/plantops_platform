// Advances from Sales' cash book (src/server/cashbook.ts, docs/CASHBOOK_PHASE_PLAN.md section 9 C4): the key decides the
// plant; an advance needs an active employee with a salary; the same C-number twice is one row; cash brought back is a
// correction of that advance, never more than is left, refused once that month is paid (owner, 2026-11-12); a cancel
// corrects whatever is left; another plant's key can't touch this plant.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/cashbook/v1/advances/route";
import { addDays, istDay, istMonth } from "@/lib/days";
import { hashCashbookKey, receiveCashbook, type CashbookInput } from "@/server/cashbook";
import { saveSetting } from "@/server/salary-edit";
import { resetRateLimits } from "@/server/http";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, contactsFor, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ATTEND_CASHBOOK_KEYS;
  resetRateLimits();
});

const TODAY = istDay();
const THIS = istMonth();
const by = { by_id: randomUUID(), by_name: "Bindu" };

async function setup({ salary = true } = {}) {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.worker, p.keeper)];
  if (salary)
    await saveSetting(p.owner, { user_id: p.worker.userId, monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, ot_rate: null, from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null } as never);
  const key = { id: randomUUID(), tenant_id: p.tenantId, sha256: "0".repeat(64), label: "test" };
  const send = (input: Partial<CashbookInput> & { action: CashbookInput["action"] }) =>
    receiveCashbook(key, { user_id: p.worker.userId, ...by, ...input } as CashbookInput);
  const advance = (ref = "C-0001", amount = "2000") => send({ action: "advance", source_ref: ref, on_date: TODAY, amount });
  const rows = async () => (await asOwner(`select amount_paise, corrects_id, source_ref, note, reason, created_by_name from attendance_salary.salary_advances where tenant_id = $1 order by created_at`, [p.tenantId])).rows;
  return { p, key, send, advance, rows };
}

describe("an advance from the cash book", () => {
  it("is saved once, with the C-number, by '<name> (cash book)'; the same C-number again returns it", async () => {
    const s = await setup();
    const a = await s.advance();
    expect(a.already).toBe(false);
    const again = await s.advance();
    expect(again).toEqual({ id: a.id, already: true });
    const rows = await s.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount_paise: "200000", source_ref: "C-0001", note: "Cash book C-0001", created_by_name: "Bindu (cash book)" });
    const audit = (await asOwner(`select actor, action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'salary.advance'`, [s.p.tenantId])).rows;
    expect(audit.map((r) => [r.actor, r.action, r.details.by])).toEqual([[`cashbook:${by.by_id}`, "salary.advance", "Bindu (cash book)"]]);
  });

  it("is refused without a salary, for someone who isn't an employee, in the future, or before the first salary month", async () => {
    const none = await setup({ salary: false });
    expect(await refusal(() => none.advance())).toMatchObject({ status: 400, message: `Set ${none.p.worker.name}'s salary in Attendance first, then send it again` });
    const s = await setup();
    expect((await refusal(() => s.send({ action: "advance", source_ref: "C-0002", on_date: TODAY, amount: "100", user_id: s.p.keeper.userId }))).status).toBe(400);
    expect((await refusal(() => s.send({ action: "advance", source_ref: "C-0003", on_date: addDays(TODAY, 1), amount: "100" }))).message).toBe("The date is in the future");
    expect((await refusal(() => s.send({ action: "advance", source_ref: "C-0004", on_date: addDays(`${THIS}-01`, -1), amount: "100" }))).message).toMatch(/before .*first salary month/);
    expect(await s.rows()).toEqual([]);
  });
});

describe("cash brought back and cancels", () => {
  it("a return lowers the advance, never more than is left; a check saves nothing", async () => {
    const s = await setup();
    await s.advance("C-0001", "2000");
    expect(await s.send({ action: "return", source_ref: "C-0005", of_ref: "C-0001", amount: "500", check: true })).toEqual({ id: null, already: false });
    await s.send({ action: "return", source_ref: "C-0005", of_ref: "C-0001", amount: "500" });
    expect((await refusal(() => s.send({ action: "return", source_ref: "C-0006", of_ref: "C-0001", amount: "1600" }))).message).toBe("Only ₹1,500 of C-0001 is left to bring back");
    expect((await refusal(() => s.send({ action: "return", source_ref: "C-0007", of_ref: "C-0999", amount: "1" }))).status).toBe(404);
    const rows = await s.rows();
    expect(rows.map((r) => [r.amount_paise, r.source_ref, r.reason])).toEqual([["200000", "C-0001", null], ["-50000", "C-0005", "Cash returned (C-0005)"]]);
  });

  it("a return is refused once the advance's month is paid (owner, 2026-11-12)", async () => {
    const s = await setup();
    await s.advance();
    await asOwner(
      `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
       values ($1, $2, 'Ramu', $3, $4, 100, 100, '{}', gen_random_uuid(), 'Sujata')`,
      [s.p.tenantId, s.p.worker.userId, `${THIS}-01`, TODAY],
    );
    const r = await refusal(() => s.send({ action: "return", source_ref: "C-0005", of_ref: "C-0001", amount: "100" }));
    expect(r.status).toBe(409);
    expect(r.message).toMatch(/already taken from .* salary \(paid\)/);
  });

  it("a cancel corrects what is left (nothing left = nothing saved); sent twice it is one row", async () => {
    const s = await setup();
    await s.advance("C-0001", "2000");
    await s.send({ action: "return", source_ref: "C-0005", of_ref: "C-0001", amount: "500" });
    const c = await s.send({ action: "cancel", source_ref: "C-0001/cancel", of_ref: "C-0001", reason: "Wrong person" });
    expect((await s.send({ action: "cancel", source_ref: "C-0001/cancel", of_ref: "C-0001", reason: "Wrong person" })).already).toBe(true);
    const rows = await s.rows();
    expect(rows.at(-1)).toMatchObject({ amount_paise: "-150000", source_ref: "C-0001/cancel", reason: "Cancelled in the cash book (C-0001): Wrong person" });
    expect(c.id).not.toBeNull();
    expect((await s.send({ action: "cancel", source_ref: "C-0005/cancel", of_ref: "C-0001", reason: "again" })).id).toBeNull();
  });
});

describe("the address", () => {
  const req = (key: string | null, body: unknown) =>
    new Request("http://x/api/cashbook/v1/advances", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  const KEY_A = `atc_${"a".repeat(43)}`;
  const KEY_B = `atc_${"b".repeat(43)}`;

  it("needs a configured key; the plant comes from the key, so plant B's key never writes plant A", async () => {
    const a = await setup();
    const b = plant();
    process.env.ATTEND_CASHBOOK_KEYS = JSON.stringify([
      { id: randomUUID(), tenant_id: a.p.tenantId, sha256: hashCashbookKey(KEY_A), label: "A" },
      { id: randomUUID(), tenant_id: b.tenantId, sha256: hashCashbookKey(KEY_B), label: "B" },
    ]);
    const body = { action: "advance", source_ref: "C-0001", user_id: a.p.worker.userId, ...by, on_date: TODAY, amount: "300" };
    expect((await route.POST(req(null, body), undefined as never)).status).toBe(401);
    expect((await route.POST(req(`atc_${"c".repeat(43)}`, body), undefined as never)).status).toBe(401);
    // plant B's key: A's worker isn't one of B's employees, and nothing lands in A
    expect((await route.POST(req(KEY_B, body), undefined as never)).status).toBe(400);
    expect(await a.rows()).toEqual([]);
    const ok = await route.POST(req(KEY_A, body), undefined as never);
    expect(ok.status).toBe(201);
    expect((await route.POST(req(KEY_A, body), undefined as never)).status).toBe(200); // already saved
    expect(await a.rows()).toHaveLength(1);
  });
});

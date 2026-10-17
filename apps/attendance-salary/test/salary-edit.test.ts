// The owner's salary entries on Staff -> person (src/server/salary-edit.ts): salary settings, "Can see own salary"
// and advances with corrections. Owner only, new rows only, 409 on stale pages, audited. Case numbers follow the
// Phase 3 plan's list.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as advancesRoute from "@/app/api/salary/advances/route";
import * as settingsRoute from "@/app/api/salary/settings/route";
import PersonMonthPage from "@/app/staff/[user]/page";
import { Advances } from "@/app/staff/[user]/advances";
import { SalaryBox, SalaryReadOnly, VisibilityTick } from "@/app/staff/[user]/salary-box";
import { SalaryStrip } from "@/app/staff/[user]/salary-strip";
import { describeChange } from "@/lib/changes";
import { addDays, addMonths, istDay, istMonth } from "@/lib/days";
import { salaryMonths } from "@/server/salary";
import { saveAdvance, saveSetting, saveVisibility, salaryPanel } from "@/server/salary-edit";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, contactsFor, ist, jsonReq, markAt, plant, refusal, signInAs, textOf } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const THIS = istMonth();
const TODAY = istDay();

/** A plant whose people the platform lists: owner, owner + Plant staff, worker Ramu, store keeper. */
function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.ownerWorker, p.worker, p.keeper)];
  const w = p.worker.userId;
  const setting = (by: AtUser, over: Record<string, unknown> = {}) =>
    saveSetting(by, { user_id: w, monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: true, ot_rate: "60", from_month: THIS, joined_on: null, left_on: null, reason: null, expect: null, ...over } as never);
  const advance = (by: AtUser, over: Record<string, unknown> = {}) => saveAdvance(by, { kind: "advance", user_id: w, amount: "2000", on_date: TODAY, note: "Cash", expect: null, ...over } as never);
  const panel = () => salaryPanel(p.owner, w, THIS);
  return { p, w, setting, advance, panel };
}

const rows = async (table: string, tenantId: string) =>
  (await asOwner(`select * from attendance_salary.${table} where tenant_id = $1 order by ${table === "audit_log" ? "id" : "created_at"}`, [tenantId])).rows;

describe("who may save", () => {
  it("1. the owner and an owner who is also Plant staff may; Plant staff, a store keeper and support may not", async () => {
    const { p, w, setting, advance } = setup();
    await setting(p.owner);
    let ex = (await salaryPanel(p.owner, w, THIS)).expect;
    await setting(p.ownerWorker, { monthly: "12500", expect: ex.setting });
    ex = (await salaryPanel(p.owner, w, THIS)).expect;
    await advance(p.ownerWorker, { expect: ex.advance });
    expect((await saveVisibility(p.owner, { user_id: w, can_see: true, expect: null })).changed).toBe(true);

    ex = (await salaryPanel(p.owner, w, THIS)).expect;
    for (const [who, status, message] of [
      [p.worker, 403, "Only the plant owner can do this"],
      [p.keeper, 403, "You don't have access to Attendance"],
      [p.support, 403, "PlantOps support view is read-only"],
    ] as const) {
      expect(await refusal(() => setting(who, { expect: ex.setting })), who.name).toMatchObject({ status, message });
      expect(await refusal(() => advance(who, { expect: ex.advance })), who.name).toMatchObject({ status, message });
      expect(await refusal(() => saveVisibility(who, { user_id: w, can_see: false, expect: ex.visibility })), who.name).toMatchObject({ status, message });
    }
  });

  it("2. a person who isn't one of the plant's people: 404", async () => {
    const { p, setting } = setup();
    expect((await refusal(() => setting(p.owner, { user_id: crypto.randomUUID() }))).status).toBe(404);
  });
});

describe("salary setting", () => {
  it("3. rupees typed: 12000.50 is 1200050 paise; commas, 0, minus, 3 decimals and over ₹1 crore are refused", async () => {
    const { p, setting } = setup();
    await setting(p.owner, { monthly: "12000.50" });
    expect((await rows("salary_settings", p.tenantId))[0]).toMatchObject({ monthly_paise: "1200050" });
    for (const bad of ["12,000", "0", "-5", "1.234", "10000000.01", ""]) {
      expect((await refusal(() => setting(p.owner, { monthly: bad }))).status, bad).toBe(400);
    }
  });

  it("4. shift 1-16 h in half hours, paid leave 0-10 days in half days", async () => {
    const { p, setting, panel } = setup();
    await setting(p.owner, { shift_hours: 8.5, leave_days: 2.5 });
    expect((await rows("salary_settings", p.tenantId))[0]).toMatchObject({ shift_minutes: 510, paid_leave_halfdays: 5 });
    const ex = (await panel()).expect.setting;
    for (const shift of [8.25, 0.5, 16.5]) expect((await refusal(() => setting(p.owner, { shift_hours: shift, expect: ex }))).status, String(shift)).toBe(400);
    for (const leave of [10.5, -1, 1.25]) expect((await refusal(() => setting(p.owner, { leave_days: leave, expect: ex }))).status, String(leave)).toBe(400);
  });

  it("5. the overtime rate is required only when Gets overtime is ticked", async () => {
    const { p, setting, panel } = setup();
    expect((await refusal(() => setting(p.owner, { ot_rate: null }))).message).toMatch(/Overtime rate/);
    expect((await refusal(() => setting(p.owner, { ot_rate: "100001" }))).status).toBe(400);
    await setting(p.owner);
    await setting(p.owner, { gets_overtime: false, ot_rate: "60", expect: (await panel()).expect.setting });
    expect((await rows("salary_settings", p.tenantId)).map((r) => [r.gets_overtime, r.ot_rate_paise])).toEqual([
      [true, 6000],
      [false, null],
    ]);
  });

  it("6. a from month in the past needs a reason; the last day can't be before the joining day", async () => {
    const { p, setting, panel } = setup();
    const last = addMonths(THIS, -1);
    expect((await refusal(() => setting(p.owner, { from_month: last }))).message).toBe("From month is in the past: write a reason (it changes figures already worked out)");
    expect((await refusal(() => setting(p.owner, { from_month: last, reason: " ab " }))).status).toBe(400);
    await setting(p.owner, { from_month: last, reason: "agreed last month" });
    await setting(p.owner, { from_month: addMonths(THIS, 1), expect: (await panel()).expect.setting });
    const ex = (await panel()).expect.setting;
    expect((await refusal(() => setting(p.owner, { joined_on: `${THIS}-15`, left_on: `${THIS}-14`, expect: ex }))).message).toBe("The last day can't be before the joining day");
  });

  it("the route answers 400 for bad input and 201 for a good one", async () => {
    const { p, w } = setup();
    signInAs(p.owner);
    const post = (body: Record<string, unknown>) =>
      settingsRoute.POST(jsonReq("POST", "/api/salary/settings", { user_id: w, monthly: "12000", shift_hours: 8, leave_days: 2, gets_overtime: false, from_month: THIS, expect: null, ...body }), undefined as never);
    expect((await post({ from_month: "2026-13" })).status).toBe(400);
    expect((await post({ shift_hours: "8" })).status).toBe(400);
    expect((await post({ joined_on: "2026-02-30" })).status).toBe(400);
    expect((await post({})).status).toBe(201);
  });
});

describe("advances", () => {
  it("7. no salary set, a future date, a date before the first salary month and a long note are refused", async () => {
    const { p, setting, advance, panel } = setup();
    expect((await refusal(() => advance(p.owner))).message).toBe("Set a salary for Ramu first");
    await setting(p.owner);
    expect((await refusal(() => advance(p.owner, { on_date: addDays(TODAY, 1) }))).message).toBe("The date is in the future");
    expect((await refusal(() => advance(p.owner, { on_date: addDays(`${THIS}-01`, -1) }))).message).toBe("The date is before Ramu's first salary month");
    signInAs(p.owner);
    const post = (body: Record<string, unknown>) => advancesRoute.POST(jsonReq("POST", "/api/salary/advances", { kind: "advance", user_id: p.worker.userId, amount: "100", on_date: TODAY, expect: null, ...body }), undefined as never);
    expect((await post({ note: "x".repeat(201) })).status).toBe(400);
    expect((await post({ amount: "0" })).status).toBe(400);
    expect((await post({ kind: "correction", corrects_id: crypto.randomUUID(), amount: "1", reason: " ok " })).status).toBe(400); // reason under 3 characters
    await advance(p.owner, { amount: "2000.50" });
    const panelNow = await panel();
    expect(panelNow.advances.map((a) => [a.onDate, a.amountPaise, a.note, a.leftPaise])).toEqual([[TODAY, 200050, "Cash", 200050]]);
  });

  it("8. corrections: at most what is left, never of a correction or another person's entry, on the entry's own date", async () => {
    const { p, w, setting, advance, panel } = setup();
    await setting(p.owner);
    const first = `${THIS}-01`;
    const { id } = await advance(p.owner, { amount: "1500", on_date: first });
    const fix = async (amount: string, correctsId = id, reason = "typed twice") =>
      saveAdvance(p.owner, { kind: "correction", user_id: w, corrects_id: correctsId, amount, reason, expect: (await panel()).expect.advance });

    expect((await refusal(() => fix("1500.01"))).message).toBe("Only ₹1,500 is left of this entry");
    const c = await fix("500");
    expect(c.onDate).toBe(first);
    expect((await refusal(() => fix("1000.01"))).message).toBe("Only ₹1,000 is left of this entry");
    await fix("1000");
    expect((await refusal(() => fix("1"))).message).toBe("Nothing is left of this entry");
    expect((await refusal(() => fix("1", c.id))).message).toBe("Only an advance can be corrected, not a correction");
    expect((await refusal(() => fix("1", crypto.randomUUID()))).status).toBe(404);

    // another person's entry: refused as "not found", even in the same plant
    await setting(p.owner, { user_id: p.ownerWorker.userId });
    const other = await saveAdvance(p.owner, { kind: "advance", user_id: p.ownerWorker.userId, amount: "300", on_date: first, note: null, expect: null });
    expect((await refusal(() => fix("1", other.id))).status).toBe(404);

    const list = (await panel()).advances;
    expect(list.map((a) => a.amountPaise)).toEqual([150000, -50000, -100000]);
    expect(list.every((a) => a.onDate === first)).toBe(true);
    expect(list[0]!.leftPaise).toBe(0);
  });
});

describe("stale pages and history", () => {
  it("9. a page that missed a save gets 409, for settings, visibility and advances; the same tick again adds nothing", async () => {
    const { p, w, setting, advance, panel } = setup();
    const stale = (await panel()).expect; // all null
    await setting(p.owner);
    expect(await refusal(() => setting(p.ownerWorker, { expect: stale.setting }))).toEqual({ status: 409, message: "Just changed by Sujata. The page has been refreshed: check it and try again." });
    await advance(p.owner);
    expect((await refusal(() => advance(p.owner, { expect: stale.advance }))).status).toBe(409);
    await saveVisibility(p.owner, { user_id: w, can_see: true, expect: null });
    expect((await refusal(() => saveVisibility(p.owner, { user_id: w, can_see: false, expect: stale.visibility }))).status).toBe(409);
    const now = (await panel()).expect.visibility;
    expect(await saveVisibility(p.owner, { user_id: w, can_see: true, expect: now })).toEqual({ id: now, changed: false });
    expect(await rows("salary_visibility", p.tenantId)).toHaveLength(1);
    expect((await panel()).canSee).toBe(true);
  });

  it("10. a second save adds a row and keeps the first; the salary works with the new one from its month", async () => {
    const { p, w, setting, panel } = setup();
    await setting(p.owner);
    const before = await rows("salary_settings", p.tenantId);
    await setting(p.owner, { monthly: "13000", from_month: addMonths(THIS, 1), expect: (await panel()).expect.setting });
    const after = await rows("salary_settings", p.tenantId);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect((await panel()).history.map((h) => h.monthlyPaise)).toEqual([1300000, 1200000]);
    expect((await salaryMonths(p.owner, THIS, { personId: w })).people[0]!.current!.setting.monthlyPaise).toBe(1200000);
  });
});

describe("audit and Recent changes", () => {
  it("11. one audit row per save, in plain words, with the person's name from the server", async () => {
    const { p, w, setting, advance, panel } = setup();
    await setting(p.owner, { reason: "agreed" });
    const { id } = await advance(p.owner, { amount: "2000", on_date: `${THIS}-01` });
    await saveAdvance(p.owner, { kind: "correction", user_id: w, corrects_id: id, amount: "500", reason: "typed twice", expect: (await panel()).expect.advance });
    await saveVisibility(p.owner, { user_id: w, can_see: true, expect: null });
    await saveVisibility(p.owner, { user_id: w, can_see: false, expect: (await panel()).expect.visibility });
    const audit = await rows("audit_log", p.tenantId);
    const texts = audit.map((r) => describeChange(r.action as string, r.details as Record<string, unknown>));
    const mon = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${THIS}-01T00:00:00Z`));
    const day1 = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${THIS}-01T00:00:00Z`));
    expect(texts).toEqual([
      `Salary for Ramu from ${mon}: ₹12,000 · 8 h · overtime ₹60/h: agreed`,
      `Advance ₹2,000 to Ramu on ${day1}: Cash`,
      `Advance corrected −₹500 (Ramu, ${day1}): typed twice`,
      "Ramu can now see own salary (paid months)",
      "Ramu can no longer see own salary",
    ]);
    expect(audit.every((r) => (r.details as { by: string }).by === "Sujata")).toBe(true);
  });

  it("the setting text adds leave, joined and last day only when they are set", () => {
    expect(describeChange("salary.set", { person: "Ramu", from: "2026-11", monthly: 1100000, shift: 540, leave: 3, ot_rate: null, joined: "2026-11-15", left: null })).toBe(
      "Salary for Ramu from Nov 2026: ₹11,000 · 9 h · no overtime · leave 1.5 days · joined 15 Nov",
    );
  });
});

describe("the person page", () => {
  /** Every component used in a page's element tree (client and nested server components are not rendered). */
  const types = (node: unknown, out = new Set<unknown>()): Set<unknown> => {
    if (Array.isArray(node)) node.forEach((n) => types(n, out));
    else if (node && typeof node === "object" && "props" in node) {
      out.add((node as unknown as { type: unknown }).type);
      types((node as { props: { children?: unknown } }).props.children, out);
    }
    return out;
  };

  it("12. the owner gets the salary forms; support the same figures read-only; the strip shows the worked example", async () => {
    const { p, w, setting } = setup();
    await setting(p.owner);
    await markAt(p.worker, "in", `${TODAY} 06:00`);
    const open = async (u: AtUser) => {
      signInAs(u);
      return types(await PersonMonthPage({ params: Promise.resolve({ user: w }), searchParams: Promise.resolve({}) }));
    };
    const owner = await open(p.owner);
    for (const c of [SalaryStrip, SalaryBox, VisibilityTick, Advances]) expect(owner.has(c)).toBe(true);
    expect(owner.has(SalaryReadOnly)).toBe(false);
    vi.restoreAllMocks();
    const support = await open(p.support);
    expect(support.has(SalaryReadOnly) && support.has(SalaryStrip)).toBe(true);
    expect(support.has(SalaryBox) || support.has(VisibilityTick)).toBe(false);

    // the strip with the plan's worked example (October 2026, seen on 5 Nov)
    const q = plant();
    await asOwner(
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, created_by, created_by_name)
       values ($1, $2, 'Ramu', '2026-10-01', 1200000, 480, 4, true, 6000, gen_random_uuid(), 'Sujata')`,
      [q.tenantId, q.worker.userId],
    );
    for (let d = 1; d <= 28; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const hours = d <= 14 ? 9 : d <= 26 ? 8 : 5;
      await markAt(q.worker, "in", `${date} 08:00`);
      await markAt(q.worker, "out", `${date} ${String(8 + hours).padStart(2, "0")}:00`);
    }
    await asOwner(`insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ($1, $2, 'Ramu', '2026-10-10', 300000, gen_random_uuid(), 'Sujata')`, [q.tenantId, q.worker.userId]);
    const figures = (await salaryMonths(q.owner, "2026-10", { now: ist("2026-11-05 12:00") })).people[0]!.current;
    expect(textOf(SalaryStrip({ month: "2026-10", figures }))).toMatch(/Present 26 .*Half days 2 .*Absent 3 .*Paid leave used 2 of 2 .*Overtime 14 h .*Remaining to pay ₹9,040/);
    expect(textOf(SalaryStrip({ month: "2026-10", figures: null }))).toMatch(/^No salary set for\s+October 2026/);
  });
});

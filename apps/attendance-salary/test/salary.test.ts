// Salary worked out from the database (src/server/salary.ts): real marks, settings history, advances and paid months
// in the test database, then the rules of src/lib/salary.ts. Case numbers follow the Phase 2 plan's list.
import { describe, expect, it } from "vitest";
import { freezeMonth, salaryMonths } from "@/server/salary";
import { mySlip } from "@/server/salary-slip";
import type { AtUser } from "@/server/session";
import { asApp, ist, markAt, plant, refusal } from "./helpers";

const NOW = ist("2026-11-05 12:00"); // October is over, November is open
const R = (rupees: number) => Math.round(rupees * 100);

async function setting(u: AtUser, fromMonth: string, rupees: number, over: { shift?: number; leave?: number; otRate?: number; joined?: string; left?: string } = {}) {
  const ot = over.otRate !== undefined;
  await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, ot_rate_paise, joined_on, left_on, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', ${R(rupees)}, ${over.shift ?? 480}, ${over.leave ?? 4}, ${ot}, ${ot ? R(over.otRate!) : "null"},
             ${over.joined ? `'${over.joined}'` : "null"}, ${over.left ? `'${over.left}'` : "null"}, gen_random_uuid(), 'Sujata')`,
  );
}

async function advance(u: AtUser, onDate: string, rupees: number, corrects?: string) {
  const res = await asApp(
    u.tenantId,
    corrects
      ? `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, corrects_id, reason, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${onDate}', ${R(rupees)}, '${corrects}', 'typed twice', gen_random_uuid(), 'Sujata') returning id`
      : `insert into attendance_salary.salary_advances (tenant_id, user_id, user_name, on_date, amount_paise, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${onDate}', ${R(rupees)}, gen_random_uuid(), 'Sujata') returning id`,
  );
  return (res.rows[0] as { id: string }).id;
}

async function payment(u: AtUser, month: string, remainingRupees: number) {
  const rem = R(remainingRupees);
  const res = await asApp(
    u.tenantId,
    `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
     values ('${u.tenantId}', '${u.userId}', '${u.name}', '${month}-01', '${month}-28', ${Math.max(0, rem)}, ${rem}, '{"rules": 1}', gen_random_uuid(), 'Sujata') returning id`,
  );
  return (res.rows[0] as { id: string }).id;
}

const undo = (u: AtUser, paymentId: string) =>
  asApp(u.tenantId, `insert into attendance_salary.salary_payment_undos (tenant_id, payment_id, reason, created_by, created_by_name) values ('${u.tenantId}', '${paymentId}', 'wrong month', gen_random_uuid(), 'Sujata')`);

/** One worked day: IN at 09:00, OUT after `hours`. */
async function workDay(u: AtUser, date: string, hours: number) {
  await markAt(u, "in", `${date} 09:00`);
  const end = 9 * 60 + hours * 60;
  await markAt(u, "out", `${date} ${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`);
}

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

describe("salary from the database", () => {
  it("20. the worked example from real marks: ₹9,040", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000, { otRate: 60 });
    for (let d = 1; d <= 14; d++) await workDay(w, day(d), 9); // present, +1 h overtime each = 14 h
    for (let d = 15; d <= 26; d++) await workDay(w, day(d), 8); // present
    for (const d of [27, 28]) await workDay(w, day(d), 5); // half days
    // 29-31: absent
    await advance(w, "2026-10-10", 3000);

    const view = await salaryMonths(p.owner, "2026-10", { now: NOW });
    expect(view.people.map((x) => x.name)).toEqual(["Ramu"]);
    const oct = view.people[0]!.current!;
    expect(oct.counted).toMatchObject({ fullMonth: true, complete: true });
    expect(oct.counts).toEqual({ present: 26, half: 2, absent: 3, otMinutes: 14 * 60 });
    expect(oct.chain.live).toMatchObject({ earnedPaise: R(11200), otPayPaise: R(840), advancesPaise: R(3000), remainingPaise: R(9040) });
  });

  it("21. the settings history: October, November, and a re-save of October", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000);
    await setting(w, "2026-11", 13000);
    await setting(w, "2026-10", 12500); // saved later, still from October
    const { people } = await salaryMonths(p.owner, "2026-11", { personId: w.userId, now: NOW });
    expect(people[0]!.months.map((m) => [m.month, m.setting.monthlyPaise])).toEqual([["2026-10", R(12500)], ["2026-11", R(13000)]]);
    // September: not on salary yet
    expect((await salaryMonths(p.owner, "2026-09", { now: NOW })).people).toEqual([]);
  });

  it("22. advances count in the month of their India date; a correction reduces its month", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000);
    const oct = await advance(w, "2026-10-31", 1000);
    await advance(w, "2026-11-01", 500);
    await advance(w, "2026-10-31", -200, oct);
    const { people } = await salaryMonths(p.owner, "2026-11", { personId: w.userId, now: NOW });
    const [o, n] = people[0]!.months;
    expect(o!.chain.live.advancesPaise).toBe(R(800));
    expect(o!.advances).toHaveLength(2);
    expect(n!.chain.live.advancesPaise).toBe(R(500));
  });

  it("23. a night shift 31 Oct 22:00 → 1 Nov 06:00 counts in October", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000);
    await markAt(w, "in", "2026-10-31 22:00");
    await markAt(w, "out", "2026-11-01 06:00");
    const { people } = await salaryMonths(p.owner, "2026-11", { personId: w.userId, now: NOW });
    const [o, n] = people[0]!.months;
    expect(o!.days.at(-1)).toMatchObject({ date: "2026-10-31", minutes: 480, status: "present" });
    expect(n!.days[0]).toMatchObject({ date: "2026-11-01", minutes: 0, status: "absent" });
    expect(n!.counted.dates).toHaveLength(4); // 1-4 November so far
  });

  it("24. the whole plant: only people with a salary setting; an undone payment is ignored", async () => {
    const p = plant();
    await setting(p.worker, "2026-10", 12000);
    await workDay(p.ownerWorker, "2026-10-05", 8); // marks, but no salary setting
    const undone = await payment(p.worker, "2026-10", 1000);
    await undo(p.worker, undone);
    let view = await salaryMonths(p.owner, "2026-10", { now: NOW });
    expect(view.people.map((x) => x.userId)).toEqual([p.worker.userId]);
    expect(view.people[0]!.current!.payment).toBeNull();

    const kept = await payment(p.worker, "2026-10", 900);
    view = await salaryMonths(p.owner, "2026-10", { now: NOW });
    expect(view.people[0]!.current!.payment).toMatchObject({ paymentId: kept, paidPaise: R(900), remainingPaise: R(900) });
  });

  it("25. isolation: the same person id in another plant has its own rows, never mixed in", async () => {
    const a = plant();
    const b = plant();
    const inB: AtUser = { ...a.worker, tenantId: b.tenantId };
    await setting(a.worker, "2026-10", 12000);
    await setting(inB, "2026-10", 99000);
    await advance(inB, "2026-10-05", 5000);
    const va = await salaryMonths(a.owner, "2026-10", { now: NOW });
    expect(va.people).toHaveLength(1);
    expect(va.people[0]!.current!.setting.monthlyPaise).toBe(R(12000));
    expect(va.people[0]!.current!.advances).toEqual([]);
    const vb = await salaryMonths(b.owner, "2026-10", { now: NOW });
    expect(vb.people[0]!.current!.setting.monthlyPaise).toBe(R(99000));
  });

  it("26. owner and support may look; Plant staff and a store keeper are refused; a future or bad month is 404", async () => {
    const p = plant();
    await setting(p.worker, "2026-10", 12000);
    expect((await salaryMonths(p.support, "2026-10", { now: NOW })).people).toHaveLength(1);
    expect((await salaryMonths(p.ownerWorker, "2026-10", { now: NOW })).people).toHaveLength(1);
    expect((await refusal(() => salaryMonths(p.worker, "2026-10", { now: NOW }))).status).toBe(403);
    expect((await refusal(() => salaryMonths(p.keeper, "2026-10", { now: NOW }))).status).toBe(403);
    for (const m of ["2026-12", "2026-13", "junk"]) expect((await refusal(() => salaryMonths(p.owner, m, { now: NOW }))).status, m).toBe(404);
  });
});

describe("per-day pay from the database (Salary extras rule 15)", () => {
  const perDay = (u: AtUser, fromMonth: string, rupees: number) =>
    asApp(
      u.tenantId,
      `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, pay_basis, monthly_paise, day_rate_paise, shift_minutes, paid_leave_halfdays, gets_overtime, created_by, created_by_name)
       values ('${u.tenantId}', '${u.userId}', '${u.name}', '${fromMonth}-01', 'per_day', null, ${R(rupees)}, 480, 0, false, gen_random_uuid(), 'Sujata')`,
    );

  it("27. monthly in October, per day from November: October unchanged, November pays the day rate × days", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000, { leave: 0 });
    await perDay(w, "2026-11", 450);
    for (let d = 1; d <= 31; d++) await workDay(w, day(d), 8); // October: all present
    for (let d = 1; d <= 20; d++) await workDay(w, `2026-11-${String(d).padStart(2, "0")}`, 8); // November: 20 present
    for (const d of [21, 22]) await workDay(w, `2026-11-${d}`, 5); // 2 half days, the rest absent
    const { people } = await salaryMonths(p.owner, "2026-11", { personId: w.userId, now: ist("2026-12-05 12:00") });
    const [oct, nov] = people[0]!.months;
    expect(oct!.setting).toMatchObject({ payBasis: "monthly", monthlyPaise: R(12000), dayRatePaise: null });
    expect(oct!.chain.live).toMatchObject({ earnedPaise: R(12000), remainingPaise: R(12000) });
    expect(nov!.setting).toMatchObject({ payBasis: "per_day", monthlyPaise: null, dayRatePaise: R(450) });
    expect(nov!.counts).toMatchObject({ present: 20, half: 2, absent: 8 });
    expect(nov!.chain.live).toMatchObject({ dayPayPaise: R(450), leaveUsedHalves: 0, earnedPaise: R(21 * 450), remainingPaise: R(9450) });
    // a per-day month frozen now carries the rules version and the pay basis
    const f = freezeMonth(nov!);
    expect(f).toMatchObject({ rules: 2, setting: { payBasis: "per_day", monthlyPaise: null, dayRatePaise: R(450) }, input: { payBasis: "per_day", monthlyPaise: 0, dayRatePaise: R(450) } });
  });

  it("28. a slip frozen before per-day pay (rules 1) still opens, as monthly", async () => {
    const p = plant();
    const w = p.worker;
    await setting(w, "2026-10", 12000);
    await asApp(p.tenantId, `insert into attendance_salary.salary_visibility (tenant_id, user_id, user_name, can_see, created_by, created_by_name) values ('${p.tenantId}', '${w.userId}', '${w.name}', true, gen_random_uuid(), 'Sujata')`);
    const v1 = {
      rules: 1,
      month: "2026-10",
      setting: { monthlyPaise: R(12000), shiftMinutes: 480, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, joinedOn: null, leftOn: null },
      counted: { dates: [], monthLength: 31, fullMonth: true, complete: true },
      counts: { present: 31, half: 0, absent: 0, otMinutes: 0 },
      advances: [],
      adjustmentFrom: null,
      input: { present: 31, half: 0, absent: 0, otMinutes: 0, monthlyPaise: R(12000), fullMonth: true, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, advancesPaise: 0, carriedInPaise: 0, adjustmentPaise: 0 },
      result: { remainingPaise: R(12000), earnedPaise: R(12000) },
    };
    await asApp(
      p.tenantId,
      `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
       values ('${p.tenantId}', '${w.userId}', '${w.name}', '2026-10-01', '2026-10-31', ${R(12000)}, ${R(12000)}, '${JSON.stringify(v1)}', gen_random_uuid(), 'Sujata')`,
    );
    const slip = await mySlip(w, "2026-10");
    expect(slip.figures).toMatchObject({ rules: 1, setting: { payBasis: "monthly", dayRatePaise: null, monthlyPaise: R(12000) }, input: { payBasis: "monthly", dayRatePaise: null } });
    expect(slip.figures.result.remainingPaise).toBe(R(12000));
  });
});

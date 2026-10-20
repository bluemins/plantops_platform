// Day marks (v0.26.0, docs/DAY_MARKS_PLAN.md): the owner marks one person's whole day ON (present) or OFF (a paid day
// off), or Clear; no times. Rule 20 in src/lib/salary.ts; saving in src/server/day-marks.ts. October 2026 has four
// Sundays (4, 11, 18, 25); it is worked out as seen on 5 November unless a test says otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeChange } from "@/lib/changes";
import { dayStatuses, monthPay, type PayInput } from "@/lib/salary";
import { DayMarksInput, setDayMark, setDayMarks } from "@/server/day-marks";
import { monthStatuses } from "@/server/salary";
import { salaryTab } from "@/server/salary-tab";
import { todayBoard } from "@/server/today";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, markAt, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const NOW = ist("2026-11-05 12:00");
const R = (rupees: number) => Math.round(rupees * 100);
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const SUNDAYS = [4, 11, 18, 25];

const base: PayInput = {
  present: 0, half: 0, absent: 0, off: 0, otMinutes: 0,
  payBasis: "monthly", monthlyPaise: R(9000), dayRatePaise: null, fullMonth: true, paidLeaveHalfdays: 4,
  getsOvertime: false, otRatePaise: null, advancesPaise: 0, taPaise: 0, daPaise: 0, expensesPaise: 0, carriedInPaise: 0, adjustmentPaise: 0,
};

describe("rule 20: what a day mark does", () => {
  it("ON = present whatever the marks say; OFF = a day off; overtime only from real times", () => {
    const worked = new Map([
      [day(5), { minutes: 600 }], // 10 h worked, marked OFF: still a day off, the 2 h overtime stays
      [day(6), { minutes: 120 }], // 2 h only, marked ON: present, no overtime
    ]);
    const marks = new Map([[day(5), "off" as const], [day(6), "on" as const], [day(7), "on" as const], [day(8), "off" as const]]);
    const r = dayStatuses(worked, 480, [day(5), day(6), day(7), day(8), day(9)], true, marks);
    expect(r.map((d) => [d.date, d.status, d.otMinutes])).toEqual([
      [day(5), "off", 120],
      [day(6), "present", 0],
      [day(7), "present", 0], // nothing marked at all, owner said ON
      [day(8), "off", 0],
      [day(9), "absent", 0], // no mark from the owner: as before
    ]);
  });

  it("monthly, full month: 4 Sundays OFF = no cut, and the 2 paid leave days stay free", () => {
    // without the marks: 27 present, 4 absent, 2 covered by leave, 2 cut at ₹300
    expect(monthPay({ ...base, present: 27, absent: 4 }).earnedPaise).toBe(R(8400));
    const marked = monthPay({ ...base, present: 27, off: 4 });
    expect(marked).toMatchObject({ earnedPaise: R(9000), leaveUsedHalves: 0, unpaidHalves: 0 });
    // a real absence on top is still covered by the leave
    expect(monthPay({ ...base, present: 26, off: 4, absent: 1 })).toMatchObject({ earnedPaise: R(9000), leaveUsedHalves: 2 });
  });

  it("per day: an OFF day is paid at the day rate (owner, 2026-10-19)", () => {
    expect(monthPay({ ...base, payBasis: "per_day", monthlyPaise: 0, dayRatePaise: R(450), paidLeaveHalfdays: 0, present: 27, off: 4 }).earnedPaise).toBe(R(31 * 450));
  });

  it("part month: OFF days are paid like present days", () => {
    // joined 15 Oct: 17 days = 13 present + 2 off + 2 absent (both covered by leave) = 17 days at ₹300
    expect(monthPay({ ...base, fullMonth: false, present: 13, off: 2, absent: 2 }).earnedPaise).toBe(R(17 * 300));
  });

  it("figures frozen before v0.26.0 have no `off`: read as 0", () => {
    const { off: _off, ...old } = base;
    expect(monthPay({ ...old, present: 30, absent: 1 } as PayInput).earnedPaise).toBe(R(9000));
  });
});

/** A plant with one Plant staff worker on ₹9,000 (8 h shift) and the platform's people list. */
async function plantWithWorker() {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff"], "Ramesh");
  const supervisor = atUser(p.tenantId, ["supervisor"], "Mohan");
  platform.contacts = [...contactsFor(p.owner, p.worker, office, supervisor)];
  await asApp(
    p.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, gets_overtime, created_by, created_by_name)
     values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '2026-10-01', ${R(9000)}, 480, false, gen_random_uuid(), 'Sujata')`,
  );
  return { ...p, office, supervisor };
}
const mark = (u: AtUser, who: AtUser, d: string, m: "on" | "off" | "clear", now = NOW) => setDayMark(u, { user_id: who.userId, day: d, mark: m }, now);
const rowOf = async (owner: AtUser) => (await salaryTab(owner, "2026-10", NOW)).rows[0]!;

describe("the owner marks a day", () => {
  it("only the owner; Office staff, Supervisor, the worker and PlantOps support are refused", async () => {
    const p = await plantWithWorker();
    for (const u of [p.office, p.supervisor, p.worker, p.support]) {
      expect((await refusal(() => mark(u, p.worker, day(4), "off"))).status, u.name).toBeGreaterThanOrEqual(403);
    }
    expect((await asOwner(`select count(*)::int as n from attendance_salary.day_marks where tenant_id = $1`, [p.tenantId])).rows[0]).toEqual({ n: 0 });
    expect(await mark(p.owner, p.worker, day(4), "off")).toEqual({ day: day(4), mark: "off", changed: true });
  });

  it("today or earlier only; the same mark again saves nothing; Clear goes back", async () => {
    const p = await plantWithWorker();
    const now = ist("2026-10-20 09:00");
    expect(await refusal(() => mark(p.owner, p.worker, "2026-10-21", "off", now))).toMatchObject({ status: 400 });
    expect(await mark(p.owner, p.worker, "2026-10-20", "off", now)).toMatchObject({ changed: true });
    expect(await mark(p.owner, p.worker, "2026-10-20", "off", now)).toMatchObject({ changed: false, mark: "off" });
    expect(await mark(p.owner, p.worker, "2026-10-20", "clear", now)).toEqual({ day: "2026-10-20", mark: null, changed: true });
    expect(await mark(p.owner, p.worker, "2026-10-20", "clear", now)).toMatchObject({ changed: false });
    // every change is a row (append-only); Recent changes says it in words
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>(`select action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'day.mark' order by id`, [p.tenantId]);
    expect(rows.map((r) => describeChange(r.action, r.details))).toEqual([
      "Marked Tue, 20 Oct OFF (paid day off) for Ramu",
      "Cleared the day mark on Tue, 20 Oct for Ramu (back to the IN / OUT marks)",
    ]);
  });

  it("Mark days: several days in one save, one row and one Recent changes line each, the same mark skipped", async () => {
    const p = await plantWithWorker();
    await mark(p.owner, p.worker, day(11), "off");
    const r = await setDayMarks(p.owner, { user_id: p.worker.userId, days: [day(18), day(4), day(11), day(4)], mark: "off" }, NOW);
    expect(r).toEqual({
      changed: 2,
      days: [
        { day: day(4), mark: "off", changed: true },
        { day: day(11), mark: "off", changed: false },
        { day: day(18), mark: "off", changed: true },
      ],
    });
    expect((await rowOf(p.owner)).counts).toMatchObject({ off: 3 });
    const { rows } = await asOwner<{ details: { day: string } }>(`select details from attendance_salary.audit_log where tenant_id = $1 and action = 'day.mark' order by id`, [p.tenantId]);
    expect(rows.map((x) => x.details.day)).toEqual([day(11), day(4), day(18)]);
    // Clear on all three goes back to the IN / OUT marks
    expect((await setDayMarks(p.owner, { user_id: p.worker.userId, days: [day(4), day(11), day(18)], mark: "clear" }, NOW)).changed).toBe(3);
    expect((await rowOf(p.owner)).counts).toMatchObject({ off: 0 });
  });

  it("Mark days: all or nothing; owner only; at most 31 days", async () => {
    const p = await plantWithWorker();
    const now = ist("2026-10-20 09:00");
    // one future day refuses the whole save
    expect(await refusal(() => setDayMarks(p.owner, { user_id: p.worker.userId, days: ["2026-10-19", "2026-10-21"], mark: "off" }, now))).toMatchObject({ status: 400 });
    for (const u of [p.office, p.supervisor, p.worker, p.support]) {
      expect((await refusal(() => setDayMarks(u, { user_id: p.worker.userId, days: [day(4)], mark: "on" }, now))).status, u.name).toBeGreaterThanOrEqual(403);
    }
    expect((await asOwner(`select count(*)::int as n from attendance_salary.day_marks where tenant_id = $1`, [p.tenantId])).rows[0]).toEqual({ n: 0 });
    expect(DayMarksInput.safeParse({ user_id: p.worker.userId, days: Array.from({ length: 32 }, () => day(1)), mark: "on" }).success).toBe(false);
    expect(DayMarksInput.safeParse({ user_id: p.worker.userId, days: [], mark: "on" }).success).toBe(false);
  });

  it("someone the plant doesn't know: 404", async () => {
    const p = await plantWithWorker();
    const stranger = atUser(p.tenantId, ["plant_staff"], "Nobody");
    expect((await refusal(() => mark(p.owner, stranger, day(4), "off"))).status).toBe(404);
  });
});

describe("in the salary, the calendar and the Today board", () => {
  it("Sundays OFF and a forgotten day ON: full salary, counts on the Salary tab", async () => {
    const p = await plantWithWorker();
    // works 08:00-16:00 every day except the Sundays, and forgets to mark on 7 Oct
    for (let d = 1; d <= 31; d++) {
      if (SUNDAYS.includes(d) || d === 7) continue;
      await markAt(p.worker, "in", `${day(d)} 08:00`);
      await markAt(p.worker, "out", `${day(d)} 16:00`);
    }
    expect((await rowOf(p.owner)).counts).toMatchObject({ present: 26, absent: 5, off: 0 });
    expect((await rowOf(p.owner)).result.earnedPaise).toBe(R(8100)); // 5 absent - 2 leave = 3 days cut
    for (const d of SUNDAYS) await mark(p.owner, p.worker, day(d), "off");
    await mark(p.owner, p.worker, day(7), "on");
    const row = await rowOf(p.owner);
    expect(row.counts).toMatchObject({ present: 27, absent: 0, off: 4 });
    expect(row.result).toMatchObject({ earnedPaise: R(9000), leaveUsedHalves: 0 });
  });

  it("the calendar gets the day's mark; Clear takes it away", async () => {
    const p = await plantWithWorker();
    await mark(p.owner, p.worker, day(4), "off");
    await mark(p.owner, p.worker, day(5), "on");
    await mark(p.owner, p.worker, day(6), "off");
    await mark(p.owner, p.worker, day(6), "clear");
    const s = (await monthStatuses(p.owner, p.worker.userId, "2026-10", new Map(), NOW))!;
    expect(s.days[day(4)]).toEqual({ status: "off", otMinutes: 0, mark: "off" });
    expect(s.days[day(5)]).toEqual({ status: "present", otMinutes: 0, mark: "on" });
    expect(s.days[day(6)]).toEqual({ status: "absent", otMinutes: 0 });
    expect(s.counts).toMatchObject({ off: 1, present: 1 });
  });

  it("Today board: someone marked OFF today is a day off, not 'not marked' (so the morning alert leaves them out)", async () => {
    const p = await plantWithWorker();
    const other = atUser(p.tenantId, ["plant_staff"], "Bindu");
    platform.contacts = [...contactsFor(p.owner, p.worker, other)];
    const now = ist("2026-10-20 10:30");
    await mark(p.owner, p.worker, "2026-10-20", "off", now);
    const b = await todayBoard(p.owner, now);
    expect(b.dayOff.map((x) => x.name)).toEqual(["Ramu"]);
    expect(b.notMarked.map((x) => x.name)).toEqual(["Bindu"]);
  });

  it("plant B never sees plant A's marks", async () => {
    const a = await plantWithWorker();
    await mark(a.owner, a.worker, day(4), "off");
    const b = plant();
    expect((await asApp(b.tenantId, `select * from attendance_salary.day_marks where user_id = '${a.worker.userId}'`)).rows).toEqual([]);
  });
});

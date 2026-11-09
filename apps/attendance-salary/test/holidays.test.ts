// A person's own holiday list (rule 24, v0.53.0; owner 2026-11-09, for Ramu at plant 001): Paid holidays are paid days
// off (worked = the day + 1 extra day), one festival per choice group can be the person's choice leave (marked by the
// owner), the month calendar shows Paid holidays only, and months already marked paid can't change. November 2026 is
// worked out as seen on 1 December unless a test says otherwise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeChange } from "@/lib/changes";
import { groupLabel, parseHolidayPaste, readDate } from "@/lib/holidays";
import { countDays, dayStatuses, monthPay, type Holiday, type PayInput } from "@/lib/salary";
import { addHolidays, holidayList, removeHoliday, setChoice } from "@/server/holidays";
import { monthCsv } from "@/server/export";
import { monthStatuses } from "@/server/salary";
import { salaryCsv, salaryTab } from "@/server/salary-tab";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, atUser, contactsFor, ist, markAt, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const R = (rupees: number) => Math.round(rupees * 100);
const NOW = ist("2026-12-01 12:00");
const nov = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const H = (name: string, paid: boolean, over: Partial<Holiday> = {}): Holiday => ({ name, paid, group: paid ? null : "Oct–Dec 2026", choice: false, ...over });

const base: PayInput = {
  present: 0, half: 0, absent: 0, off: 0, otMinutes: 0,
  payBasis: "monthly", monthlyPaise: R(9000), dayRatePaise: null, shiftMinutes: 480, fullMonth: true, paidLeaveHalfdays: 0,
  getsOvertime: false, otRatePaise: null, advancesPaise: 0, taPaise: 0, daPaise: 0, expensesPaise: 0, carriedInPaise: 0, adjustmentPaise: 0,
};

describe("rule 24: what a holiday does to a day", () => {
  const days = new Map([
    [nov(8), { minutes: 0 }], // Diwali, not worked
    [nov(9), { minutes: 540 }], // a Paid holiday worked 9 h: a full day's work
    [nov(10), { minutes: 240 }], // a Paid holiday worked 4 h
    [nov(15), { minutes: 0 }], // choice leave, not worked
    [nov(24), { minutes: 540 }], // choice leave, but worked
    [nov(25), { minutes: 0 }], // a festival, not the choice: absent
  ]);
  const holidays = new Map([
    [nov(8), H("Diwali", true)],
    [nov(9), H("Test paid A", true)],
    [nov(10), H("Test paid B", true)],
    [nov(11), H("Test paid C", true)],
    [nov(15), H("Chhath Puja", false, { choice: true })],
    [nov(24), H("Guru Nanak Jayanti", false, { choice: true })],
    [nov(25), H("Christmas", false)],
  ]);
  const marks = new Map([[nov(11), "off" as const]]);
  const r = dayStatuses(days, 480, [nov(8), nov(9), nov(10), nov(11), nov(15), nov(24), nov(25)], true, marks, 0, null, holidays);

  it("Paid: a paid day, worked or not (even over an OFF mark); its work is paid on top, at most a full day", () => {
    expect(r.slice(0, 4).map((d) => [d.date, d.status, d.holiday, d.holidayWorkMinutes, d.otMinutes])).toEqual([
      [nov(8), "holiday", { name: "Diwali", kind: "paid", worked: false }, 0, 0],
      [nov(9), "holiday", { name: "Test paid A", kind: "paid", worked: true }, 480, 60], // overtime still from the real times
      [nov(10), "holiday", { name: "Test paid B", kind: "paid", worked: true }, 240, 0],
      [nov(11), "holiday", { name: "Test paid C", kind: "paid", worked: false }, 0, 0],
    ]);
  });

  it("choice leave: a paid day when not worked, a normal day when worked; other festivals are normal days", () => {
    expect(r.slice(4).map((d) => [d.date, d.status, d.holiday?.kind ?? null])).toEqual([
      [nov(15), "holiday", "choice"],
      [nov(24), "present", null],
      [nov(25), "absent", null],
    ]);
    expect(countDays(r)).toMatchObject({ holiday: 5, choice: 1, holidayWorkMinutes: 720, present: 1, absent: 1 });
  });

  it("without a list nothing changes (everyone else)", () => {
    expect(dayStatuses(days, 480, [nov(8)], false).map((d) => [d.status, d.holiday, d.holidayWorkMinutes])).toEqual([["absent", undefined, 0]]);
  });
});

describe("rule 24: what it does to the pay", () => {
  it("monthly (Ramu: ₹9,000, no paid leave): a paid holiday is not cut; work on it is a day's pay extra", () => {
    // November: 25 full + Diwali + 4 absent = 30 days; only the 4 absent days are cut at ₹300
    expect(monthPay({ ...base, present: 25, holiday: 1, absent: 4 })).toMatchObject({ earnedPaise: R(7800), unpaidHalves: 8, holidayWorkPaise: 0 });
    // the same month, Diwali worked a full day: + ₹300
    expect(monthPay({ ...base, present: 25, holiday: 1, absent: 4, holidayWorkMinutes: 480 })).toMatchObject({ earnedPaise: R(7800), holidayWorkPaise: R(300), remainingPaise: R(8100) });
    // before this release Diwali not worked would have been an absent day: ₹7,500
    expect(monthPay({ ...base, present: 25, absent: 5 }).earnedPaise).toBe(R(7500));
  });

  it("per day: a paid holiday earns the day rate; work on it the day rate again", () => {
    const perDay = { ...base, payBasis: "per_day" as const, monthlyPaise: 0, dayRatePaise: R(450) };
    expect(monthPay({ ...perDay, present: 20, holiday: 2, absent: 8 }).earnedPaise).toBe(R(22 * 450));
    expect(monthPay({ ...perDay, present: 20, holiday: 2, absent: 8, holidayWorkMinutes: 240 }).holidayWorkPaise).toBe(R(225));
  });

  it("part month and fixed: holidays are paid days; fixed still gets the extra for work on one", () => {
    expect(monthPay({ ...base, fullMonth: false, present: 10, holiday: 1, absent: 2 }).earnedPaise).toBe(R(11 * 300));
    expect(monthPay({ ...base, payBasis: "fixed", present: 29, holiday: 1, holidayWorkMinutes: 480 })).toMatchObject({ earnedPaise: R(9000), holidayWorkPaise: R(300) });
  });

  it("figures without holidays (paid before rule 24) read as none", () => {
    expect(monthPay({ ...base, present: 30 })).toMatchObject({ earnedPaise: R(9000), holidayWorkPaise: 0 });
  });
});

/** The owner's 2026 holiday sheet (Type | Date | Day | Name | | Paid Leave | Choice Leave), choice "1" on `on` rows. */
function sheet(on: "first" | "last") {
  const rows: [string, string, string, string, boolean][] = [
    ["Festival", "14-Jan-2026", "Wednesday", "Makar Sankranti / Pongal", false],
    ["Festival", "23-Jan-2026", "Friday", "Vasant Panchami", true],
    ["National Holiday", "26-Jan-2026", "Monday", "Republic Day", true],
    ["Festival", "15-Feb-2026", "Sunday", "Maha Shivaratri", false],
    ["Festival", "04-Mar-2026", "Wednesday", "Holi (Dhulandi)", true],
    ["Festival", "19-Mar-2026", "Thursday", "Ugadi / Gudi Padwa", false],
    ["Festival", "21-Mar-2026", "Saturday", "Eid al-Fitr (Ramzan Id)*", false],
    ["Festival", "26-Mar-2026", "Thursday", "Rama Navami", false],
    ["Festival", "31-Mar-2026", "Tuesday", "Mahavir Jayanti", false],
    ["Festival", "03-Apr-2026", "Friday", "Good Friday", false],
    ["Festival", "14-Apr-2026", "Tuesday", "Ambedkar Jayanti / Baisakhi", false],
    ["Festival", "01-May-2026", "Friday", "Buddha Purnima", false],
    ["Festival", "27-May-2026", "Wednesday", "Eid al-Adha (Bakrid)*", false],
    ["Festival", "26-Jun-2026", "Friday", "Muharram (Ashura)*", false],
    ["Festival", "16-Jul-2026", "Thursday", "Jagannath Rath Yatra", false],
    ["National Holiday", "15-Aug-2026", "Friday", "Independence Day", true],
    ["Festival", "26-Aug-2026", "Wednesday", "Onam / Milad-un-Nabi*", false],
    ["Festival", "28-Aug-2026", "Friday", "Raksha Bandhan", false],
    ["Festival", "04-Sep-2026", "Friday", "Krishna Janmashtami", false],
    ["Festival", "14-Sep-2026", "Monday", "Ganesh Chaturthi", false],
    ["National Holiday", "02-Oct-2026", "Friday", "Gandhi Jayanti", false],
    ["Festival", "20-Oct-2026", "Tuesday", "Dussehra / Vijayadashami", true],
    ["Festival", "08-Nov-2026", "Sunday", "Diwali (Lakshmi Puja)", true],
    ["Festival", "15-Nov-2026", "Sunday", "Chhath Puja", false],
    ["Festival", "24-Nov-2026", "Tuesday", "Guru Nanak Jayanti", false],
    ["Festival", "25-Dec-2026", "Friday", "Christmas Day", false],
  ];
  const marked = on === "first" ? [0, 9, 15, 20] : [8, 14, 19, 25];
  const head = "Type\tDate\tDay\tHoliday/Festival Name\t\tPaid Leave\tChoice Leave";
  return [head, ...rows.map((r, i) => [r[0], r[1], r[2], r[3], "", r[4] ? "Paid" : "", marked.includes(i) ? "1" : ""].join("\t"))].join("\n");
}

describe("pasting the owner's holiday sheet", () => {
  it("reads the dates spreadsheets show", () => {
    expect(["14-Jan-2026", "14 Jan 2026", "14-Jan-26", "2026-01-14", "14/01/2026", "14-01-2026", "14.1.2026"].map(readDate)).toEqual(Array(7).fill("2026-01-14"));
    expect(["31-Feb-2026", "Wednesday", "Paid", "1", ""].map(readDate)).toEqual([null, null, null, null, null]);
    expect(groupLabel(["2026-12-25", "2026-10-02"])).toBe("Oct–Dec 2026");
  });

  it.each(["first", "last"] as const)("the 6 Paid holidays and 4 choice groups, choice numbers on the %s row of each group", (on) => {
    const { rows, skipped, grouped } = parseHolidayPaste(sheet(on));
    expect({ skipped, grouped, count: rows.length }).toEqual({ skipped: [], grouped: true, count: 26 });
    expect(rows.filter((r) => r.paid).map((r) => [r.day, r.name, r.group])).toEqual([
      ["2026-01-23", "Vasant Panchami", null],
      ["2026-01-26", "Republic Day", null],
      ["2026-03-04", "Holi (Dhulandi)", null],
      ["2026-08-15", "Independence Day", null],
      ["2026-10-20", "Dussehra / Vijayadashami", null],
      ["2026-11-08", "Diwali (Lakshmi Puja)", null],
    ]);
    const byGroup = (g: string) => rows.filter((r) => r.group === g).map((r) => r.day.slice(5));
    expect(byGroup("Jan–Mar 2026")).toEqual(["01-14", "02-15", "03-19", "03-21", "03-26", "03-31"]);
    expect(byGroup("Apr–Jul 2026")).toEqual(["04-03", "04-14", "05-01", "05-27", "06-26", "07-16"]);
    expect(byGroup("Aug–Sep 2026")).toEqual(["08-26", "08-28", "09-04", "09-14"]);
    expect(byGroup("Oct–Dec 2026")).toEqual(["10-02", "11-15", "11-24", "12-25"]);
  });

  it("a plain list (date and name, no groups) works too", () => {
    expect(parseHolidayPaste("08-Nov-2026\tDiwali\tPaid\n25-Dec-2026\tChristmas\nnot a date").rows).toEqual([
      { day: "2026-11-08", name: "Diwali", paid: true, group: null },
      { day: "2026-12-25", name: "Christmas", paid: false, group: null },
    ]);
  });
});

/** Ramu on ₹9,000 a month, 8 h, no paid leave, from October 2026 (plant 001's setting), and the platform's people. */
async function plantWithRamu() {
  const p = plant();
  const office = atUser(p.tenantId, ["office_staff"], "Ramesh");
  const supervisor = atUser(p.tenantId, ["supervisor"], "Mohan");
  platform.contacts = [...contactsFor(p.owner, p.worker, office, supervisor)];
  await asApp(
    p.tenantId,
    `insert into attendance_salary.salary_settings (tenant_id, user_id, user_name, from_month, monthly_paise, shift_minutes, paid_leave_halfdays, gets_overtime, created_by, created_by_name)
     values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '2026-10-01', ${R(9000)}, 480, 0, false, gen_random_uuid(), 'Sujata')`,
  );
  return { ...p, office, supervisor };
}

/** The sheet from November on, as the Holidays box sends it ("Start from" November). */
const fromNovember = () => parseHolidayPaste(sheet("last")).rows.filter((r) => r.day >= "2026-11-01");
const add = (u: AtUser, who: AtUser, rows = fromNovember(), now = NOW) => addHolidays(u, { user_id: who.userId, rows }, now);
const choose = (u: AtUser, who: AtUser, day: string, choice = true) => setChoice(u, { user_id: who.userId, day, choice });

describe("the owner keeps the list", () => {
  it("only the owner; Office staff, Supervisor, the worker and PlantOps support are refused", async () => {
    const p = await plantWithRamu();
    for (const u of [p.office, p.supervisor, p.worker, p.support]) {
      expect((await refusal(() => add(u, p.worker))).status, u.name).toBeGreaterThanOrEqual(403);
      if (u !== p.support) expect((await refusal(() => holidayList(u, p.worker.userId, "2026"))).status, u.name).toBeGreaterThanOrEqual(403);
    }
    expect((await asOwner(`select count(*)::int as n from attendance_salary.person_holidays where tenant_id = $1`, [p.tenantId])).rows[0]).toEqual({ n: 0 });
    expect(await add(p.owner, p.worker)).toEqual({ changed: 4, skipped: 0 });
    // the same paste again changes nothing
    expect(await add(p.owner, p.worker)).toEqual({ changed: 0, skipped: 4 });
    // support reads it
    expect((await holidayList(p.support, p.worker.userId, "2026")).entries.map((e) => [e.day, e.paid, e.group])).toEqual([
      [nov(8), true, null],
      [nov(15), false, "Oct–Dec 2026"],
      [nov(24), false, "Oct–Dec 2026"],
      ["2026-12-25", false, "Oct–Dec 2026"],
    ]);
  });

  it("one choice leave per group, never a Paid holiday; undo frees the group; Remove takes the choice with it", async () => {
    const p = await plantWithRamu();
    await add(p.owner, p.worker);
    expect(await choose(p.owner, p.worker, nov(15))).toEqual({ changed: true });
    expect(await refusal(() => choose(p.owner, p.worker, nov(24)))).toMatchObject({ status: 409, message: "Chhath Puja is already the choice leave for Oct–Dec 2026. Undo it first." });
    expect(await refusal(() => choose(p.owner, p.worker, nov(8)))).toMatchObject({ status: 400 });
    expect(await choose(p.owner, p.worker, nov(15), false)).toEqual({ changed: true });
    expect(await choose(p.owner, p.worker, nov(24))).toEqual({ changed: true });
    await removeHoliday(p.owner, { user_id: p.worker.userId, day: nov(24) });
    expect((await holidayList(p.owner, p.worker.userId, "2026")).entries.filter((e) => e.choice)).toEqual([]);
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>(`select action, details from attendance_salary.audit_log where tenant_id = $1 and action like 'holiday.%' order by id`, [p.tenantId]);
    expect(rows.map((r) => describeChange(r.action, r.details))).toEqual([
      "Added holiday Diwali (Lakshmi Puja) on Sun, 8 Nov for Ramu: Paid",
      "Added holiday Chhath Puja on Sun, 15 Nov for Ramu: festival, choice group Oct–Dec 2026",
      "Added holiday Guru Nanak Jayanti on Tue, 24 Nov for Ramu: festival, choice group Oct–Dec 2026",
      "Added holiday Christmas Day on Fri, 25 Dec for Ramu: festival, choice group Oct–Dec 2026",
      "Chhath Puja (15 Nov) marked as Ramu's choice leave for Oct–Dec 2026",
      "Chhath Puja (15 Nov) no longer Ramu's choice leave",
      "Guru Nanak Jayanti (24 Nov) marked as Ramu's choice leave for Oct–Dec 2026",
      "Removed holiday Guru Nanak Jayanti on Tue, 24 Nov for Ramu",
    ]);
  });

  it("a month already marked paid can't change (owner: start from November; October stays as paid)", async () => {
    const p = await plantWithRamu();
    await asApp(p.tenantId, `insert into attendance_salary.salary_payments (tenant_id, user_id, user_name, month, paid_on, paid_paise, remaining_paise, figures, created_by, created_by_name)
      values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', '2026-10-01', '2026-11-01', ${R(9000)}, ${R(9000)}, '{}', gen_random_uuid(), 'Sujata')`);
    const dussehra = parseHolidayPaste(sheet("last")).rows.filter((r) => r.day.startsWith("2026-10"));
    expect(await refusal(() => add(p.owner, p.worker, dussehra))).toMatchObject({ status: 409, message: "October 2026 is already marked paid, so its holidays can't change. Undo paid first." });
    // all or nothing: October in the same save refuses November too
    expect(await refusal(() => add(p.owner, p.worker, [...dussehra, ...fromNovember()]))).toMatchObject({ status: 409 });
    expect((await holidayList(p.owner, p.worker.userId, "2026")).entries).toEqual([]);
    expect((await holidayList(p.owner, p.worker.userId, "2026")).paidMonths).toEqual(["2026-10"]);
    expect(await add(p.owner, p.worker)).toMatchObject({ changed: 4 });
  });

  it("plant B's owner never reaches plant A's list (writes land in plant B only)", async () => {
    const a = await plantWithRamu();
    await add(a.owner, a.worker);
    const b = plant();
    await add(b.owner, a.worker, [{ day: nov(30), name: "Planted", paid: true, group: null }]);
    expect((await holidayList(a.owner, a.worker.userId, "2026")).entries.map((e) => e.name)).not.toContain("Planted");
    expect((await holidayList(b.owner, a.worker.userId, "2026")).entries.map((e) => e.name)).toEqual(["Planted"]);
  });
});

describe("Ramu's November", () => {
  async function november() {
    const p = await plantWithRamu();
    await add(p.owner, p.worker);
    await choose(p.owner, p.worker, nov(15)); // Chhath Puja is his choice leave
    // full days every day except Diwali (8), Chhath (15), and two absences (20, 21)
    for (let d = 1; d <= 30; d++) {
      if ([8, 15, 20, 21].includes(d)) continue;
      await markAt(p.worker, "in", `${nov(d)} 09:00`);
      await markAt(p.worker, "out", `${nov(d)} 17:00`);
    }
    return p;
  }

  it("the salary: Diwali and Chhath paid, only the 2 absences cut", async () => {
    const p = await november();
    const row = (await salaryTab(p.owner, "2026-11", NOW)).rows[0]!;
    expect(row.counts).toMatchObject({ present: 26, holiday: 2, choice: 1, absent: 2 });
    expect(row.result).toMatchObject({ earnedPaise: R(8400), holidayWorkPaise: 0, remainingPaise: R(8400) });
    const csvRow = (await salaryCsv(p.owner, "2026-11", NOW)).split(/\r?\n/)[1]!;
    expect(csvRow.endsWith(",2,1,0.00")).toBe(true);
  });

  it("the month calendar shows the Paid holiday only; a choice leave day looks like any day off work", async () => {
    const p = await november();
    const st = (await monthStatuses(p.owner, p.worker.userId, "2026-11", new Map(), NOW))!;
    expect(st.paidHolidays).toEqual({ [nov(8)]: "Diwali (Lakshmi Puja)" });
    expect(st.days[nov(8)]).toMatchObject({ status: "holiday", holiday: { name: "Diwali (Lakshmi Puja)", worked: false } });
    expect(st.days[nov(15)]).toMatchObject({ status: "absent" });
    expect(st.days[nov(15)]!.holiday).toBeUndefined();
    // the worker sees the same on their own calendar
    expect((await monthStatuses(p.worker, p.worker.userId, "2026-11", new Map(), NOW))!.paidHolidays).toEqual({ [nov(8)]: "Diwali (Lakshmi Puja)" });
  });

  it("Diwali worked a full day (an 8 h fix): the day + 1 extra day (₹300)", async () => {
    const p = await plantWithRamu();
    await add(p.owner, p.worker);
    await markAt(p.worker, "in", `${nov(8)} 09:00`, { owner: "worked on Diwali" });
    await markAt(p.worker, "out", `${nov(8)} 17:00`, { owner: "worked on Diwali" });
    const row = (await salaryTab(p.owner, "2026-11", NOW)).rows[0]!;
    expect(row.counts).toMatchObject({ holiday: 1, holidayWorkMinutes: 480 });
    expect(row.result.holidayWorkPaise).toBe(R(300));
  });

  it("the attendance CSV names the Paid holiday", async () => {
    const p = await november();
    const csv = (await monthCsv(p.owner, "2026-11")).replace(/\r/g, "");
    expect(csv.split("\n")[0]!.endsWith(",Paid holiday")).toBe(true);
    expect(csv.split("\n").find((l) => l.includes(nov(8)))!.endsWith(",Diwali (Lakshmi Puja)")).toBe(true);
    expect(csv.split("\n").find((l) => l.includes(nov(15)))!.endsWith(",")).toBe(true);
  });
});

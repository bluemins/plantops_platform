// Rule 21 (owner, 2026-10-23): work = time at the plant − the lunch break; a day under the work hours is a short day
// whose work counts ÷ the work hours; overtime from the work over it. Pure functions only (src/lib).
import { describe, expect, it } from "vitest";
import { countDays, dayStatuses, monthPay, panelInput, workMinutes, type DayMark, type PayInput } from "@/lib/salary";
import { workDays, type Mark } from "@/lib/sessions";

const H = 60;
const R = (rupees: number) => rupees * 100;
const hm = (h: number, m: number) => h * H + m;

/** Time at the plant per day, 1-22 Oct 2026, as the live copy had it on 23 Oct (0 = nothing marked). */
const REETA = [hm(9, 57), hm(10, 0), hm(10, 10), hm(10, 10), hm(9, 50), hm(10, 5), hm(9, 21), hm(9, 30), hm(8, 4), hm(8, 18), hm(9, 42), hm(9, 50), hm(7, 44), hm(5, 37), hm(8, 0), hm(8, 22), hm(8, 46), hm(8, 11), 0, 0, hm(7, 55), hm(9, 15)];
const DAMAYANTI = [0, 0, 0, 0, 0, hm(9, 40), hm(9, 40), hm(9, 31), hm(7, 51), hm(8, 18), hm(9, 48), hm(9, 50), hm(7, 59), hm(5, 32), hm(8, 0), hm(8, 22), hm(11, 45), 0, 0, hm(7, 42), 0, 0];
const dates = Array.from({ length: 22 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const daysOf = (minutes: number[]) => new Map(minutes.map((m, i) => [dates[i]!, { minutes: m }]));
const offOn = (...days: number[]) => new Map<string, DayMark>(days.map((d) => [dates[d - 1]!, "off"]));

const perDayInput = (counts: ReturnType<typeof countDays>, ratePaise: number, advancesPaise: number): PayInput => ({
  ...counts,
  payBasis: "per_day",
  monthlyPaise: 0,
  dayRatePaise: ratePaise,
  shiftMinutes: 8 * H,
  fullMonth: true,
  paidLeaveHalfdays: 0,
  getsOvertime: true,
  otRatePaise: R(25),
  advancesPaise,
  taPaise: 0,
  daPaise: 0,
  expensesPaise: 0,
  carriedInPaise: 0,
  adjustmentPaise: 0,
});

describe("work = time at the plant − lunch", () => {
  it("takes the whole break off from 5 h at the plant", () => {
    expect(workMinutes(hm(9, 57), H)).toBe(hm(8, 57));
    expect(workMinutes(hm(5, 37), H)).toBe(hm(4, 37));
    expect(workMinutes(5 * H, H)).toBe(4 * H);
  });

  it("a short stay keeps its time; from 4 h to 5 h the work stays 4 h, so staying longer never gives less", () => {
    expect(workMinutes(3 * H, H)).toBe(3 * H);
    expect(workMinutes(4 * H, H)).toBe(4 * H);
    expect(workMinutes(hm(4, 30), H)).toBe(4 * H);
    let last = 0;
    for (let m = 0; m <= 12 * H; m++) {
      const w = workMinutes(m, H);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  it("no break set: work is the time at the plant", () => {
    for (const m of [0, 100, 299, 300, 600]) expect(workMinutes(m, 0)).toBe(m);
  });

  it("a break marked OUT / IN counts towards the lunch, so it is never taken off twice", () => {
    const at = (t: string) => new Date(`2026-10-05T${t}:00+05:30`);
    const mk = (id: string, kind: "in" | "out", t: string): Mark => ({ id, kind, at: at(t), source: "scan", reason: null, byName: "x", distanceM: 10 });
    const days = workDays([mk("1", "in", "08:00"), mk("2", "out", "13:00"), mk("3", "in", "14:00"), mk("4", "out", "17:00")], [], at("23:00"));
    const day = days.get("2026-10-05")!;
    expect(day).toMatchObject({ minutes: 8 * H, gapMinutes: H });
    const [r] = dayStatuses(days, 8 * H, ["2026-10-05"], true, undefined, H);
    expect(r).toMatchObject({ workMinutes: 8 * H, status: "present", otMinutes: 0 });
    // a 30-minute break out: the other 30 minutes are still taken off
    expect(workMinutes(hm(8, 30), H, 30)).toBe(8 * H);
  });
});

describe("full / short / absent days", () => {
  it("8 h work or more = full day + overtime; less = short (no half days); nothing = absent; marks decide", () => {
    const days = new Map([
      ["2026-10-01", { minutes: hm(9, 57) }],
      ["2026-10-02", { minutes: hm(8, 4) }],
      ["2026-10-03", { minutes: hm(2, 0) }],
      ["2026-10-05", { minutes: hm(3, 0) }],
    ]);
    const r = dayStatuses(days, 8 * H, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], true, new Map([["2026-10-05", "off" as const]]), H);
    expect(r.map((d) => [d.status, d.workMinutes, d.otMinutes])).toEqual([
      ["present", hm(8, 57), 57],
      ["short", hm(7, 4), 0],
      ["short", 2 * H, 0],
      ["absent", 0, 0],
      ["off", 3 * H, 0],
    ]);
    expect(countDays(r)).toMatchObject({ present: 1, short: 2, shortMinutes: hm(9, 4), half: 0, absent: 1, off: 1, otMinutes: 57 });
  });
});

describe("pay with short days", () => {
  it("Reeta, 1-22 Oct: 11 full + 1 off + 9 short days (61h 57m ÷ 8 = 7.74) × ₹250 + 8h 50m overtime = ₹5,156.77", () => {
    const counts = countDays(dayStatuses(daysOf(REETA), 8 * H, dates, true, offOn(19), H));
    expect(counts).toMatchObject({ present: 11, off: 1, short: 9, shortMinutes: hm(61, 57), absent: 1, otMinutes: hm(8, 50) });
    const pay = monthPay(perDayInput(counts, R(250), 0));
    expect(pay.earnedPaise).toBe(493_594); // 9,477 min × ₹250 ÷ 480, rounded once
    expect(pay.otPayPaise).toBe(22_083);
    expect(pay.remainingPaise).toBe(515_677);
    expect(Math.round(pay.paidHalves * 50) / 100).toBe(19.74);
  });

  it("Damayanti, 1-22 Oct: 6 full + 9 off + 7 short days (46h 44m) × ₹200 + 6h 14m overtime − ₹1,500 advance = ₹2,824.16", () => {
    const counts = countDays(dayStatuses(daysOf(DAMAYANTI), 8 * H, dates, true, offOn(1, 2, 3, 4, 5, 18, 19, 21, 22), H));
    expect(counts).toMatchObject({ present: 6, off: 9, short: 7, shortMinutes: hm(46, 44), absent: 0, otMinutes: hm(6, 14) });
    expect(monthPay(perDayInput(counts, R(200), R(1500))).remainingPaise).toBe(282_416);
  });

  it("monthly: the time short days are short is missing time; paid leave covers it first", () => {
    const base: PayInput = { ...perDayInput({ present: 28, half: 0, absent: 1, off: 0, short: 2, shortMinutes: 12 * H, otMinutes: 0 }, 0, 0), payBasis: "monthly", monthlyPaise: R(12000), dayRatePaise: null, paidLeaveHalfdays: 4 };
    // 1 absent day + 2 short days of 6 h (4 h short) = 1.5 days missing, inside 2 days of leave: full salary
    expect(monthPay(base)).toMatchObject({ absentHalves: 3, leaveUsedHalves: 3, unpaidHalves: 0, earnedPaise: R(12000) });
    // half a day of leave: 1 day unpaid × ₹400
    expect(monthPay({ ...base, paidLeaveHalfdays: 1 })).toMatchObject({ unpaidHalves: 2, deductionPaise: R(400), earnedPaise: R(11600) });
    // part month: paid for the full days + the short-day work + the leave used
    expect(monthPay({ ...base, fullMonth: false, paidLeaveHalfdays: 0 }).earnedPaise).toBe(R(400) * 28 + R(400) * 1.5);
  });

  it("without short days the pay is exactly what the half-day rules gave", () => {
    const old: PayInput = { ...perDayInput({ present: 20, half: 3, absent: 2, off: 1, otMinutes: 90 }, R(450), R(1000)), shiftMinutes: undefined };
    expect(monthPay(old)).toMatchObject({ paidHalves: 45, earnedPaise: R(450) * 22.5, otPayPaise: R(25) * 1.5 });
    const monthly: PayInput = { ...old, payBasis: "monthly", monthlyPaise: R(12000), dayRatePaise: null, paidLeaveHalfdays: 4 };
    expect(monthPay(monthly)).toMatchObject({ absentHalves: 7, leaveUsedHalves: 4, unpaidHalves: 3, deductionPaise: R(600), earnedPaise: R(11400) });
  });

  it("the checking panel takes short days and short-day hours", () => {
    const counts = countDays(dayStatuses(daysOf(REETA), 8 * H, dates, true, offOn(19), H));
    const auto = perDayInput(counts, R(250), 0);
    const typed = panelInput(auto, { shortHours: "64" }); // 64 h ÷ 8 = 8 days instead of 7.74
    expect(typed.shortMinutes).toBe(64 * H);
    expect(monthPay(typed).earnedPaise).toBe(R(250) * 20);
  });
});

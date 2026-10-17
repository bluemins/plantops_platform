// The salary rules (src/lib/salary.ts, docs/SALARY_PHASE_PLAN.md "The rules"): pure, no database. Case numbers follow
// the Phase 2 plan's list.
import { describe, expect, it } from "vitest";
import { monthDays } from "@/lib/days";
import { workDays, type Mark } from "@/lib/sessions";
import {
  carryChain,
  countDays,
  countedDates,
  dayStatuses,
  hoursText,
  monthPay,
  paiseText,
  rupeesText,
  settingFor,
  toPaise,
  type ChainInput,
  type PayInput,
  type SalarySetting,
} from "@/lib/salary";
import { ist } from "./helpers";

const R = (rupees: number) => Math.round(rupees * 100); // ₹ -> paise
const H = 60; // minutes in an hour

/** The worked example's person: ₹12,000, 8 h shift, 2 days' paid leave, overtime ₹60/h, full month. */
const base: PayInput = {
  monthlyPaise: R(12000),
  fullMonth: true,
  present: 26,
  half: 2,
  absent: 3,
  otMinutes: 14 * H,
  paidLeaveHalfdays: 4,
  getsOvertime: true,
  otRatePaise: R(60),
  advancesPaise: R(3000),
  carriedInPaise: 0,
  adjustmentPaise: 0,
};

/** A month of days with the same worked minutes on every date (a Map like workDays() gives). */
const everyDay = (month: string, minutes: number) => new Map(monthDays(month).map((d) => [d, { minutes }]));

describe("one month's pay", () => {
  it("1. the plan's worked example: ₹9,040 remaining", () => {
    const r = monthPay(base);
    expect(r).toMatchObject({
      absentHalves: 8, // 3 + ½ × 2 = 4 days
      leaveUsedHalves: 4, // 2 days
      unpaidHalves: 4, // 2 days
      dayPayPaise: R(400),
      deductionPaise: R(800),
      earnedPaise: R(11200),
      otMinutes: 14 * H,
      otPayPaise: R(840),
      advancesPaise: R(3000),
      carriedInPaise: 0,
      remainingPaise: R(9040),
    });
    expect(rupeesText(r.remainingPaise)).toBe("₹9,040");
  });

  it("4. a full month with no absence pays exactly the salary, whatever its length", () => {
    for (const [month, days] of [["2027-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-10", 31]] as const) {
      const c = countedDates(month, "2099-01-01", null, null)!;
      expect(c.dates, month).toHaveLength(days);
      const r = monthPay({ ...base, present: days, half: 0, absent: 0, otMinutes: 0, advancesPaise: 0 });
      expect(r.earnedPaise, month).toBe(R(12000));
    }
  });

  it("5. paid leave: 2 days, 0 days, 10 days (unused leave lapses, never pays extra)", () => {
    const three = { ...base, present: 28, half: 0, absent: 3, otMinutes: 0, advancesPaise: 0 };
    expect(monthPay({ ...three, paidLeaveHalfdays: 4 })).toMatchObject({ unpaidHalves: 2, earnedPaise: R(11600) });
    expect(monthPay({ ...three, paidLeaveHalfdays: 0 })).toMatchObject({ unpaidHalves: 6, earnedPaise: R(10800) });
    expect(monthPay({ ...three, paidLeaveHalfdays: 20 })).toMatchObject({ leaveUsedHalves: 6, unpaidHalves: 0, earnedPaise: R(12000) });
  });

  it("6. half days use half a day of leave", () => {
    const halves = (half: number) => monthPay({ ...base, present: 31 - half, half, absent: 0, otMinutes: 0, advancesPaise: 0 });
    expect(halves(3)).toMatchObject({ absentHalves: 3, leaveUsedHalves: 3, unpaidHalves: 0, earnedPaise: R(12000) });
    expect(halves(5)).toMatchObject({ absentHalves: 5, leaveUsedHalves: 4, unpaidHalves: 1, earnedPaise: R(11800) }); // ½ day unpaid
  });

  it("7. overtime off: no hours and no pay, even on 12 h days; the hours still make the days present", () => {
    const c = countedDates("2026-10", "2026-11-01", null, null)!;
    const days = dayStatuses(everyDay("2026-10", 12 * H), 8 * H, c.dates, false);
    const counts = countDays(days);
    expect(counts).toEqual({ present: 31, half: 0, absent: 0, otMinutes: 0 });
    expect(monthPay({ ...base, ...counts, getsOvertime: false, otRatePaise: null, advancesPaise: 0 })).toMatchObject({ otMinutes: 0, otPayPaise: 0, earnedPaise: R(12000) });
    // even if minutes were handed in, no overtime without "Gets overtime"
    expect(monthPay({ ...base, getsOvertime: false, otRatePaise: null }).otPayPaise).toBe(0);
  });

  it("8. overtime on, 31 days of 9 h on an 8 h shift: 31 h × ₹60 = ₹1,860", () => {
    const c = countedDates("2026-10", "2026-11-01", null, null)!;
    const counts = countDays(dayStatuses(everyDay("2026-10", 9 * H), 8 * H, c.dates, true));
    expect(counts.otMinutes).toBe(31 * H);
    expect(monthPay({ ...base, ...counts, advancesPaise: 0 })).toMatchObject({ otPayPaise: R(1860), remainingPaise: R(13860) });
  });

  it("9. overtime in exact minutes: 8 h 40 m on an 8 h shift = 40 minutes = 0.67 h", () => {
    const [d] = dayStatuses(new Map([["2026-10-05", { minutes: 8 * H + 40 }]]), 8 * H, ["2026-10-05"], true);
    expect(d).toMatchObject({ status: "present", otMinutes: 40 });
    expect(hoursText(40)).toBe("0.67");
    expect(hoursText(14 * H)).toBe("14");
    expect(hoursText(90)).toBe("1.5");
  });

  it("10. part month: joined on the 15th, left on the 10th; never more than the salary", () => {
    const joined = countedDates("2026-10", "2026-11-01", "2026-10-15", null)!;
    expect(joined).toMatchObject({ fullMonth: false });
    expect(joined.dates[0]).toBe("2026-10-15");
    expect(joined.dates).toHaveLength(17);
    const pay = (days: number) => monthPay({ ...base, fullMonth: false, present: days, half: 0, absent: 0, otMinutes: 0, advancesPaise: 0 });
    expect(pay(17)).toMatchObject({ paidHalves: 34, earnedPaise: R(6800) });

    const left = countedDates("2026-10", "2026-11-01", null, "2026-10-10")!;
    expect(left.dates).toEqual(monthDays("2026-10").slice(0, 10));
    expect(pay(10).earnedPaise).toBe(R(4000));

    // 30 present + 1 paid leave day in a 31-day part month would be ₹12,400: capped at the salary
    expect(monthPay({ ...base, fullMonth: false, present: 30, half: 0, absent: 1, otMinutes: 0 }).earnedPaise).toBe(R(12000));
    // not employed on any day of the month
    expect(countedDates("2026-09", "2026-11-01", "2026-10-15", null)).toBeNull();
    expect(countedDates("2026-11", "2026-12-01", null, "2026-10-10")).toBeNull();
  });

  it("11. earned is never below 0; advances can make the remaining negative", () => {
    const r = monthPay({ ...base, present: 0, half: 0, absent: 31, paidLeaveHalfdays: 0, otMinutes: 0, advancesPaise: R(2100) });
    expect(r.earnedPaise).toBe(0);
    expect(r.remainingPaise).toBe(-R(2100));
    expect(rupeesText(r.remainingPaise)).toBe("−₹2,100");
    expect(monthPay({ ...base, fullMonth: false, present: 0, half: 0, absent: 0, otMinutes: 0 }).earnedPaise).toBe(0);
  });

  it("17. rounding in paise: ₹10,000 → day's pay ₹333.33, one unpaid day → ₹9,666.67; ₹55.55/h × 40 min = ₹37.03", () => {
    const r = monthPay({ ...base, monthlyPaise: R(10000), present: 28, half: 0, absent: 3, otMinutes: 40, otRatePaise: 5555, advancesPaise: 0 });
    expect(r.dayPayPaise).toBe(33333);
    expect(r.earnedPaise).toBe(966667);
    expect(paiseText(r.earnedPaise)).toBe("₹9,666.67");
    expect(r.otPayPaise).toBe(3703);
  });
});

describe("day statuses", () => {
  it("2. on an 8 h shift: 480 present, 479 half, 240 half, 239 absent, nothing absent", () => {
    const days = new Map([
      ["2026-10-01", { minutes: 480 }],
      ["2026-10-02", { minutes: 479 }],
      ["2026-10-03", { minutes: 240 }],
      ["2026-10-04", { minutes: 239 }],
    ]);
    const r = dayStatuses(days, 480, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], true);
    expect(r.map((d) => d.status)).toEqual(["present", "half", "half", "absent", "absent"]);
  });

  const mark = (id: string, kind: "in" | "out", at: string, source: "scan" | "owner" = "scan"): Mark => ({ id, kind, at: ist(at), source, reason: source === "owner" ? "forgot" : null, byName: "x", distanceM: null });

  it("3. a no-exit day counts 0 (absent) until the owner adds the OUT", () => {
    const now = ist("2026-10-20 12:00");
    const before = workDays([mark("a", "in", "2026-10-05 09:00")], [], now);
    expect(dayStatuses(before, 480, ["2026-10-05"], true)[0]).toMatchObject({ minutes: 0, status: "absent" });
    const after = workDays([mark("a", "in", "2026-10-05 09:00"), mark("b", "out", "2026-10-05 17:30", "owner")], [], now);
    expect(dayStatuses(after, 480, ["2026-10-05"], true)[0]).toMatchObject({ minutes: 510, status: "present", otMinutes: 30 });
  });

  it("16. a night shift counts on the day it started; the next day is untouched", () => {
    const days = workDays([mark("a", "in", "2026-10-09 22:00"), mark("b", "out", "2026-10-10 06:00")], [], ist("2026-10-20 12:00"));
    const r = dayStatuses(days, 480, ["2026-10-09", "2026-10-10"], true);
    expect(r).toEqual([
      { date: "2026-10-09", minutes: 480, status: "present", otMinutes: 0 },
      { date: "2026-10-10", minutes: 0, status: "absent", otMinutes: 0 },
    ]);
  });

  it("15. an open month counts only the days that are over", () => {
    const c = countedDates("2026-10", "2026-10-17", null, null)!;
    expect(c).toMatchObject({ fullMonth: true, complete: false, monthLength: 31 });
    expect(c.dates).toHaveLength(16); // 1-16 October; today (17th) is not over
    expect(c.dates.at(-1)).toBe("2026-10-16");
    // a full-month person present on all 16 days so far: the salary minus nothing yet
    const counts = countDays(dayStatuses(everyDay("2026-10", 480), 480, c.dates, true));
    expect(counts.present).toBe(16);
    expect(monthPay({ ...base, ...counts, advancesPaise: 0 }).earnedPaise).toBe(R(12000));
    expect(countedDates("2026-10", "2026-11-01", null, null)!.complete).toBe(true);
    // the last day itself is not over yet
    expect(countedDates("2026-10", "2026-10-31", null, null)!.dates).toHaveLength(30);
  });
});

describe("which setting applies", () => {
  const s = (fromMonth: string, monthlyRupees: number, createdAt: string): SalarySetting => ({
    id: `${fromMonth}-${createdAt}`, fromMonth, monthlyPaise: R(monthlyRupees), shiftMinutes: 480, paidLeaveHalfdays: 4, getsOvertime: false, otRatePaise: null, joinedOn: null, leftOn: null, createdAt,
  });

  it("14. a setting from November leaves October unchanged; the newest of the same month wins", () => {
    const rows = [s("2026-10", 12000, "2026-10-01T10:00:00Z"), s("2026-11", 13000, "2026-10-20T10:00:00Z")];
    expect(settingFor(rows, "2026-09")).toBeNull();
    expect(settingFor(rows, "2026-10")!.monthlyPaise).toBe(R(12000));
    expect(settingFor(rows, "2026-11")!.monthlyPaise).toBe(R(13000));
    expect(settingFor(rows, "2027-03")!.monthlyPaise).toBe(R(13000));
    const resaved = [...rows, s("2026-10", 12500, "2026-10-25T10:00:00Z")];
    expect(settingFor(resaved, "2026-10")!.monthlyPaise).toBe(R(12500));
    expect(settingFor(resaved, "2026-11")!.monthlyPaise).toBe(R(13000)); // a later from month still wins
  });
});

describe("month to month", () => {
  /** A full month with `present` days present and the rest absent; ₹12,000, 2 days' leave, no overtime. */
  const month = (m: string, over: Partial<ChainInput["input"]> = {}, paid: ChainInput["paid"] = null): ChainInput => {
    const len = monthDays(m).length;
    return { month: m, paid, input: { ...base, present: len, half: 0, absent: 0, otMinutes: 0, getsOvertime: false, otRatePaise: null, advancesPaise: 0, ...over } };
  };
  const paid = (remainingRupees: number) => ({ paymentId: crypto.randomUUID(), paidOn: "2026-10-31", paidPaise: Math.max(0, R(remainingRupees)), remainingPaise: R(remainingRupees) });

  it("12. a month left at −₹2,100 is taken off the next; a positive remaining carries nothing", () => {
    const [oct, nov] = carryChain([month("2026-10", { advancesPaise: R(14100) }), month("2026-11")]);
    expect(oct!.live.remainingPaise).toBe(-R(2100));
    expect(oct!.carriesOutPaise).toBe(R(2100));
    expect(nov!.live).toMatchObject({ carriedInPaise: R(2100), remainingPaise: R(9900) });
    const [a, b] = carryChain([month("2026-10", { advancesPaise: R(3000) }), month("2026-11")]);
    expect(a!.carriesOutPaise).toBe(0);
    expect(b!.live.carriedInPaise).toBe(0);
  });

  it("13. a chain of three months: the minus carries twice, then is used up", () => {
    const r = carryChain([month("2026-10", { advancesPaise: R(20000) }), month("2026-11", { advancesPaise: R(5000) }), month("2026-12")]);
    expect(r.map((m) => m.live.remainingPaise)).toEqual([-R(8000), -R(1000), R(11000)]);
    expect(r.map((m) => m.live.carriedInPaise)).toEqual([0, R(8000), R(1000)]);
  });

  it("18a. a paid month that later gains a present day: +₹400 'Adjustment from October' in November, once", () => {
    // October was paid at ₹11,600 (one unpaid day); later the owner fixed a missed OUT, so now it is ₹12,000
    const oct = month("2026-10", { present: 30, absent: 1, paidLeaveHalfdays: 0 }, paid(11600));
    expect(carryChain([oct, month("2026-11")])[1]!.live.adjustmentPaise).toBe(0); // nothing changed yet
    const fixed = { ...oct, input: { ...oct.input, present: 31, absent: 0 } };
    const [o, n, d] = carryChain([fixed, month("2026-11"), month("2026-12")]);
    expect(o!.changedPaise).toBe(R(400));
    expect(n!.live).toMatchObject({ adjustmentPaise: R(400), remainingPaise: R(12400) });
    expect(n!.adjustmentFrom).toBe("2026-10");
    expect(d!.live.adjustmentPaise).toBe(0); // once only
  });

  it("18b. a paid month that later loses a day: −₹400 in the next month", () => {
    const oct = month("2026-10", { paidLeaveHalfdays: 0 }, paid(12000));
    const lost = { ...oct, input: { ...oct.input, present: 30, absent: 1 } };
    const [o, n] = carryChain([lost, month("2026-11")]);
    expect(o!.changedPaise).toBe(-R(400));
    expect(n!.live).toMatchObject({ adjustmentPaise: -R(400), remainingPaise: R(11600) });
  });

  it("18c. when November was paid with the adjustment in it, December gets nothing more", () => {
    const oct = month("2026-10", { present: 31, absent: 0, paidLeaveHalfdays: 0 }, paid(11600)); // changed by +₹400
    const nov = month("2026-11", {}, paid(12400)); // paid with the +₹400 adjustment
    const [o, n, d] = carryChain([oct, nov, month("2026-12")]);
    expect(o!.changedPaise).toBe(R(400));
    expect(n!.changedPaise).toBe(0);
    expect(d!.live.adjustmentPaise).toBe(0);
  });

  it("18d. after undoing October, October is live again and the chain stays right", () => {
    // as 18c, then October's payment is undone: October now owes its full ₹12,000 again, and the +₹400 November
    // already paid comes back out of December
    const oct = month("2026-10", { present: 31, absent: 0, paidLeaveHalfdays: 0 }, null);
    const nov = month("2026-11", {}, paid(12400));
    const [o, n, d] = carryChain([oct, nov, month("2026-12")]);
    expect(o!.live.remainingPaise).toBe(R(12000));
    expect(o!.changedPaise).toBe(0);
    expect(n!.changedPaise).toBe(-R(400));
    expect(d!.live).toMatchObject({ adjustmentPaise: -R(400), remainingPaise: R(11600) });
    // in all: October ₹12,000 + November ₹12,400 + December ₹11,600 = 3 × ₹12,000 ✓
  });

  it("18e. a paid negative month (₹0 paid) still carries its minus", () => {
    const oct = month("2026-10", { advancesPaise: R(14100) }, paid(-2100));
    expect(oct.paid!.paidPaise).toBe(0);
    const [o, n] = carryChain([oct, month("2026-11")]);
    expect(o!.changedPaise).toBe(0);
    expect(n!.live.carriedInPaise).toBe(R(2100));
  });
});

describe("money helpers", () => {
  it("19. rupees typed → paise; text to the nearest rupee or exact", () => {
    expect(toPaise("12000")).toBe(1200000);
    expect(toPaise("12000.5")).toBe(1200050);
    expect(toPaise(" 0.01 ")).toBe(1);
    for (const bad of ["", "12,000", "-5", "1.234", "abc", "123456789"]) expect(toPaise(bad), bad).toBeNull();
    expect(rupeesText(R(9040))).toBe("₹9,040");
    expect(rupeesText(R(125000))).toBe("₹1,25,000");
    expect(rupeesText(966667)).toBe("₹9,667");
    expect(paiseText(R(400))).toBe("₹400");
    expect(paiseText(-R(2100.5))).toBe("−₹2,100.50");
  });
});

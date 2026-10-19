// The Salary tab's short form (v0.25.6): Days, Extras and Taken merge the full columns without changing any amount.
import { describe, expect, it } from "vitest";
import { daysText, extrasPaise, takenPaise } from "@/lib/salary-view";

const money = { otPayPaise: 41_500, taPaise: 11_000, daPaise: 9_000, expensesPaise: 16_500, advancesPaise: 200_000, carriedInPaise: 50_000 };

describe("merged columns", () => {
  it("Extras = OT pay + TA + DA + expenses; Taken = advances + carried in", () => {
    expect(extrasPaise(money)).toBe(41_500 + 11_000 + 9_000 + 16_500);
    expect(takenPaise(money)).toBe(250_000);
    const none = { otPayPaise: 0, taPaise: 0, daPaise: 0, expensesPaise: 0, advancesPaise: 0, carriedInPaise: 0 };
    expect([extrasPaise(none), takenPaise(none)]).toEqual([0, 0]);
  });

  it("Days: present on top; half only when there are any; leave only for monthly people who used some", () => {
    expect(daysText({ present: 3, half: 0, absent: 15 }, 4)).toEqual({ main: "3 present", sub: "15 absent · 2 leave" });
    expect(daysText({ present: 20, half: 1, absent: 2 }, 3)).toEqual({ main: "20 present", sub: "1 half · 2 absent · 1.5 leave" });
    expect(daysText({ present: 0, half: 0, absent: 18 }, 0)).toEqual({ main: "0 present", sub: "18 absent" });
    expect(daysText({ present: 1, half: 0, absent: 17 }, null)).toEqual({ main: "1 present", sub: "17 absent" }); // per day
    expect(daysText({ present: 22, half: 0, absent: 1, off: 4 }, 2)).toEqual({ main: "22 present", sub: "4 off · 1 absent · 1 leave" }); // day marks
  });
});

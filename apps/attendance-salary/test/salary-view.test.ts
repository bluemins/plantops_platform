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

  it("Days: full on top; short / half only when there are any; leave only for monthly people who used some", () => {
    expect(daysText({ present: 3, half: 0, absent: 15 }, 4, 480)).toEqual({ main: "3 full", sub: "15 absent · 2 leave" });
    expect(daysText({ present: 20, half: 1, absent: 2 }, 3, 480)).toEqual({ main: "20 full", sub: "1 half · 2 absent · 1.5 leave" }); // paid before rule 21
    expect(daysText({ present: 0, half: 0, absent: 18 }, 0, 480)).toEqual({ main: "0 full", sub: "18 absent" });
    expect(daysText({ present: 1, half: 0, absent: 17 }, null, 480)).toEqual({ main: "1 full", sub: "17 absent" }); // per day
    expect(daysText({ present: 22, half: 0, absent: 1, off: 4 }, 2, 480)).toEqual({ main: "22 full", sub: "4 off · 1 absent · 1 leave" }); // day marks
    // rule 21: short days with their work and what it counts as (Reeta, 1-22 Oct)
    expect(daysText({ present: 11, half: 0, absent: 1, off: 1, short: 9, shortMinutes: 61 * 60 + 57 }, null, 480)).toEqual({ main: "11 full", sub: "1 off · 9 short 61h 57m = 7.74 d · 1 absent" });
  });
});

// Rule 23 (owner, 2026-11-01): an optional "Work starts at" per person. Time at the plant before it isn't counted (a
// scan at 8:50 counts from 9:00); a later IN counts from the IN; empty = from the IN. Pure functions only (src/lib).
import { describe, expect, it } from "vitest";
import { clockText, dayStatuses, earlyMinutes } from "@/lib/salary";
import { workDays, type Mark } from "@/lib/sessions";

const H = 60;
const NOW = new Date("2026-11-10T12:00:00Z");
/** A mark at an India time on 2 Nov 2026 (IST = UTC + 5:30). */
const at = (hhmm: string, day = "2026-11-02") => new Date(`${day}T${hhmm}:00+05:30`);
let n = 0;
const mark = (kind: "in" | "out", hhmm: string, day?: string): Mark => ({ id: `m${++n}`, kind, at: at(hhmm, day), source: "scan", reason: null, byName: "Gaja", distanceM: 10 });
const day = (...marks: Mark[]) => workDays(marks, [], NOW);
const NINE = 9 * H;
const D = "2026-11-02";

describe("rule 23: work starts at", () => {
  it("an IN at 8:50 counts from 9:00 (10 minutes not counted)", () => {
    const days = day(mark("in", "08:50"), mark("out", "18:00"));
    expect(earlyMinutes(D, days.get(D), NINE)).toBe(10);
    // 9 h 10 m at the plant − 10 m early − 1 h lunch = 8 h: a full day, no overtime
    const [r] = dayStatuses(days, 8 * H, [D], true, undefined, H, NINE);
    expect(r).toMatchObject({ minutes: 9 * H + 10, earlyMinutes: 10, workMinutes: 8 * H, status: "present", otMinutes: 0 });
  });

  it("without a start time the same day still counts from the IN (10 minutes overtime)", () => {
    const days = day(mark("in", "08:50"), mark("out", "18:00"));
    const [r] = dayStatuses(days, 8 * H, [D], true, undefined, H, null);
    expect(r).toMatchObject({ earlyMinutes: 0, workMinutes: 8 * H + 10, otMinutes: 10 });
  });

  it("a later IN counts from the IN: 9:15 stays a short day", () => {
    const days = day(mark("in", "09:15"), mark("out", "18:00"));
    const [r] = dayStatuses(days, 8 * H, [D], true, undefined, H, NINE);
    expect(r).toMatchObject({ earlyMinutes: 0, workMinutes: 7 * H + 45, status: "short" });
  });

  it("staying late is still overtime", () => {
    const days = day(mark("in", "08:40"), mark("out", "19:30"));
    const [r] = dayStatuses(days, 8 * H, [D], true, undefined, H, NINE);
    expect(r).toMatchObject({ earlyMinutes: 20, workMinutes: 9 * H + 30, otMinutes: 90 });
  });

  it("a block that ends before the start time counts nothing; a lunch OUT / IN later in the day loses nothing", () => {
    const days = day(mark("in", "07:00"), mark("out", "08:30"), mark("in", "08:45"), mark("out", "13:00"), mark("in", "14:00"), mark("out", "18:00"));
    // 1 h 30 m (all early) + 15 m early of the second block; the afternoon block is untouched
    expect(earlyMinutes(D, days.get(D), NINE)).toBe(90 + 15);
  });

  it("only the day's own date: a block starting the evening before isn't touched", () => {
    const days = day(mark("in", "20:00", "2026-11-01"), mark("out", "04:00"));
    expect(earlyMinutes("2026-11-01", days.get("2026-11-01"), NINE)).toBe(0);
  });

  it("days without blocks (typed counts) and no-exit blocks count nothing early", () => {
    expect(earlyMinutes(D, { minutes: 600 }, NINE)).toBe(0);
    const open = day(mark("in", "08:30"));
    expect(earlyMinutes(D, open.get(D), NINE)).toBe(0);
  });

  it("clockText", () => {
    expect(clockText(540)).toBe("09:00");
    expect(clockText(495)).toBe("08:15");
  });
});

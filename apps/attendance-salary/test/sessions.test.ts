// The pairing rules (src/lib/sessions.ts) and India dates (src/lib/days.ts): pure, no database.
import { describe, expect, it } from "vitest";
import { addMonths, dayStart, fmtMinutes, istDay, monthDays, validDay, validMonth, weekdayMon0 } from "@/lib/days";
import { workDays, type Cancel, type Mark } from "@/lib/sessions";

/** A moment given in India time: "2026-10-13 09:00". */
const ist = (s: string) => new Date(`${s.replace(" ", "T")}:00+05:30`);
let n = 0;
const mark = (kind: "in" | "out", at: string, over: Partial<Mark> = {}): Mark => ({ id: `m${++n}`, kind, at: ist(at), source: "scan", reason: null, byName: "Ramu", distanceM: 30, ...over });
const cancel = (m: Mark, reason = "scanned twice"): Cancel => ({ punchId: m.id, reason, byName: "Sujata", at: ist("2026-10-14 10:00") });
const LATER = ist("2026-10-20 12:00"); // "now", well after the marks

describe("blocks and day totals", () => {
  it("a simple day: IN 9:00, OUT 17:30 = 8h 30m", () => {
    const d = workDays([mark("in", "2026-10-13 09:00"), mark("out", "2026-10-13 17:30")], [], LATER).get("2026-10-13")!;
    expect(d.minutes).toBe(510);
    expect(d.blocks.map((b) => b.status)).toEqual(["done"]);
    expect(d).toMatchObject({ noExit: false, noEntry: false, open: false, changed: false });
  });

  it("two blocks in a day add up", () => {
    const d = workDays([mark("in", "2026-10-13 09:00"), mark("out", "2026-10-13 13:00"), mark("in", "2026-10-13 13:45"), mark("out", "2026-10-13 18:15")], [], LATER).get("2026-10-13")!;
    expect(d.blocks.map((b) => b.minutes)).toEqual([240, 270]);
    expect(d.minutes).toBe(510);
  });

  it("a night shift past midnight is one block on the day it started", () => {
    const days = workDays([mark("in", "2026-10-13 22:00"), mark("out", "2026-10-14 06:00")], [], LATER);
    expect(days.get("2026-10-13")!.minutes).toBe(480);
    expect(days.get("2026-10-13")!.blocks[0]!.nextDay).toBe(true);
    expect(days.has("2026-10-14")).toBe(false);
  });

  it("IN then IN: the first has no exit and counts 0; the second pairs normally", () => {
    const days = workDays([mark("in", "2026-10-13 09:10"), mark("in", "2026-10-14 09:00"), mark("out", "2026-10-14 17:00")], [], LATER);
    expect(days.get("2026-10-13")).toMatchObject({ minutes: 0, noExit: true });
    expect(days.get("2026-10-14")).toMatchObject({ minutes: 480, noExit: false });
  });

  it("an OUT 16 hours or more after the IN can't close it: no exit, and the OUT has no entry", () => {
    const days = workDays([mark("in", "2026-10-13 08:00"), mark("out", "2026-10-14 01:00")], [], LATER);
    expect(days.get("2026-10-13")).toMatchObject({ minutes: 0, noExit: true });
    expect(days.get("2026-10-14")).toMatchObject({ minutes: 0, noEntry: true });
  });

  it("an OUT 15 h 59 m after the IN still closes it", () => {
    expect(workDays([mark("in", "2026-10-13 08:00"), mark("out", "2026-10-13 23:59")], [], LATER).get("2026-10-13")!.minutes).toBe(959);
  });

  it("an IN with no OUT yet: inside if under 16 hours, no exit after", () => {
    const marks = [mark("in", "2026-10-15 09:00")];
    expect(workDays(marks, [], ist("2026-10-15 20:00")).get("2026-10-15")).toMatchObject({ open: true, noExit: false, minutes: 0 });
    expect(workDays(marks, [], ist("2026-10-16 01:00")).get("2026-10-15")).toMatchObject({ open: false, noExit: true });
  });

  it("an OUT without an IN: shown as no entry, never counted", () => {
    const d = workDays([mark("out", "2026-10-13 18:00")], [], LATER).get("2026-10-13")!;
    expect(d).toMatchObject({ minutes: 0, noEntry: true });
    expect(d.entries.map((e) => e.type)).toEqual(["no_entry"]);
  });
});

describe("owner fixes", () => {
  it("a cancelled scan is left out of the pairing but listed, and the day is 'changed'", () => {
    const wrongOut = mark("out", "2026-10-13 17:20");
    const d = workDays([mark("in", "2026-10-13 13:45"), wrongOut, mark("out", "2026-10-13 18:15")], [cancel(wrongOut, "went back to the line")], LATER).get("2026-10-13")!;
    expect(d.minutes).toBe(270); // 13:45 -> 18:15, not 13:45 -> 17:20
    expect(d.changed).toBe(true);
    expect(d.entries.map((e) => e.type)).toEqual(["block", "cancelled"]);
    const c = d.entries[1]!;
    expect(c.type === "cancelled" && c.cancel.reason).toBe("went back to the line");
  });

  it("an owner-added OUT is counted and labelled; the day is 'changed'", () => {
    const d = workDays([mark("in", "2026-10-14 09:10"), mark("out", "2026-10-14 18:30", { source: "owner", reason: "forgot to scan", byName: "Sujata", distanceM: null })], [], LATER).get("2026-10-14")!;
    expect(d).toMatchObject({ minutes: 560, noExit: false, changed: true });
    expect(d.blocks[0]!.end).toMatchObject({ source: "owner", reason: "forgot to scan" });
  });

  it("cancelling a stray IN turns IN IN back into a normal day", () => {
    const stray = mark("in", "2026-10-13 09:05");
    const d = workDays([mark("in", "2026-10-13 09:00"), stray, mark("out", "2026-10-13 17:00")], [cancel(stray)], LATER).get("2026-10-13")!;
    expect(d).toMatchObject({ minutes: 480, noExit: false, changed: true });
  });
});

describe("India dates", () => {
  it("23:59 IST belongs to that day, 00:01 IST to the next (whatever the server's zone)", () => {
    expect(istDay(ist("2026-10-13 23:59"))).toBe("2026-10-13");
    expect(istDay(ist("2026-10-14 00:01"))).toBe("2026-10-14");
    const days = workDays([mark("in", "2026-10-13 23:59"), mark("out", "2026-10-14 00:01"), mark("in", "2026-10-14 00:02"), mark("out", "2026-10-14 08:02")], [], LATER);
    expect(days.get("2026-10-13")!.minutes).toBe(2);
    expect(days.get("2026-10-14")!.minutes).toBe(480);
  });

  it("a block crossing the month end belongs to the month it started", () => {
    const days = workDays([mark("in", "2026-10-31 22:00"), mark("out", "2026-11-01 06:00")], [], LATER);
    expect(days.get("2026-10-31")!.minutes).toBe(480);
    expect(days.has("2026-11-01")).toBe(false);
  });

  it("date helpers", () => {
    expect(dayStart("2026-10-15").toISOString()).toBe("2026-10-14T18:30:00.000Z");
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2026-10").at(-1)).toBe("2026-10-31");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(weekdayMon0("2026-10-01")).toBe(3); // a Thursday
    expect(validDay("2026-02-30")).toBe(false);
    expect(validDay("2026-10-15")).toBe(true);
    expect(validMonth("2026-13")).toBe(false);
    expect(fmtMinutes(520)).toBe("8h 40m");
    expect(fmtMinutes(5)).toBe("0h 05m");
    expect(fmtMinutes(0)).toBe("0h");
  });
});

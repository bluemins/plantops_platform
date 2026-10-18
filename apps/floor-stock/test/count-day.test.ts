// B-05: a count entered after midnight belongs to the night before (until 5 am India time).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, afterMidnight, countDay } from "@/lib/days";
import { allowedDates, countDates, submitCount } from "@/server/counts";
import { summaryFor } from "@/server/summary";
import { homeStatus } from "@/server/views";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { refused } from "./helpers";
import { fullCount, stockPlant } from "./stock-plant";

const ist = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+05:30`);
const D16 = "2026-10-16";
const D17 = "2026-10-17";

describe("the counting day (pure)", () => {
  it.each([
    ["23:59", D16, D16, false],
    ["00:00", D17, D16, true],
    ["01:07", D17, D16, true],
    ["04:59", D17, D16, true],
    ["05:00", D17, D17, false],
    ["18:40", D17, D17, false],
  ])("at %s IST", (hm, calendarDay, expected, after) => {
    const now = ist(hm === "23:59" ? D16 : D17, hm);
    expect(countDay(now)).toBe(expected);
    expect(afterMidnight(now)).toBe(after);
    expect(countDates(now)).toEqual({ main: expected, calendarToday: calendarDay, afterMidnight: after });
  });

  it("does not depend on the server's clock zone (UTC instants)", () => {
    expect(countDay(new Date("2026-10-16T19:37:00Z"))).toBe(D16); // 01:07 IST on 17 Oct
    expect(countDay(new Date("2026-10-16T23:30:00Z"))).toBe(D17); // 05:00 IST on 17 Oct
  });

  it("the dates that may be saved are unchanged: the calendar today and yesterday", () => {
    expect(allowedDates(ist(D17, "01:07"))).toEqual([D17, D16]);
  });
});

describe("after midnight in the app", () => {
  let platform: FakePlatform;
  beforeAll(async () => {
    platform = await startFakePlatform();
    process.env.PLATFORM_URL = platform.url;
  });
  afterAll(() => platform.close());

  it("home at 01:07: last night's day is the main one, the calendar day is offered as a switch", async () => {
    const p = await stockPlant();
    const s = await homeStatus(p.owner, ist(D17, "01:07"));
    expect(s).toMatchObject({ today: D16, yesterday: addDays(D16, -1), todayCount: null, afterMidnight: true, calendarToday: D17, calendarTodayCount: null });
  });

  it("home in the daytime: unchanged (today and yesterday, no switch)", async () => {
    const p = await stockPlant();
    const s = await homeStatus(p.owner, ist(D17, "18:00"));
    expect(s).toMatchObject({ today: D17, yesterday: D16, afterMidnight: false, calendarToday: D17 });
  });

  it("last night's count saved at 01:07 counts as done for that day; the switch still saves the calendar day", async () => {
    const p = await stockPlant();
    const night = ist(D17, "01:07");
    await submitCount(p.keeper, fullCount(p, D16, { box: 5, label: 1, roll: 1 }), night);
    expect((await homeStatus(p.owner, night)).todayCount?.version).toBe(1);
    // the one-tap switch: the calendar day can still be counted on purpose
    await submitCount(p.keeper, fullCount(p, D17, { box: 5, label: 1, roll: 1 }), night);
    expect((await homeStatus(p.owner, night)).calendarTodayCount?.version).toBe(1);
    // and the day before yesterday is still refused
    expect((await refused(() => submitCount(p.keeper, fullCount(p, addDays(D16, -1), { box: 5, label: 1, roll: 1 }), night))).status).toBe(400);
  });

  it("tile at 01:07: last night's count shows as done, not 'Today's count not done'", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, D16, { made: 40, box: 5, label: 1, roll: 1 }), ist(D16, "22:40"));
    const b = (await summaryFor(p.tenantId, "owner", ist(D17, "01:07"))).badges;
    expect(b[0]).toEqual({ text: expect.stringMatching(/^Counted /), tone: "ok" }); // the time is the database clock's
    expect(b).toContainEqual({ text: "Made 40 box", tone: "info" });
  });

  it("tile at 05:00: a new day, not counted yet", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, D16, { box: 5, label: 1, roll: 1 }), ist(D16, "22:40"));
    expect((await summaryFor(p.tenantId, "owner", ist(D17, "05:00"))).badges[0]).toEqual({ text: "Today's count not done", tone: "warn" });
  });
});

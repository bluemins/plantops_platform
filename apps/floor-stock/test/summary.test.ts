// The launcher tile badges: count done or not, items low, made today.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { submitCount } from "@/server/counts";
import { updateItem } from "@/server/setup";
import { summaryFor } from "@/server/summary";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { plant } from "./helpers";
import { at, fullCount, stockPlant, TODAY } from "./stock-plant";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const badges = async (tenantId: string, when = at(TODAY)) => (await summaryFor(tenantId, "owner", when)).badges;

describe("tile badges", () => {
  it("nothing set up yet", async () => {
    expect(await badges(plant().tenantId)).toEqual([{ text: "Sections not set up yet", tone: "warn" }]);
  });

  it("set up, never counted: today's count not done", async () => {
    const p = await stockPlant();
    expect(await badges(p.tenantId)).toEqual([{ text: "Today's count not done", tone: "warn" }]);
  });

  it("counted today: the time of the first submit, items low and what was made", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 120, box: 5, label: 1, roll: 1 }), new Date(`${TODAY}T18:40:00+05:30`));
    const b = await badges(p.tenantId);
    expect(b[0]!.tone).toBe("ok");
    expect(b[0]!.text).toMatch(/^Counted \d{1,2}:\d{2} [ap]m$/);
    expect(b.slice(1)).toEqual([
      { text: "1 item low", tone: "danger" },
      { text: "Made 120 box", tone: "info" },
    ]);
  });

  it("not counted yet today: low items still come from the newest count (yesterday's)", async () => {
    const p = await stockPlant();
    await updateItem(p.owner, p.box, { min_level: 10 });
    await submitCount(p.keeper, fullCount(p, addDays(TODAY, -1), { made: 50, box: 5, label: 1, roll: 1 }), at(TODAY));
    expect(await badges(p.tenantId)).toEqual([
      { text: "Today's count not done", tone: "warn" },
      { text: "2 items low", tone: "danger" },
    ]);
  });

  it("a correction counts: low is worked out from the latest version", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 1 }), at(TODAY));
    await submitCount(p.keeper, fullCount(p, TODAY, { box: 5, label: 1, roll: 3 }, { expected_version: 1, reason: "found a roll box" }), at(TODAY));
    expect((await badges(p.tenantId)).map((x) => x.text)).toEqual([expect.stringMatching(/^Counted/)]);
  });

  it("every badge fits the 40-character limit, at most 3", async () => {
    const p = await stockPlant();
    await submitCount(p.keeper, fullCount(p, TODAY, { made: 1234567.25, box: 5, label: 1, roll: 1 }), at(TODAY));
    const b = await badges(p.tenantId);
    expect(b.length).toBeLessThanOrEqual(3);
    for (const x of b) expect(x.text.length).toBeLessThanOrEqual(40);
  });
});

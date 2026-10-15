// The owner's Today board (src/server/today.ts) and the staff list (src/server/people.ts): the people are the plant's
// active Plant staff from the platform; someone who left drops off Today but keeps their history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staffList } from "@/server/people";
import { todayBoard } from "@/server/today";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { atUser, contactsFor, ist, markAt, plant, refusal } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const NOW = ist("2026-09-10 12:00");
const names = (list: { name: string }[]) => list.map((p) => p.name);

describe("Today board", () => {
  it("sorts people into inside now, came and left, not marked, and no exit yesterday", async () => {
    const p = plant();
    const inside = atUser(p.tenantId, ["plant_staff"], "Anmol");
    const left = atUser(p.tenantId, ["plant_staff"], "Bindu");
    const none = atUser(p.tenantId, ["plant_staff"], "Dillip");
    const noExit = atUser(p.tenantId, ["plant_staff"], "Gaja");
    const night = atUser(p.tenantId, ["plant_staff"], "Kedar");
    const gone = atUser(p.tenantId, ["plant_staff"], "Reeta"); // disabled: not in the platform's list
    platform.contacts = [...contactsFor(p.owner, inside, left, none, noExit, night)];

    await markAt(inside, "in", "2026-09-10 09:02");
    await markAt(left, "in", "2026-09-10 06:00");
    await markAt(left, "out", "2026-09-10 10:30");
    await markAt(noExit, "in", "2026-09-09 08:00"); // 28 h ago, never left: no exit yesterday
    await markAt(night, "in", "2026-09-09 22:00"); // 14 h ago: still inside (night shift), not no exit
    await markAt(gone, "in", "2026-09-10 09:00");

    const b = await todayBoard(p.owner, NOW);
    expect(names(b.inside)).toEqual(["Kedar", "Anmol"]); // longest inside first
    expect(b.inside[1]!.since).toEqual(ist("2026-09-10 09:02"));
    expect(b.cameLeft).toEqual([expect.objectContaining({ name: "Bindu", minutes: 270, firstIn: ist("2026-09-10 06:00"), lastOut: ist("2026-09-10 10:30") })]);
    expect(names(b.notMarked)).toEqual(["Dillip", "Gaja"]);
    expect(names(b.noExitYesterday)).toEqual(["Gaja"]);
    expect(b.platformDown).toBe(false);
    const everyone = [...b.inside, ...b.cameLeft, ...b.notMarked, ...b.noExitYesterday];
    expect(names(everyone)).not.toContain("Reeta"); // left: off Today
    expect(names(everyone)).not.toContain("Sujata"); // an owner without Plant staff isn't tracked
  });

  it("an owner who is also Plant staff is on the board", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.ownerWorker, p.worker)];
    expect(names((await todayBoard(p.owner, NOW)).notMarked).sort()).toEqual(["Ramu", "Ravi"]);
  });

  it("platform unreachable: says so and shows the people who marked recently", async () => {
    const p = plant();
    await markAt(p.worker, "in", "2026-09-10 09:00");
    platform.contacts = null;
    const b = await todayBoard(p.owner, NOW);
    expect(b.platformDown).toBe(true);
    expect(names(b.inside)).toEqual(["Ramu"]);
    platform.contacts = [];
  });

  it("owner and support only", async () => {
    const p = plant();
    platform.contacts = [];
    expect((await todayBoard(p.support, NOW)).inside).toEqual([]);
    expect((await refusal(() => todayBoard(p.worker, NOW))).status).toBe(403);
  });
});

describe("staff list", () => {
  it("active Plant staff A-Z, then people who left, from their marks", async () => {
    const p = plant();
    const gone = atUser(p.tenantId, ["plant_staff"], "Reeta");
    await markAt(gone, "in", "2026-09-01 09:00");
    platform.contacts = [...contactsFor(p.owner, p.worker, p.ownerWorker)];
    const list = await staffList(p.owner);
    expect(names(list.active)).toEqual(["Ramu", "Ravi"]);
    expect(names(list.former)).toEqual(["Reeta"]);
  });
});

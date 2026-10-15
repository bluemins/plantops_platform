// The owner's fixes (src/server/fixes.ts): add a time or cancel a mark, always with a reason, append-only, owner only,
// never in the future, a cancel once per mark, and a 409 when the person's day changed since the page loaded.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as addRoute from "@/app/api/fix/add/route";
import { addDays, istDay } from "@/lib/days";
import { dayFor } from "@/server/calendar";
import { addFix, cancelFix, dayStamp } from "@/server/fixes";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, atUser, contactsFor, jsonReq, markAt, plant, refusal, signInAs } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => vi.restoreAllMocks());

const DAY = "2026-09-14";

/** A plant whose worker Ramu has IN 9:10 on DAY and no OUT; returns it, the mark id and the page's stamp. */
async function setup() {
  const p = plant();
  platform.contacts = [...contactsFor(p.owner, p.worker, p.ownerWorker)];
  const inId = await markAt(p.worker, "in", `${DAY} 09:10`);
  const stamp = await dayStamp(p.owner, p.worker.userId, DAY);
  const addOut = (over: Record<string, unknown> = {}) =>
    addFix(p.owner, { user_id: p.worker.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to scan", expect: stamp, ...over } as never);
  return { p, inId, stamp, addOut };
}

describe("add a time", () => {
  it("the owner adds a forgotten OUT; the day counts it and the worker sees it labelled", async () => {
    const { p, addOut } = await setup();
    await addOut();
    const mine = await dayFor(p.worker, p.worker.userId, DAY);
    expect(mine.day).toMatchObject({ minutes: 560, noExit: false, changed: true });
    expect(mine.day.blocks[0]!.end).toMatchObject({ source: "owner", reason: "forgot to scan", byName: "Sujata" });
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from attendance_salary.audit_log where tenant_id = $1", [p.tenantId]);
    expect(rows).toEqual([{ action: "fix.add", details: expect.objectContaining({ by: "Sujata", person: "Ramu", kind: "out", reason: "forgot to scan" }) }]);
  });

  it("only the owner: a worker, support and a store keeper are refused", async () => {
    const { p, stamp } = await setup();
    const input = { user_id: p.worker.userId, day: DAY, kind: "out" as const, date: DAY, time: "18:30", reason: "forgot to scan", expect: stamp };
    expect((await refusal(() => addFix(p.worker, input))).message).toBe("Only the plant owner can do this");
    expect((await refusal(() => addFix(p.support, input))).message).toBe("PlantOps support view is read-only");
    expect((await refusal(() => addFix(p.keeper, input))).status).toBe(403);
    expect((await refusal(() => cancelFix(p.worker, { punch_id: crypto.randomUUID(), day: DAY, reason: "nope", expect: stamp }))).status).toBe(403);
  });

  it("a reason of at least 3 characters is required (the route answers 400)", async () => {
    const { p, stamp } = await setup();
    signInAs(p.owner);
    const post = (reason: string) => addRoute.POST(jsonReq("POST", "/api/fix/add", { user_id: p.worker.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason, expect: stamp }), undefined as never);
    expect((await post("ok")).status).toBe(400);
    expect((await post("  ok  ")).status).toBe(400);
    expect((await post("late")).status).toBe(201);
  });

  it("a time in the future is refused; only this day or the next morning", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    const today = istDay();
    const stamp = await dayStamp(p.owner, p.worker.userId, today);
    const r = await refusal(() => addFix(p.owner, { user_id: p.worker.userId, day: today, kind: "in", date: addDays(today, 1), time: "10:00", reason: "planned", expect: stamp }));
    expect(r).toMatchObject({ status: 400, message: "That time is in the future" });
    const r2 = await refusal(() => addFix(p.owner, { user_id: p.worker.userId, day: "2026-09-01", kind: "in", date: "2026-09-05", time: "10:00", reason: "far away", expect: stamp }));
    expect(r2.status).toBe(400);
  });

  it("a person who is neither Plant staff here nor has marks here: 404", async () => {
    const { p, stamp } = await setup();
    const stranger = atUser(p.tenantId, ["plant_staff"], "Stranger");
    expect((await refusal(() => addFix(p.owner, { user_id: stranger.userId, day: DAY, kind: "in", date: DAY, time: "09:00", reason: "made up", expect: stamp }))).status).toBe(404);
  });

  it("a night shift's OUT can be added on the next morning", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    await markAt(p.worker, "in", "2026-09-14 22:00");
    const stamp = await dayStamp(p.owner, p.worker.userId, "2026-09-14");
    await addFix(p.owner, { user_id: p.worker.userId, day: "2026-09-14", kind: "out", date: "2026-09-15", time: "06:00", reason: "forgot to scan", expect: stamp });
    expect((await dayFor(p.owner, p.worker.userId, "2026-09-14")).day.minutes).toBe(480);
  });
});

describe("cancel a mark", () => {
  it("once per mark: the mark stays, crossed out; a second cancel is 409", async () => {
    const { p, inId, stamp } = await setup();
    await cancelFix(p.owner, { punch_id: inId, day: DAY, reason: "scanned by mistake", expect: stamp });
    const d = (await dayFor(p.owner, p.worker.userId, DAY)).day;
    expect(d.entries.map((e) => e.type)).toEqual(["cancelled"]);
    const fresh = await dayStamp(p.owner, p.worker.userId, DAY);
    expect(await refusal(() => cancelFix(p.ownerWorker, { punch_id: inId, day: DAY, reason: "again", expect: fresh }))).toEqual({ status: 409, message: "Already cancelled by Sujata.", code: undefined });
    const { rows } = await asOwner<{ n: number }>("select count(*)::int as n from attendance_salary.punches where id = $1", [inId]);
    expect(rows[0]!.n).toBe(1); // still on record
  });

  it("another plant's mark: 404", async () => {
    const { inId } = await setup();
    const b = plant();
    const stamp = await dayStamp(b.owner, b.worker.userId, DAY);
    expect((await refusal(() => cancelFix(b.owner, { punch_id: inId, day: DAY, reason: "not mine", expect: stamp }))).status).toBe(404);
  });
});

describe("the page was out of date (409)", () => {
  it("a scan after the page loaded: the fix is refused with who changed it", async () => {
    const { p, addOut } = await setup();
    await markAt(p.worker, "out", `${DAY} 18:00`); // Ramu scanned OUT meanwhile
    expect(await refusal(() => addOut())).toMatchObject({ status: 409, message: "Just changed by Ramu. The page has been refreshed: check it and try again." });
  });

  it("another owner's fix after the page loaded: the second is refused", async () => {
    const { p, inId, stamp, addOut } = await setup();
    await addOut();
    expect((await refusal(() => cancelFix(p.ownerWorker, { punch_id: inId, day: DAY, reason: "wrong", expect: stamp }))).status).toBe(409);
    expect((await refusal(() => addOut({ time: "19:00" }))).status).toBe(409);
  });
});

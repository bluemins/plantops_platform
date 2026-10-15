// Attendance's three notifications (src/server/notify.ts), exactly as the plan's table: kinds, who, texts, links,
// dedupe keys, levels. Plus the outbox and the daily job's secret. The fake platform records what was sent.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as cronRoute from "@/app/api/cron/daily/route";
import * as addRoute from "@/app/api/fix/add/route";
import * as cancelRoute from "@/app/api/fix/cancel/route";
import * as punchRoute from "@/app/api/punch/route";
import { addDays, istDay } from "@/lib/days";
import { dayStamp } from "@/server/fixes";
import { noExitYesterday, runDaily } from "@/server/notify";
import { newQr, qrLinkFor, saveSettings } from "@/server/settings";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, contactsFor, ist, jsonReq, markAt, northOf, plant, signInAs } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
afterEach(() => {
  vi.restoreAllMocks();
  platform.notifyStatus = 201;
});

const sent = (tenantId: string) => platform.notifications.filter((n) => n.tenantId === tenantId).map((n) => n.body);
const POINT = { lat: 21.347, lng: 83.627 };
const DAY = "2026-09-14";

describe("1. corrected (phone + bell): the worker only", () => {
  it("an added OUT: one notification to Ramu only, exactly as the table", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.owner, p.worker)];
    await markAt(p.worker, "in", `${DAY} 09:10`);
    signInAs(p.owner);
    const res = await addRoute.POST(
      jsonReq("POST", "/api/fix/add", { user_id: p.worker.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to scan", expect: await dayStamp(p.owner, p.worker.userId, DAY) }),
      undefined as never,
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    await settle();
    expect(sent(p.tenantId)).toEqual([
      {
        kind: "attendance_salary.corrected",
        title: "Your attendance on 14 Sept was changed",
        body: "Added OUT 18:30: forgot to scan",
        link: `/day/${DAY}`,
        level: "push",
        dedupe_key: `corrected:${id}`,
        also_user_ids: [p.worker.userId],
        only_listed: true,
        exclude_user_id: p.owner.userId,
      },
    ]);
  });

  it("a cancel: the cancel's own dedupe key and the reason", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    const inId = await markAt(p.worker, "in", `${DAY} 09:05`);
    signInAs(p.owner);
    const res = await cancelRoute.POST(jsonReq("POST", "/api/fix/cancel", { punch_id: inId, day: DAY, reason: "scanned twice", expect: await dayStamp(p.owner, p.worker.userId, DAY) }), undefined as never);
    expect(res.status).toBe(201);
    await settle();
    const [{ rows }] = [await asOwner<{ id: string }>("select id from attendance_salary.punch_cancels where punch_id = $1", [inId])];
    expect(sent(p.tenantId)).toEqual([expect.objectContaining({ kind: "attendance_salary.corrected", body: "Cancelled IN 9:05: scanned twice", dedupe_key: `corrected:${rows[0]!.id}`, also_user_ids: [p.worker.userId], only_listed: true })]);
  });

  it("an owner who is also Plant staff fixing their own marks tells nobody", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.ownerWorker)];
    await markAt(p.ownerWorker, "in", `${DAY} 09:00`);
    signInAs(p.ownerWorker);
    await addRoute.POST(
      jsonReq("POST", "/api/fix/add", { user_id: p.ownerWorker.userId, day: DAY, kind: "out", date: DAY, time: "17:00", reason: "forgot to scan", expect: await dayStamp(p.ownerWorker, p.ownerWorker.userId, DAY) }),
      undefined as never,
    );
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
  });
});

describe("2. outside (bell): the owners, once per person per day", () => {
  it("a mark refused for distance: one bell with the distance only (never where)", async () => {
    const p = plant();
    await saveSettings(p.owner, { ...POINT, radius_m: 200 });
    await newQr(p.owner);
    const k = new URL((await qrLinkFor(p.owner, "http://x"))!).searchParams.get("k")!;
    signInAs(p.worker);
    const far = { ...northOf(POINT, 1400), accuracy: 15 };
    const tap = () => punchRoute.POST(jsonReq("POST", "/api/punch", { k, expect: "in", location: far }), undefined as never);
    expect((await tap()).status).toBe(403);
    expect((await tap()).status).toBe(403);
    await settle();
    const today = istDay();
    const list = sent(p.tenantId);
    expect(list).toHaveLength(2); // the platform stores the same dedupe key once
    expect(new Set(list.map((n) => n.dedupe_key))).toEqual(new Set([`outside:${p.worker.userId}:${today}`]));
    expect(list[0]).toMatchObject({ kind: "attendance_salary.outside", title: "Ramu tried to mark IN from 1.4 km away", link: `/staff/${p.worker.userId}/${today}`, level: "bell", exclude_user_id: p.worker.userId });
    expect(list[0]!.body).toMatch(/^\d{1,2} \w+, \d{2}:\d{2}$/);
    expect(JSON.stringify(list[0])).not.toMatch(/21\.3|83\.6/); // no coordinates
    expect(list[0]).not.toHaveProperty("also_user_ids");
  });
});

describe("3. no exit (bell): the owners, once per plant per day", () => {
  it("yesterday's people with no OUT, by name; an IN under 16 hours old is not counted", async () => {
    const p = plant();
    const bindu = { ...p.worker, userId: crypto.randomUUID(), name: "Bindu" };
    const kedar = { ...p.worker, userId: crypto.randomUUID(), name: "Kedar" };
    await markAt(p.worker, "in", "2026-09-13 09:10"); // no OUT: no exit
    await markAt(bindu, "in", "2026-09-13 08:00"); // no exit
    await markAt(kedar, "in", "2026-09-13 22:30"); // night shift, 9.5 h ago at 08:00: still inside
    expect(await noExitYesterday(p.tenantId, ist("2026-09-14 08:00"))).toEqual({ date: "2026-09-13", names: ["Bindu", "Ramu"] });
    const q = plant();
    expect((await noExitYesterday(q.tenantId, ist("2026-09-14 08:00"))).names).toEqual([]);
  });

  it("the daily job sends one per plant, with the plan's text; a second run repeats the same dedupe key", async () => {
    const p = plant();
    const yesterday = addDays(istDay(), -1);
    await asApp(
      p.tenantId,
      `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name)
       values ('${p.tenantId}', '${p.worker.userId}', 'Ramu', 'in', '${yesterday} 08:00:00+05:30', 'scan', 30, 10, '${p.worker.userId}', 'Ramu')`,
    );
    const first = await runDaily();
    expect(first.no_exit.notified).toBeGreaterThanOrEqual(1);
    const mine = sent(p.tenantId);
    expect(mine).toEqual([
      {
        kind: "attendance_salary.no_exit",
        title: `1 person didn't mark OUT on ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${yesterday}T00:00:00Z`))}`,
        body: "Ramu",
        link: `/?day=${yesterday}`,
        level: "bell",
        dedupe_key: `no_exit:${yesterday}`,
      },
    ]);
    await runDaily();
    expect(new Set(sent(p.tenantId).map((n) => n.dedupe_key))).toEqual(new Set([`no_exit:${yesterday}`]));
  });
});

describe("outbox", () => {
  it("platform down (503): the notification waits, and the daily job sends it later", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    await markAt(p.worker, "in", `${DAY} 09:10`);
    platform.notifyStatus = 503;
    signInAs(p.owner);
    await addRoute.POST(
      jsonReq("POST", "/api/fix/add", { user_id: p.worker.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to scan", expect: await dayStamp(p.owner, p.worker.userId, DAY) }),
      undefined as never,
    );
    await settle();
    expect(sent(p.tenantId)).toEqual([]);
    const waiting = await asOwner("select * from attendance_salary.notification_outbox where tenant_id = $1 and sent_at is null", [p.tenantId]);
    expect(waiting.rowCount).toBe(1);
    platform.notifyStatus = 201;
    await runDaily();
    expect(sent(p.tenantId).map((n) => n.kind)).toEqual(["attendance_salary.corrected"]);
    expect((await asOwner("select * from attendance_salary.notification_outbox where tenant_id = $1 and sent_at is null", [p.tenantId])).rowCount).toBe(0);
  });

  it("a refusal (403, e.g. the module switched off) is not kept", async () => {
    const p = plant();
    platform.contacts = [...contactsFor(p.worker)];
    await markAt(p.worker, "in", `${DAY} 09:10`);
    platform.notifyStatus = 403;
    signInAs(p.owner);
    await addRoute.POST(
      jsonReq("POST", "/api/fix/add", { user_id: p.worker.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to scan", expect: await dayStamp(p.owner, p.worker.userId, DAY) }),
      undefined as never,
    );
    await settle();
    expect((await asOwner("select * from attendance_salary.notification_outbox where tenant_id = $1", [p.tenantId])).rowCount).toBe(0);
  });
});

describe("the daily job's secret", () => {
  const call = (secret?: string) => cronRoute.POST(new Request("http://localhost:3006/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
  it("not configured → 503; no or wrong secret → 401; the right one → 200", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("x")).status).toBe(503);
    process.env.CRON_SECRET = "attendance-cron-test-secret";
    try {
      expect((await call()).status).toBe(401);
      expect((await call("wrong")).status).toBe(401);
      const ok = await call("attendance-cron-test-secret");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ outbox: expect.any(Object), no_exit: { plants: expect.any(Number), notified: expect.any(Number) } });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

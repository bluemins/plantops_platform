// Marking IN / OUT (src/server/marks.ts): the server decides everything - plant and person from the session, time from
// the database, IN or OUT from the last valid mark, distance from the plant's point - and stores only the distance and
// the accuracy, never the phone's coordinates.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as punchRoute from "@/app/api/punch/route";
import ScanPage from "@/app/scan/page";
import { punch, scanState } from "@/server/marks";
import { newQr, qrLinkFor, saveSettings } from "@/server/settings";
import type { AtUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, jsonReq, northOf, plant, refusal, signInAs, textOf } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const POINT = { lat: 21.347, lng: 83.627 };

/** A plant with its point (circle 200 m) and a QR; returns the plant, the key on its QR and a "tap" helper. */
async function readyPlant(radius = 200) {
  const p = plant();
  await saveSettings(p.owner, { ...POINT, radius_m: radius });
  await newQr(p.owner);
  const k = new URL((await qrLinkFor(p.owner, "http://x"))!).searchParams.get("k")!;
  const at = (metres: number, accuracy = 15) => ({ ...northOf(POINT, metres), accuracy });
  const tap = (user: AtUser, expect: "in" | "out" = "in", location: { lat: number; lng: number; accuracy: number } | null = at(40), key = k) => punch(user, { k: key, expect, location });
  return { p, k, at, tap };
}

const marks = async (tenantId: string) =>
  (await asOwner<{ user_id: string; kind: string; source: string; distance_m: number; accuracy_m: number; at: Date }>("select * from attendance_salary.punches where tenant_id = $1 order by at", [tenantId])).rows;

/** A mark written straight into the table, `ago` before now (e.g. '15 hours 59 minutes'). */
const pastMark = (u: AtUser, kind: "in" | "out", ago: string, source: "scan" | "owner" = "scan") =>
  asApp(
    u.tenantId,
    source === "scan"
      ? `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, distance_m, accuracy_m, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${kind}', now() - interval '${ago}', 'scan', 30, 10, '${u.userId}', '${u.name}') returning id`
      : `insert into attendance_salary.punches (tenant_id, user_id, user_name, kind, at, source, reason, created_by, created_by_name) values ('${u.tenantId}', '${u.userId}', '${u.name}', '${kind}', now() - interval '${ago}', 'owner', 'forgot to scan', gen_random_uuid(), 'Sujata') returning id`,
  ).then((r) => (r.rows[0] as { id: string }).id);

describe("a good mark", () => {
  it("saves IN with the server's time, the distance and the accuracy - never coordinates", async () => {
    const { p, tap, at } = await readyPlant();
    const res = await tap(p.worker, "in", at(40, 12.4));
    expect(res).toMatchObject({ kind: "in", distance_m: 40 });
    const [m] = await marks(p.tenantId);
    expect(m).toMatchObject({ user_id: p.worker.userId, kind: "in", source: "scan", distance_m: 40, accuracy_m: 12 });
    expect(Math.abs(m!.at.getTime() - Date.now())).toBeLessThan(60_000);
    const cols = await asOwner<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'attendance_salary' and table_name = 'punches'");
    expect(cols.rows.map((c) => c.column_name).filter((c) => /lat|lng|lon|coord/.test(c))).toEqual([]);
  });

  it("the circle's edge: radius - 1 m is saved, radius + 1 m is refused", async () => {
    const { p, tap, at } = await readyPlant(200);
    expect((await tap(p.worker, "in", at(199))).kind).toBe("in");
    const q = await readyPlant(200);
    const r = await refusal(() => q.tap(q.p.worker, "in", q.at(201)));
    expect(r).toMatchObject({ status: 403, code: "outside", message: "You are 201 m from the plant. Mark IN at the plant." });
    expect(await marks(q.p.tenantId)).toEqual([]);
  });

  it("far away says km", async () => {
    const { p, tap, at } = await readyPlant();
    expect((await refusal(() => tap(p.worker, "in", at(1400)))).message).toBe("You are 1.4 km from the plant. Mark IN at the plant.");
  });

  it("accuracy: 500 m is accepted, 501 m is refused", async () => {
    const { p, tap, at } = await readyPlant();
    expect((await tap(p.worker, "in", at(40, 500))).kind).toBe("in");
    const q = await readyPlant();
    expect(await refusal(() => q.tap(q.p.worker, "in", q.at(40, 501)))).toMatchObject({ status: 400, code: "too_rough" });
  });
});

describe("refusals before anything is saved", () => {
  it("no location from the phone", async () => {
    const { p, tap } = await readyPlant();
    expect(await refusal(() => tap(p.worker, "in", null))).toMatchObject({ status: 400, code: "no_location", message: "Allow location to mark attendance." });
  });

  it("no settings, no plant location, no QR yet", async () => {
    const p = plant();
    const loc = { ...POINT, accuracy: 10 };
    expect(await refusal(() => punch(p.worker, { k: "anything", expect: "in", location: loc }))).toMatchObject({ code: "key", message: "The owner hasn't made the QR yet." });
    await newQr(p.owner); // QR made, point not set yet
    const k = new URL((await qrLinkFor(p.owner, "http://x"))!).searchParams.get("k")!;
    expect(await refusal(() => punch(p.worker, { k, expect: "in", location: loc }))).toMatchObject({ code: "no_location_set", message: "The owner hasn't set the plant location yet." });
  });

  it("wrong plant, old and missing key", async () => {
    const a = await readyPlant();
    const b = await readyPlant();
    const bad = "This QR is not for your plant, or it is old. Ask the owner for the new one.";
    expect(await refusal(() => a.tap(a.p.worker, "in", a.at(40), b.k))).toMatchObject({ status: 403, code: "key", message: bad });
    await new Promise((r) => setTimeout(r, 5));
    await newQr(a.p.owner); // a's printed QR is now old
    expect(await refusal(() => a.tap(a.p.worker))).toMatchObject({ code: "key", message: bad });
    expect(await refusal(() => a.tap(a.p.worker, "in", a.at(40), ""))).toMatchObject({ code: "key", message: "Scan the QR on the plant wall to mark attendance." });
    expect(await marks(a.p.tenantId)).toEqual([]);
  });
});

describe("who may mark", () => {
  it("an owner without Plant staff is refused with how to fix it; owner + Plant staff can mark", async () => {
    const { p, tap } = await readyPlant();
    expect(await refusal(() => tap(p.owner))).toEqual({ status: 403, message: "Owners don't mark attendance. Add Plant staff to yourself on Manage users to mark.", code: undefined });
    expect((await tap(p.ownerWorker)).kind).toBe("in");
  });

  it("support and a store keeper are refused", async () => {
    const { p, tap } = await readyPlant();
    expect((await refusal(() => tap(p.support))).message).toBe("PlantOps support view is read-only");
    expect((await refusal(() => tap(p.keeper))).message).toBe("You don't have access to Attendance");
    expect(await marks(p.tenantId)).toEqual([]);
  });
});

describe("double taps and two taps at once", () => {
  it("a second tap within 2 minutes is refused; after 2 minutes it is fine", async () => {
    const { p, tap } = await readyPlant();
    await tap(p.worker, "in");
    const r = await refusal(() => tap(p.worker, "out"));
    expect(r.status).toBe(409);
    expect(r.code).toBe("double");
    expect(r.message).toMatch(/^Already marked at \d{1,2}:\d{2}\.$/);
    const q = await readyPlant();
    await pastMark(q.p.worker, "in", "3 minutes");
    expect((await q.tap(q.p.worker, "out")).kind).toBe("out");
  });

  it("two taps at the same moment give exactly one mark", async () => {
    const { p, tap } = await readyPlant();
    const results = await Promise.allSettled([tap(p.worker, "in"), tap(p.worker, "in"), tap(p.worker, "in")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await marks(p.tenantId)).toHaveLength(1);
  });
});

describe("IN or OUT is the server's decision", () => {
  it("IN, then OUT; the screen's guess must match (409 otherwise)", async () => {
    const { p, tap } = await readyPlant();
    expect(await refusal(() => tap(p.worker, "out"))).toMatchObject({ status: 409, code: "changed", message: "You are already OUT." });
    await pastMark(p.worker, "in", "8 hours");
    expect((await scanState(p.worker, null)).next).toBe("out");
    expect(await refusal(() => tap(p.worker, "in"))).toMatchObject({ status: 409, code: "changed" });
    expect((await tap(p.worker, "out")).kind).toBe("out");
  });

  it("the 16-hour rule: an IN 15 h 59 m ago means OUT; 16 h 1 m ago means IN", async () => {
    const a = await readyPlant();
    await pastMark(a.p.worker, "in", "15 hours 59 minutes");
    expect((await a.tap(a.p.worker, "out")).kind).toBe("out");
    const b = await readyPlant();
    await pastMark(b.p.worker, "in", "16 hours 1 minute");
    expect((await b.tap(b.p.worker, "in")).kind).toBe("in");
  });

  it("a cancelled IN is ignored; an owner-added IN counts", async () => {
    const a = await readyPlant();
    const id = await pastMark(a.p.worker, "in", "1 hour");
    await asApp(a.p.tenantId, `insert into attendance_salary.punch_cancels (tenant_id, punch_id, reason, created_by, created_by_name) values ('${a.p.tenantId}', '${id}', 'scanned by mistake', gen_random_uuid(), 'Sujata')`);
    expect((await a.tap(a.p.worker, "in")).kind).toBe("in");
    const b = await readyPlant();
    await pastMark(b.p.worker, "in", "1 hour", "owner");
    expect((await b.tap(b.p.worker, "out")).kind).toBe("out");
  });

  it("one person's marks never decide another's", async () => {
    const { p, tap } = await readyPlant();
    await pastMark(p.worker, "in", "1 hour");
    expect((await tap(p.ownerWorker, "in")).kind).toBe("in");
  });
});

describe("what the browser sends is not trusted", () => {
  it("a time, a plant, a person or a distance in the request are ignored", async () => {
    const { p, k, at } = await readyPlant();
    const other = plant();
    signInAs(p.worker);
    const res = await punchRoute.POST(
      jsonReq("POST", "/api/punch", {
        k,
        expect: "in",
        location: at(60),
        at: "2020-01-01T00:00:00Z",
        tenant_id: other.tenantId,
        user_id: other.worker.userId,
        kind: "out",
        distance_m: 0,
        source: "owner",
      }),
      undefined as never,
    );
    expect(res.status).toBe(201);
    const [m] = await marks(p.tenantId);
    expect(m).toMatchObject({ user_id: p.worker.userId, kind: "in", source: "scan", distance_m: 60 });
    expect(Math.abs(m!.at.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await marks(other.tenantId)).toEqual([]);
  });

  it("a refusal answers its plain message and code", async () => {
    const { p, k } = await readyPlant();
    signInAs(p.worker);
    const res = await punchRoute.POST(jsonReq("POST", "/api/punch", { k, expect: "in", location: null }), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Allow location to mark attendance.", code: "no_location" });
  });
});

describe("the scan page", () => {
  let platform: FakePlatform;
  beforeAll(async () => {
    platform = await startFakePlatform(); // the page asks the platform for the plant's name and logo
    process.env.PLATFORM_URL = platform.url;
  });
  afterAll(() => platform.close());
  const open = async (user: AtUser, k: string | null) => textOf(await ScanPage({ searchParams: Promise.resolve(k ? { k } : {}) }));

  it("an owner without Plant staff is told how to mark; support is read-only and its log has no key", async () => {
    const { p, k } = await readyPlant();
    signInAs(p.owner);
    expect(await open(p.owner, k)).toContain("Add Plant staff to yourself on Manage users to mark.");
    vi.restoreAllMocks();
    signInAs(p.support);
    expect(await open(p.support, k)).toContain("PlantOps support can't mark attendance.");
    const { rows } = await asOwner<{ path: string }>("select path from attendance_salary.support_views where tenant_id = $1", [p.tenantId]);
    expect(rows.map((r) => r.path)).toEqual(["/scan"]);
  });

  it("an old QR or no key shows the plain message", async () => {
    const { p } = await readyPlant();
    signInAs(p.worker);
    expect(await open(p.worker, "old-key")).toContain("This QR is not for your plant, or it is old. Ask the owner for the new one.");
    expect(await open(p.worker, null)).toContain("Scan the QR on the plant wall to mark attendance.");
  });
});

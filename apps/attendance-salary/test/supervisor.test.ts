// Phase R3 (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Supervisor"): the read-only Today board, the scan alert to supervisors,
// the morning "not marked" alert at the plant's hour, and the owner's Settings choice. Real database, real routes.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as deskRoute from "@/app/api/desk/mark/route";
import * as addRoute from "@/app/api/fix/add/route";
import * as cancelRoute from "@/app/api/fix/cancel/route";
import * as notMarkedRoute from "@/app/api/settings/not-marked/route";
import * as punchRoute from "@/app/api/punch/route";
import HomePage from "@/app/page";
import { TodayView } from "@/app/today";
import { describeChange } from "@/lib/changes";
import { addDays, istDay } from "@/lib/days";
import { dayFor, monthFor } from "@/server/calendar";
import { deskList, deskMark } from "@/server/desk";
import { recentChanges } from "@/server/audit";
import { addFix, cancelFix, dayStamp } from "@/server/fixes";
import { runMorning } from "@/server/notify";
import { staffList } from "@/server/people";
import { monthStatuses, salaryMonths } from "@/server/salary";
import { newQr, qrLinkFor, saveNotMarkedHour, saveSettings, settingsFor } from "@/server/settings";
import { boardFor, todayBoard } from "@/server/today";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, atUser, contactsFor, ist, jsonReq, markAt, northOf, plant, refusal, signInAs } from "./helpers";

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

const POINT = { lat: 21.347, lng: 83.627 };
const at = (metres: number) => ({ ...northOf(POINT, metres), accuracy: 15 });
const TODAY = istDay();
const YESTERDAY = addDays(TODAY, -1);
const sent = (tenantId: string, kind?: string) => platform.notifications.filter((n) => n.tenantId === tenantId && (!kind || n.body.kind === kind)).map((n) => n.body);

/** Ramu and Bindu (Plant staff), Sunil (Supervisor only), Tapan (Supervisor + Plant staff), Ramesh (Office staff). */
async function setup(opts: { qr?: boolean } = {}) {
  const p = plant();
  const sunil = atUser(p.tenantId, ["supervisor"], "Sunil");
  const tapan = atUser(p.tenantId, ["supervisor", "plant_staff"], "Tapan");
  const bindu = atUser(p.tenantId, ["plant_staff"], "Bindu");
  const ramesh = atUser(p.tenantId, ["office_staff"], "Ramesh");
  platform.contacts = [...contactsFor(p.owner, p.worker, sunil, tapan, bindu, ramesh)];
  let k = "";
  if (opts.qr !== false) {
    await saveSettings(p.owner, { ...POINT, radius_m: 200 });
    await newQr(p.owner);
    k = new URL((await qrLinkFor(p.owner, "http://x"))!).searchParams.get("k")!;
  }
  const scan = (u: typeof bindu, metres = 40) => (signInAs(u), punchRoute.POST(jsonReq("POST", "/api/punch", { k, expect: "in", location: at(metres) }), undefined as never));
  return { p, sunil, tapan, bindu, ramesh, scan };
}

/** The <a href> links inside a rendered element tree. */
function links(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) links(n, out);
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === "a" && typeof el.props?.href === "string") out.push(el.props.href);
  if (typeof el.type === "function" && el.type !== TodayView) {
    // render plain function components that take no hooks (the board's Item / Group)
    try {
      links((el.type as (p: unknown) => unknown)(el.props), out);
      return out;
    } catch {
      /* a client component: skip */
    }
  }
  if (el.props) links(el.props.children, out);
  return out;
}

describe("the Supervisor's Today board", () => {
  it("1. sees the board, read-only: names without links; Staff list and desk hold only Office staff; no calendars of workers, no salary", async () => {
    const { p, sunil, bindu } = await setup();
    await markAt(bindu, "in", `${YESTERDAY} 08:00`);
    const board = await todayBoard(sunil);
    expect(board.notMarked.map((x) => x.name)).toEqual(["Bindu", "Ramu", "Tapan"]); // employees only: Sunil and Ramesh aren't Plant staff
    expect(links(TodayView({ user: sunil, board }))).toEqual([]);
    expect(links(TodayView({ user: p.owner, board })).filter((h) => h.startsWith("/staff/")).length).toBeGreaterThan(0);
    expect((await staffList(sunil)).active).toEqual([]); // Ramesh is Office staff but not Plant staff: not tracked
    expect((await deskList(sunil)).people).toEqual([]);
    expect((await refusal(() => monthFor(sunil, bindu.userId, null))).status).toBe(404); // someone else's calendar: "not found", as for a worker
    expect((await refusal(() => salaryMonths(sunil, TODAY.slice(0, 7)))).status).toBe(404);
    signInAs(sunil);
    const home = (await HomePage({ searchParams: Promise.resolve({}) })) as { props: { children: unknown[] } };
    expect(JSON.stringify(home, (_k, v) => (typeof v === "function" ? v.name : v))).toContain("TodayView");
  });

  it("2. a desk mark shows 'by Ramesh' on the board", async () => {
    const { p, bindu } = await setup();
    const office = atUser(p.tenantId, ["office_staff"], "Ramesh");
    signInAs(office);
    expect((await deskRoute.POST(jsonReq("POST", "/api/desk/mark", { user_id: bindu.userId, expect: "in", location: at(40) }), undefined as never)).status).toBe(201);
    expect((await boardFor(p.tenantId)).inside).toEqual([expect.objectContaining({ name: "Bindu", by: "Ramesh" })]);
  });
});

describe("the scan alert", () => {
  it("3. every saved IN / OUT reaches the supervisors only (bell), never the owners or whoever marked", async () => {
    const { p, sunil, tapan, bindu, scan } = await setup();
    const res = await scan(bindu);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await settle();
    const [n, ...rest] = sent(p.tenantId, "attendance_salary.scan");
    expect(rest).toEqual([]);
    expect(n).toMatchObject({ link: "/", level: "bell", dedupe_key: `scan:${id}`, only_listed: true, exclude_user_id: bindu.userId, body: "" });
    expect(n!.title).toMatch(/^Bindu IN \d\d:\d\d$/);
    expect([...(n!.also_user_ids as string[])].sort()).toEqual([sunil.userId, tapan.userId].sort());
    // a supervisor's own scan: only the other supervisor
    await scan(tapan);
    await settle();
    expect(sent(p.tenantId, "attendance_salary.scan").at(-1)!.also_user_ids).toEqual([sunil.userId]);
  });

  it("4. a desk mark says 'by Ramesh'; a refused scan sends no scan alert; a plant without supervisors gets none", async () => {
    const { p, sunil, tapan, bindu, ramesh, scan } = await setup();
    signInAs(ramesh);
    await deskRoute.POST(jsonReq("POST", "/api/desk/mark", { user_id: p.worker.userId, expect: "in", location: at(40) }), undefined as never);
    await settle();
    const desk = sent(p.tenantId, "attendance_salary.scan")[0]!;
    expect(desk.body).toBe("by Ramesh");
    expect([...(desk.also_user_ids as string[])].sort()).toEqual([sunil.userId, tapan.userId].sort());
    expect((await scan(bindu, 1500)).status).toBe(403); // outside the circle
    await settle();
    expect(sent(p.tenantId, "attendance_salary.scan")).toHaveLength(1);
    const q = await setup();
    platform.contacts = [...contactsFor(q.p.owner, q.bindu)];
    await q.scan(q.bindu);
    await settle();
    expect(sent(q.p.tenantId, "attendance_salary.scan")).toEqual([]);
  });
});

describe("the not-marked alert", () => {
  /** Ramu came and left yesterday (so the plant is in use); today nobody has marked yet unless a test marks. */
  async function morning() {
    const s = await setup({ qr: false });
    await markAt(s.p.worker, "in", `${YESTERDAY} 08:00`);
    await markAt(s.p.worker, "out", `${YESTERDAY} 17:00`);
    return s;
  }
  const mine = (tenantId: string) => sent(tenantId, "attendance_salary.not_marked");

  it("5. at the plant's hour (10:00 by default): the board's 'Not marked' people, to owners + supervisors, phone + bell", async () => {
    const { p, sunil, tapan, bindu } = await morning();
    await markAt(bindu, "in", `${TODAY} 08:05`);
    await runMorning(ist(`${TODAY} 09:30`));
    expect(mine(p.tenantId)).toEqual([]); // before the hour
    await runMorning(ist(`${TODAY} 10:15`));
    const [n] = mine(p.tenantId);
    expect(n).toMatchObject({ title: "2 people not marked by 10:00", body: "Ramu, Tapan", level: "push", link: "/", dedupe_key: `notmarked:${TODAY}` });
    expect(n).not.toHaveProperty("only_listed"); // the platform adds the owners
    expect([...(n!.also_user_ids as string[])].sort()).toEqual([sunil.userId, tapan.userId].sort());
    const board = await boardFor(p.tenantId, ist(`${TODAY} 10:15`));
    expect(board.notMarked.map((x) => x.name).join(", ")).toBe(n!.body); // exactly the board's list
    // a later run the same day: same dedupe key (the platform keeps one per person)
    await runMorning(ist(`${TODAY} 11:15`));
    expect(new Set(mine(p.tenantId).map((x) => x.dedupe_key))).toEqual(new Set([`notmarked:${TODAY}`]));
  });

  it("6. nothing when everyone has marked, when the alert is Off; 08:00 when chosen; people who left aren't counted", async () => {
    const a = await morning();
    for (const u of [a.p.worker, a.tapan, a.bindu]) await markAt(u, "in", `${TODAY} 07:50`);
    await runMorning(ist(`${TODAY} 10:15`));
    expect(mine(a.p.tenantId)).toEqual([]);

    const b = await morning();
    await saveNotMarkedHour(b.p.owner, { hour: null });
    await runMorning(ist(`${TODAY} 11:15`));
    expect(mine(b.p.tenantId)).toEqual([]);

    const c = await morning();
    await saveNotMarkedHour(c.p.owner, { hour: 8 });
    platform.contacts = [...contactsFor(c.p.owner, c.bindu, c.sunil)]; // Ramu and Tapan have left
    await runMorning(ist(`${TODAY} 08:40`));
    expect(mine(c.p.tenantId)).toEqual([expect.objectContaining({ title: "1 person not marked by 08:00", body: "Bindu" })]);
  });

  it("7. more than five names: the first five, then +N", async () => {
    const s = await morning();
    const extra = ["Anmol", "Dillip", "Gaja", "Joshna", "Kedar"].map((n) => atUser(s.p.tenantId, ["plant_staff"], n));
    platform.contacts = [...contactsFor(s.p.owner, s.p.worker, s.bindu, ...extra)];
    await runMorning(ist(`${TODAY} 10:15`));
    expect(mine(s.p.tenantId)[0]).toMatchObject({ title: "7 people not marked by 10:00", body: "Anmol, Bindu, Dillip, Gaja, Joshna +2" });
  });

  it("8. when PlantOps is down the alert waits in the outbox and the next run sends it", async () => {
    const s = await morning();
    platform.notifyStatus = 503;
    await runMorning(ist(`${TODAY} 10:15`));
    const kept = await asOwner<{ sent_at: Date | null }>("select sent_at from attendance_salary.notification_outbox where tenant_id = $1", [s.p.tenantId]);
    expect(kept.rows).toEqual([{ sent_at: null }]);
    platform.notifyStatus = 201;
    await runMorning(ist(`${TODAY} 10:20`));
    const after = await asOwner<{ sent_at: Date | null }>("select sent_at from attendance_salary.notification_outbox where tenant_id = $1", [s.p.tenantId]);
    expect(after.rows[0]!.sent_at).not.toBeNull();
  });
});

describe("the Supervisor marks and fixes the Office staff (owner, 2026-10-19)", () => {
  const DAY = "2026-09-14";
  /** + Mohan (Office staff + Plant staff, tracked) and Gopal (Office staff + Supervisor + Plant staff). */
  async function withOffice() {
    const s = await setup();
    const mohan = atUser(s.p.tenantId, ["office_staff", "plant_staff"], "Mohan");
    const gopal = atUser(s.p.tenantId, ["office_staff", "supervisor", "plant_staff"], "Gopal");
    platform.contacts = [...(platform.contacts ?? []), ...contactsFor(mohan, gopal)];
    return { ...s, mohan, gopal };
  }

  it("10. Mark for someone: only the tracked Office staff, never a worker or themselves", async () => {
    const { p, sunil, tapan, bindu, mohan, gopal } = await withOffice();
    expect((await deskList(sunil)).people.map((x) => x.name)).toEqual(["Gopal", "Mohan"]);
    expect((await deskList(gopal)).people.map((x) => [x.name, x.self])).toContainEqual(["Bindu", false]); // Gopal is Office staff too: everyone
    const saved = await deskMark(sunil, { user_id: mohan.userId, expect: "in", location: at(40) });
    expect(saved).toMatchObject({ kind: "in", person: { name: "Mohan" } });
    expect((await refusal(() => deskMark(sunil, { user_id: bindu.userId, expect: "in", location: at(40) }))).status).toBe(404);
    expect((await refusal(() => deskMark(tapan, { user_id: tapan.userId, expect: "in", location: at(40) }))).message).toBe("Scan the QR for your own attendance");
    expect((await refusal(() => deskMark(sunil, { user_id: gopal.userId, expect: "in", location: at(1200) }))).status).toBe(403); // the location rules of a scan
    expect((await recentChanges(p.owner))[0]).toMatchObject({ by: "Sunil (supervisor)" });
    expect((await boardFor(p.tenantId)).inside).toEqual([expect.objectContaining({ name: "Mohan", by: "Sunil" })]);
  });

  it("11. Fix (add and cancel) for Office staff; workers 404; never their own; the owners' bell and the person's 'corrected'", async () => {
    const { p, sunil, bindu, mohan, gopal } = await withOffice();
    const id = await markAt(mohan, "in", `${DAY} 09:10`);
    signInAs(sunil);
    const add = { user_id: mohan.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot to mark", expect: await dayStamp(sunil, mohan.userId, DAY) };
    expect((await addRoute.POST(jsonReq("POST", "/api/fix/add", add), undefined as never)).status).toBe(201);
    expect((await dayFor(sunil, mohan.userId, DAY)).day.entries).toHaveLength(1);
    const cancel = { punch_id: id, day: DAY, reason: "came at 10", expect: await dayStamp(sunil, mohan.userId, DAY) };
    expect((await cancelRoute.POST(jsonReq("POST", "/api/fix/cancel", cancel), undefined as never)).status).toBe(201);
    // a worker: "not found" everywhere, as if they didn't exist
    const w = await markAt(bindu, "in", `${DAY} 09:10`);
    for (const fn of [
      () => dayStamp(sunil, bindu.userId, DAY),
      () => dayFor(sunil, bindu.userId, DAY),
      () => monthFor(sunil, bindu.userId, null),
      () => monthStatuses(sunil, bindu.userId, DAY.slice(0, 7), new Map()),
      () => addFix(sunil, { user_id: bindu.userId, day: DAY, kind: "out", date: DAY, time: "18:30", reason: "forgot", expect: "x" }),
      () => cancelFix(sunil, { punch_id: w, day: DAY, reason: "wrong one", expect: "x" }),
    ])
      expect((await refusal(fn)).status).toBe(404);
    // a Supervisor who is also Office staff: never their own
    const own = await markAt(gopal, "in", `${DAY} 09:00`);
    expect((await refusal(() => cancelFix(gopal, { punch_id: own, day: DAY, reason: "wrong one", expect: "x" }))).message).toBe("Ask the owner to fix your own attendance");
    await settle();
    const kinds = sent(p.tenantId).map((n) => n.kind);
    expect(kinds.filter((k) => k === "attendance_salary.desk_fix")).toHaveLength(2);
    expect(sent(p.tenantId, "attendance_salary.desk_fix")[0]).toMatchObject({ title: "Sunil changed Mohan's attendance" });
    expect(kinds.filter((k) => k === "attendance_salary.corrected")).toHaveLength(2);
    const changes = await recentChanges(p.owner);
    expect(changes.filter((c) => c.by === "Sunil (supervisor)")).toHaveLength(2);
  });

  it("12. the Staff list, calendar and Today links: only the Office staff", async () => {
    const { p, sunil, mohan, gopal } = await withOffice();
    expect((await staffList(sunil)).active.map((x) => x.name)).toEqual(["Gopal", "Mohan"]);
    expect((await monthFor(sunil, mohan.userId, null)).name).toBe("Mohan");
    expect((await refusal(() => monthFor(sunil, p.worker.userId, null))).status).toBe(404);
    const board = await todayBoard(sunil);
    const hrefs = links(TodayView({ user: sunil, board, reach: new Set([mohan.userId, gopal.userId]) }));
    expect(hrefs.sort()).toEqual([`/staff/${gopal.userId}/${TODAY}`, `/staff/${mohan.userId}/${TODAY}`].sort());
  });
});

describe("the owner's Settings choice", () => {
  it("9. 08:00-11:00 or Off, owner only, in Recent changes; support reads it", async () => {
    const { p, sunil } = await setup();
    expect((await settingsFor(p.owner)).not_marked_hour).toBe(10);
    signInAs(p.owner);
    const put = (hour: unknown) => notMarkedRoute.PUT(jsonReq("PUT", "/api/settings/not-marked", { hour }), undefined as never);
    expect((await put(7)).status).toBe(400);
    expect((await put(12)).status).toBe(400);
    expect((await put(8)).status).toBe(200);
    expect((await settingsFor(p.support)).not_marked_hour).toBe(8);
    expect((await refusal(() => saveNotMarkedHour(sunil, { hour: 9 }))).status).toBe(403);
    expect((await refusal(() => saveNotMarkedHour(p.support, { hour: 9 }))).message).toBe("PlantOps support view is read-only");
    const { rows } = await asOwner<{ action: string; details: Record<string, unknown> }>("select action, details from attendance_salary.audit_log where tenant_id = $1 and action = 'settings.not_marked'", [p.tenantId]);
    expect(rows.map((r) => describeChange(r.action, r.details))).toEqual(["Not-marked alert 10:00 → 08:00"]);
  });
});

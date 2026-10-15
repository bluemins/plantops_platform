// Attendance Phase 1 (docs/ATTENDANCE_PHASE_PLAN.md): the platform knows the module's tile and notification kinds, and
// its alerts are OWNER-ONLY - nobody can be ticked for them, so a worker never gets a bell about a colleague's
// attendance. An event about one worker (also_user_ids + only_listed) still reaches that worker.
import { beforeAll, describe, expect, it } from "vitest";
import { OWNER_ONLY_ALERTS, roleWorksIn } from "@plantops/types";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import { sha256 } from "@/server/crypto";
import { MODULES } from "@/lib/modules";
import { alertChoices, cellFor } from "@/lib/permissions";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const ATT_SECRET = "attendance-module-test-secret";
const OC_SECRET = "order-module-test-secret";
const ATT = { authorization: "Basic " + btoa(`attendance_salary:${ATT_SECRET}`) };

let A: Awaited<ReturnType<typeof makePlant>>;
let worker: Awaited<ReturnType<typeof makeStaff>>; // plant staff only
let other: Awaited<ReturnType<typeof makeStaff>>; // plant staff, the colleague
let keeper: Awaited<ReturnType<typeof makeStaff>>; // store keeper only

const handoff = (cookie: string, module: string) => call(handoffRoute.POST as Handler, { cookie, body: { module } });
const tick = (cookie: string, userId: string, alert_modules: string[]) =>
  call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie, params: { id: userId }, body: { alert_modules } });
const settings = async (cookie: string) =>
  (await call(settingsRoute.GET as Handler, { cookie })).body as { kind: string; urgent: boolean; bell_only: boolean }[];
const setSetting = (cookie: string, kind: string, mode: string) => call(settingsRoute.PUT as Handler, { method: "PUT", cookie, body: { kind, mode } });
let seq = 0;
const send = (tenantId: string, over: Record<string, unknown> = {}) =>
  call(moduleNotifyRoute.POST as Handler, {
    headers: ATT,
    params: { tid: tenantId },
    body: { kind: "attendance_salary.outside", title: `Attendance ${++seq}`, dedupe_key: `att:${seq}`, ...over },
  });
const titles = async (cookie: string) => (await call(inboxRoute.GET as Handler, { cookie })).body.items.map((n: { title: string }) => n.title) as string[];
/** A "Gets alerts" row the API would refuse, written straight into the table (e.g. left over from before). */
const strayTick = (tenantId: string, userId: string, by: string) =>
  asOwner("insert into platform.alert_recipients (tenant_id, user_id, module_id, added_by) values ($1, $2, 'attendance_salary', $3)", [tenantId, userId, by]);

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://attendance.example.test', client_secret_hash = $1, status = 'active' where id = 'attendance_salary'", [sha256(ATT_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://orders.example.test', client_secret_hash = $1, status = 'active' where id = 'order_capture'", [sha256(OC_SECRET)]);
  A = await makePlant({ modules: ["attendance_salary"] });
  worker = await makeStaff(A, "worker", ["plant_staff"]);
  other = await makeStaff(A, "other", ["plant_staff"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
  await strayTick(A.tenantId, other.userId, A.adminUserId);
});

describe("module, role and tile", () => {
  it("plant staff work in Attendance; a store keeper doesn't", async () => {
    expect(roleWorksIn("plant_staff", "attendance_salary")).toBe(true);
    expect(roleWorksIn("store_keeper", "attendance_salary")).toBe(false);
    expect((await handoff(worker.cookie, "attendance_salary")).status).toBe(200);
    expect((await handoff(keeper.cookie, "attendance_salary")).status).toBe(403);
  });

  it("tile text and the owner's setup link", () => {
    expect(MODULES.attendance_salary).toMatchObject({ label: "Attendance & Salary", staff: "Mark attendance", setup: { label: "⚙ Location & QR", path: "/settings" } });
    expect(OWNER_ONLY_ALERTS).toEqual(["attendance_salary"]);
  });

  it("a Plant-staff-only user lands straight in Attendance; with Order Capture also on, the tile screen", async () => {
    const mine = await call(launcherRoute.GET as Handler, { cookie: worker.cookie });
    expect(mine.body.tiles).toEqual([{ module: "attendance_salary", state: "open", view: "staff" }]);
    expect(mine.body.landing).toBe("attendance_salary");
    const Q = await makePlant({ modules: ["attendance_salary", "order_capture"] });
    const both = await makeStaff(Q, "worker", ["plant_staff"]);
    const r = await call(launcherRoute.GET as Handler, { cookie: both.cookie });
    expect(r.body.tiles.map((t: { module: string }) => t.module).sort()).toEqual(["attendance_salary", "order_capture"]);
    expect(r.body.landing).toBe("launcher");
  });
});

describe("owner-only alerts", () => {
  it("the 'Gets alerts' tick box never offers Attendance", () => {
    expect(alertChoices(["attendance_salary", "floor_stock"], ["plant_staff"])).toEqual([]);
    expect(alertChoices(["attendance_salary", "floor_stock"], ["plant_staff", "store_keeper"])).toEqual(["floor_stock"]);
  });

  it("the API refuses an Attendance tick: edit, add and super_admin", async () => {
    const r = await tick(A.adminCookie, worker.userId, ["attendance_salary"]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only owners get Attendance alerts/);
    const added = await call(adminUsersRoute.POST as Handler, {
      cookie: A.adminCookie,
      body: { username: "ticked", display_name: "Ticked", roles: ["plant_staff"], alert_modules: ["attendance_salary"] },
    });
    expect(added.status).toBe(400);
    const sa = await makeSuperAdmin();
    const s = await call(superUserRoute.PATCH as Handler, { method: "PATCH", cookie: sa.cookie, params: { id: A.tenantId, userId: worker.userId }, body: { alert_modules: ["attendance_salary"] } });
    expect(s.status).toBe(400);
  });

  it("a ticked row (left over) gets nothing: Attendance events about others go to owners only", async () => {
    const r = await send(A.tenantId);
    expect(r.body).toEqual({ recipients: 1, created: 1 }); // the owner only
    const t = `Attendance ${seq}`;
    expect(await titles(A.adminCookie)).toContain(t);
    expect(await titles(other.cookie)).not.toContain(t);
    expect(await titles(worker.cookie)).not.toContain(t);
  });

  it("also_user_ids + only_listed still reach the worker it is about, and no one else", async () => {
    const r = await send(A.tenantId, { kind: "attendance_salary.corrected", also_user_ids: [worker.userId], only_listed: true, exclude_user_id: A.adminUserId });
    expect(r.body).toEqual({ recipients: 1, created: 1 });
    const t = `Attendance ${seq}`;
    expect(await titles(worker.cookie)).toContain(t);
    expect(await titles(other.cookie)).not.toContain(t);
    expect(await titles(A.adminCookie)).not.toContain(t);
  });

  it("a ticked row doesn't turn on the launcher's 'phone alerts' card", async () => {
    const me = async (cookie: string) => (await call(launcherRoute.GET as Handler, { cookie })).body.user.gets_alerts;
    expect(await me(other.cookie)).toBe(false);
    expect(await me(A.adminCookie)).toBe(true);
  });

  it("an unrelated save drops the left-over row quietly", async () => {
    const Q = await makePlant({ modules: ["attendance_salary"] });
    const p = await makeStaff(Q, "pworker", ["plant_staff"]);
    await strayTick(Q.tenantId, p.userId, Q.adminUserId);
    const r = await call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie: Q.adminCookie, params: { id: p.userId }, body: { roles: ["plant_staff"] } });
    expect(r.status).toBe(200);
    const { rows } = await asOwner<{ n: number }>("select count(*)::int as n from platform.alert_recipients where user_id = $1", [p.userId]);
    expect(rows[0]!.n).toBe(0);
  });

  it("the Permissions screen shows no 🔔 for staff in Attendance, even with a ticked row; owners keep theirs", () => {
    expect(cellFor(["plant_staff"], ["attendance_salary"], "attendance_salary")).toMatchObject({ kind: "work", alerts: false });
    expect(cellFor(["tenant_admin"], [], "attendance_salary")).toMatchObject({ kind: "owner", alerts: true });
    expect(cellFor(["store_keeper"], ["floor_stock"], "floor_stock")).toMatchObject({ alerts: true }); // other modules unchanged
  });
});

describe("notification settings", () => {
  it("the owner sees the three Attendance kinds; outside and no exit are bell only, none urgent", async () => {
    const list = (await settings(A.adminCookie)).filter((s) => s.kind.startsWith("attendance_salary."));
    expect(list.map((s) => s.kind).sort()).toEqual(["attendance_salary.corrected", "attendance_salary.no_exit", "attendance_salary.outside"]);
    expect(list.filter((s) => s.bell_only).map((s) => s.kind).sort()).toEqual(["attendance_salary.no_exit", "attendance_salary.outside"]);
    expect(list.some((s) => s.urgent)).toBe(false);
  });

  it("a worker sees only the kind about themselves, and can't set the owners' kinds", async () => {
    expect((await settings(worker.cookie)).map((s) => s.kind)).toEqual(["attendance_salary.corrected"]);
    expect((await setSetting(worker.cookie, "attendance_salary.corrected", "bell")).status).toBe(200);
    expect((await setSetting(worker.cookie, "attendance_salary.outside", "off")).status).toBe(400);
    expect((await setSetting(worker.cookie, "attendance_salary.corrected", "push")).status).toBe(200);
  });

  it("a store keeper, and an owner of a plant without Attendance, see none of its kinds", async () => {
    expect((await settings(keeper.cookie)).some((s) => s.kind.startsWith("attendance_salary."))).toBe(false);
    const Q = await makePlant({ modules: ["floor_stock"] });
    expect((await settings(Q.adminCookie)).some((s) => s.kind.startsWith("attendance_salary."))).toBe(false);
  });
});

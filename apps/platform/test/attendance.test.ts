// Attendance Phase 1 (docs/ATTENDANCE_PHASE_PLAN.md): the platform knows the module's tile and notification kinds, and
// its alerts are OWNER-ONLY - nobody can be ticked for them, so a worker never gets a bell about a colleague's
// attendance. An event about one worker (also_user_ids + only_listed) still reaches that worker.
import { beforeAll, describe, expect, it } from "vitest";
import { OWNER_ONLY_ALERTS, ROLE_IDS, ROLE_MODULE, VIEW_ROLE_MODULE, roleWorksIn, type ViewRole } from "@plantops/types";
import { getAlertContacts } from "@/server/sso";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import * as superPlanRoute from "@/app/api/super/tenants/[id]/plan/route";
import * as planRoute from "@/app/api/tenants/[id]/plan/route";
import { emptyPlan, moduleLimitFormValues, planBody } from "@/lib/plan-body";
import { sha256 } from "@/server/crypto";
import { MODULES } from "@/lib/modules";
import { alertChoices, cellFor, roleChoices } from "@/lib/permissions";
import { decideTiles, landingFor } from "@/server/launcher";
import { summaryViewFor } from "@/server/summary";
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
  it("the owner sees eleven Attendance kinds (not every scan); outside, no exit and desk fix are bell only, none urgent", async () => {
    const list = (await settings(A.adminCookie)).filter((s) => s.kind.startsWith("attendance_salary."));
    // docs/ATTENDANCE_ROLES_PHASE_PLAN.md: advance given, office fix and not marked for owners; every scan goes to supervisors only
    expect(list.map((s) => s.kind).sort()).toEqual([
      "attendance_salary.advance_given", "attendance_salary.claim_decided", "attendance_salary.claim_new", "attendance_salary.corrected",
      "attendance_salary.desk_fix", "attendance_salary.no_exit", "attendance_salary.not_marked", "attendance_salary.outside",
      "attendance_salary.salary_paid", "attendance_salary.salary_review", "attendance_salary.storage",
    ]);
    expect(list.filter((s) => s.bell_only).map((s) => s.kind).sort()).toEqual(["attendance_salary.desk_fix", "attendance_salary.no_exit", "attendance_salary.outside"]);
    expect(list.some((s) => s.urgent)).toBe(false);
  });

  it("a worker sees only the kinds about themselves, and can't set the owners' kinds", async () => {
    expect((await settings(worker.cookie)).map((s) => s.kind).sort()).toEqual(["attendance_salary.claim_decided", "attendance_salary.corrected", "attendance_salary.salary_paid"]);
    expect((await setSetting(worker.cookie, "attendance_salary.claim_new", "off")).status).toBe(400); // owners' kind
    expect((await setSetting(worker.cookie, "attendance_salary.salary_paid", "bell")).status).toBe(200);
    expect((await setSetting(worker.cookie, "attendance_salary.salary_review", "off")).status).toBe(400);
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

describe("Attendance storage limit on the plan (Salary extras Part B: bill photos)", () => {
  it("planBody sets and clears it, keeps the other limits, and the module reads it back", async () => {
    const v = { ...emptyPlan, enabled_modules: ["attendance_salary", "complaint_box"], cb_storage_mb: "500", att_storage_mb: "200" };
    expect(planBody(v).limits.modules).toEqual({ complaint_box: { storage_mb: 500 }, attendance_salary: { storage_mb: 200 } });
    expect(planBody({ ...v, att_storage_mb: "" }, { attendance_salary: { storage_mb: 5 } }).limits.modules).toEqual({ complaint_box: { storage_mb: 500 } });

    const sa = await makeSuperAdmin();
    const P = await makePlant({ modules: ["attendance_salary"] });
    const body = planBody({ ...emptyPlan, enabled_modules: ["attendance_salary"], att_storage_mb: "200" });
    expect((await call(superPlanRoute.PUT as Handler, { cookie: sa.cookie, method: "PUT", body, params: { id: P.tenantId } })).status).toBe(200);
    const plan = await call(planRoute.GET as Handler, { headers: ATT, params: { id: P.tenantId } });
    expect(plan.body.limits.modules.attendance_salary).toEqual({ storage_mb: 200 });
    expect(moduleLimitFormValues(plan.body.limits.modules).att_storage_mb).toBe("200");
  });
});

describe("Office staff and Supervisor (docs/ATTENDANCE_ROLES_PHASE_PLAN.md, migration 0015)", () => {
  it("the roles table holds every role in packages/types, each tied to its module", async () => {
    const { rows } = await asOwner<{ id: string; module_id: string | null }>("select id, module_id from platform.roles");
    const db = new Map(rows.map((r) => [r.id, r.module_id]));
    for (const role of ROLE_IDS) {
      expect(db.has(role), role).toBe(true);
      if (role in VIEW_ROLE_MODULE) expect(db.get(role), role).toBe(VIEW_ROLE_MODULE[role as ViewRole]);
      else if (role !== "tenant_admin" && role !== "plant_staff") expect(db.get(role), role).toBe(ROLE_MODULE[role as keyof typeof ROLE_MODULE]);
    }
    expect(db.get("office_staff")).toBe("attendance_salary");
    expect(db.get("supervisor")).toBe("attendance_salary");
  });

  it("an Office staff user can be created, opens Attendance and is in its contacts (the module decides who is tracked)", async () => {
    const office = await makeStaff(A, "office", ["office_staff"]);
    const supervisor = await makeStaff(A, "supervisor", ["supervisor"]);
    const contacts = await getAlertContacts("attendance_salary", A.tenantId);
    expect(contacts.find((c) => c.user_id === office.userId)?.roles).toEqual(["office_staff"]);
    expect(contacts.find((c) => c.user_id === supervisor.userId)?.roles).toEqual(["supervisor"]);
    expect((await handoff(office.cookie, "attendance_salary")).status).toBe(200);
    expect((await handoff(office.cookie, "floor_stock")).status).toBe(403);
  });
});

describe("platform screens for Office staff and Supervisor (docs/ATTENDANCE_ROLES_PHASE_PLAN.md R5)", () => {
  const avail = ["attendance_salary", "document_store"].map((id) => ({ id, status: "active", baseUrl: "https://x.test", clientSecretHash: "h" }));

  it("role buttons say what each role does, and only show with Attendance switched on", () => {
    const on = roleChoices(["attendance_salary", "floor_stock"], []);
    expect(on.find((c) => c.role === "office_staff")).toEqual({ role: "office_staff", label: "Office staff", hint: "Attendance: marks for others, fixes times, advances (no salaries)", off: false });
    expect(on.find((c) => c.role === "supervisor")).toEqual({ role: "supervisor", label: "Supervisor", hint: "Attendance: Today board, IN / OUT alerts, marks and fixes Office staff", off: false });
    const off = roleChoices(["floor_stock"], []);
    expect(off.some((c) => c.role === "office_staff" || c.role === "supervisor")).toBe(false);
    expect(roleChoices(["floor_stock"], ["supervisor"]).find((c) => c.role === "supervisor")).toMatchObject({ off: true, hint: "Attendance & Salary · not switched on" });
  });

  it("launcher: their own tile line; one module = straight in; Office staff + Document keeper see the tile screen", () => {
    const office = decideTiles(["office_staff"], ["attendance_salary", "document_store"], avail);
    expect(office).toEqual([{ module: "attendance_salary", state: "open", view: "staff", subtitle: "Attendance desk" }]);
    expect(landingFor(["office_staff"], office)).toBe("attendance_salary");
    expect(decideTiles(["supervisor", "plant_staff"], ["attendance_salary"], avail)[0]).toMatchObject({ subtitle: "Today board" });
    expect(decideTiles(["plant_staff"], ["attendance_salary"], avail)[0]).not.toHaveProperty("subtitle"); // "Mark attendance" as before
    const both = decideTiles(["office_staff", "document_keeper"], ["attendance_salary", "document_store"], avail);
    expect(both.map((t) => t.module).sort()).toEqual(["attendance_salary", "document_store"]);
    expect(landingFor(["office_staff", "document_keeper"], both)).toBe("launcher");
  });

  it("tile numbers: 'desk' for Office staff / Supervisor in Attendance only; owner and workers as before", () => {
    expect(summaryViewFor(["office_staff"], "attendance_salary")).toBe("desk");
    expect(summaryViewFor(["supervisor", "plant_staff"], "attendance_salary")).toBe("desk");
    expect(summaryViewFor(["plant_staff"], "attendance_salary")).toBe("staff");
    expect(summaryViewFor(["office_staff", "document_keeper"], "document_store")).toBe("staff");
    expect(summaryViewFor(["tenant_admin", "supervisor"], "attendance_salary")).toBe("owner");
  });

  it("notification settings: a Supervisor gets scan + not marked; Office staff none of Attendance's; with Plant staff, also the kinds about them", async () => {
    const sup = await makeStaff(A, "sup2", ["supervisor"]);
    const supWorker = await makeStaff(A, "sup3", ["supervisor", "plant_staff"]);
    const office = await makeStaff(A, "office2", ["office_staff"]);
    const officeWorker = await makeStaff(A, "office3", ["office_staff", "plant_staff"]);
    const att = async (cookie: string) => (await settings(cookie)).map((s) => s.kind).filter((k) => k.startsWith("attendance_salary.")).sort();
    expect(await att(sup.cookie)).toEqual(["attendance_salary.not_marked", "attendance_salary.scan"]);
    expect(await att(supWorker.cookie)).toEqual([
      "attendance_salary.claim_decided", "attendance_salary.corrected", "attendance_salary.not_marked", "attendance_salary.salary_paid", "attendance_salary.scan",
    ]);
    expect(await att(office.cookie)).toEqual([]);
    expect(await att(officeWorker.cookie)).toEqual(["attendance_salary.claim_decided", "attendance_salary.corrected", "attendance_salary.salary_paid"]);
    expect((await setSetting(sup.cookie, "attendance_salary.scan", "off")).status).toBe(200);
    expect((await setSetting(sup.cookie, "attendance_salary.advance_given", "off")).status).toBe(400); // owners' kind
    expect((await setSetting(A.adminCookie, "attendance_salary.scan", "off")).status).toBe(400); // owners never get every scan
  });

  it("Permissions grid: Office staff and Supervisor in the Attendance column; the bell for supervisors only", () => {
    expect(cellFor(["office_staff", "plant_staff"], [], "attendance_salary")).toEqual({ kind: "work", label: "Office staff", alerts: false });
    expect(cellFor(["supervisor"], [], "attendance_salary")).toEqual({ kind: "work", label: "Supervisor", alerts: true });
    expect(cellFor(["office_staff", "supervisor", "plant_staff"], [], "attendance_salary")).toEqual({ kind: "work", label: "Office staff, Supervisor", alerts: true });
    expect(cellFor(["supervisor"], [], "floor_stock")).toBeNull();
  });
});


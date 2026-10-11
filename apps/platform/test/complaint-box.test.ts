// Complaint Box Phase 1 (docs/COMPLAINT_BOX_PHASE_PLAN.md): the platform knows the module and the "Complaint desk"
// role, its storage limit is on the plan, and its notification kinds and alert tick boxes work like other modules'.
import { beforeAll, describe, expect, it } from "vitest";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import * as superPlanRoute from "@/app/api/super/tenants/[id]/plan/route";
import * as planRoute from "@/app/api/tenants/[id]/plan/route";
import { sha256 } from "@/server/crypto";
import { emptyPlan, moduleLimitFormValues, planBody } from "@/lib/plan-body";
import { ROLE_LABELS } from "@/lib/api";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const CB_SECRET = "complaint-module-test-secret";
const CB = { authorization: "Basic " + btoa(`complaint_box:${CB_SECRET}`) };

let A: Awaited<ReturnType<typeof makePlant>>;
let desk: Awaited<ReturnType<typeof makeStaff>>;
let general: Awaited<ReturnType<typeof makeStaff>>;
let keeper: Awaited<ReturnType<typeof makeStaff>>;

const handoff = (cookie: string, module: string) => call(handoffRoute.POST as Handler, { cookie, body: { module } });
const tick = (cookie: string, userId: string, alert_modules: string[]) =>
  call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie, params: { id: userId }, body: { alert_modules } });
const settings = async (cookie: string) =>
  (await call(settingsRoute.GET as Handler, { cookie })).body as { kind: string; urgent: boolean; bell_only: boolean }[];

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://complaints.example.test', client_secret_hash = $1 where id = 'complaint_box'", [sha256(CB_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "complaint_box"] });
  desk = await makeStaff(A, "desk", ["complaint_desk"]);
  general = await makeStaff(A, "general", ["plant_staff"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
});

describe("module and role", () => {
  it("the Complaint desk role exists with its label", () => {
    expect(ROLE_LABELS.complaint_desk).toBe("Complaint desk");
  });

  it("complaint desk and plant staff open Complaint Box; a store keeper doesn't", async () => {
    expect((await handoff(desk.cookie, "complaint_box")).status).toBe(200);
    expect((await handoff(desk.cookie, "floor_stock")).status).toBe(403);
    expect((await handoff(general.cookie, "complaint_box")).status).toBe(200);
    expect((await handoff(keeper.cookie, "complaint_box")).status).toBe(403);
  });

  it("only when the plant's plan includes it", async () => {
    const Q = await makePlant({ modules: ["floor_stock"] });
    const noPlan = await makeStaff(Q, "desk", ["complaint_desk"]);
    expect((await handoff(noPlan.cookie, "complaint_box")).status).toBe(403);
  });

  it("a complaint-desk-only user lands straight in Complaint Box; the owner sees its tile", async () => {
    const mine = await call(launcherRoute.GET as Handler, { cookie: desk.cookie });
    expect(mine.body.landing).toBe("complaint_box");
    expect(mine.body.tiles).toEqual([{ module: "complaint_box", state: "open", view: "staff" }]);
    const owner = await call(launcherRoute.GET as Handler, { cookie: A.adminCookie });
    expect(owner.body.tiles.find((t: { module: string }) => t.module === "complaint_box")).toMatchObject({ state: "open", view: "owner" });
    expect(owner.body.plan_summary.modules_total).toBe(8);
  });
});

describe("storage limit on the plan", () => {
  it("planBody sets and clears it and keeps the other limits", () => {
    const v = { ...emptyPlan, enabled_modules: ["document_store", "complaint_box"], doc_storage_mb: "1024", cb_storage_mb: "500" };
    expect(planBody(v).limits.modules).toEqual({ document_store: { storage_mb: 1024 }, complaint_box: { storage_mb: 500 } });
    expect(planBody({ ...v, cb_storage_mb: "" }, { complaint_box: { storage_mb: 5 } }).limits.modules).toEqual({ document_store: { storage_mb: 1024 } });
  });

  it("super_admin saves it, the module reads it, and the plan screen shows it again", async () => {
    const sa = await makeSuperAdmin();
    const P = await makePlant({ modules: ["complaint_box"] });
    const body = planBody({ ...emptyPlan, enabled_modules: ["complaint_box"], cb_storage_mb: "500" });
    expect((await call(superPlanRoute.PUT as Handler, { cookie: sa.cookie, method: "PUT", body, params: { id: P.tenantId } })).status).toBe(200);
    const plan = await call(planRoute.GET as Handler, { headers: CB, params: { id: P.tenantId } });
    expect(plan.body.limits.modules.complaint_box).toEqual({ storage_mb: 500 });
    expect(moduleLimitFormValues(plan.body.limits.modules).cb_storage_mb).toBe("500");
  });
});

describe("alerts and notification settings", () => {
  it("the 'Gets alerts' tick box offers Complaint Box to the people who work in it", async () => {
    expect((await tick(A.adminCookie, desk.userId, ["complaint_box"])).body.alert_modules).toEqual(["complaint_box"]);
    expect((await tick(A.adminCookie, general.userId, ["floor_stock", "complaint_box"])).body.alert_modules.sort()).toEqual(["complaint_box", "floor_stock"]);
    expect((await tick(A.adminCookie, keeper.userId, ["complaint_box"])).status).toBe(400); // doesn't work in it
    const Q = await makePlant({ modules: ["floor_stock"] });
    const off = await makeStaff(Q, "desk", ["complaint_desk"]);
    expect((await tick(Q.adminCookie, off.userId, ["complaint_box"])).status).toBe(400); // not switched on
  });

  it("the settings page lists the six Complaint Box kinds; 'updated' is bell only, none urgent", async () => {
    const list = (await settings(desk.cookie)).filter((s) => s.kind.startsWith("complaint_box."));
    expect(list.map((s) => s.kind).sort()).toEqual(
      ["complaint_box.new", "complaint_box.reopened", "complaint_box.resolved", "complaint_box.still_open", "complaint_box.storage", "complaint_box.updated"],
    );
    expect(list.filter((s) => s.bell_only).map((s) => s.kind)).toEqual(["complaint_box.updated"]);
    expect(list.some((s) => s.urgent)).toBe(false);
    expect((await settings(desk.cookie)).every((s) => s.kind.startsWith("complaint_box."))).toBe(true);
    expect((await settings(A.adminCookie)).some((s) => s.kind.startsWith("complaint_box."))).toBe(true);
  });

  it("an owner of a plant without Complaint Box sees none of its kinds", async () => {
    const Q = await makePlant({ modules: ["floor_stock"] });
    expect((await settings(Q.adminCookie)).some((s) => s.kind.startsWith("complaint_box."))).toBe(false);
  });
});

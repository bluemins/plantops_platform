// Job applications Phase 1 (docs/JOB_APPLICATIONS_PHASE_PLAN.md): the platform knows the module and the "HR desk"
// role, plant staff are kept out of it, its notification kinds and alert tick boxes work like other modules', and the
// public page's plant lookup answers only Job applications and gives one identical 404 for every refusal.
import { beforeAll, describe, expect, it } from "vitest";
import { roleWorksIn } from "@plantops/types";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as launcherRoute from "@/app/api/launcher/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import * as byCodeRoute from "@/app/api/m/plants/by-code/[code]/route";
import { sha256 } from "@/server/crypto";
import { ROLE_LABELS } from "@/lib/api";
import { MODULES } from "@/lib/modules";
import { cellFor, roleChoices } from "@/lib/permissions";
import { moduleLimitFormValues, planBody, emptyPlan } from "@/lib/plan-body";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const JOBS_SECRET = "jobs-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";

let A: Awaited<ReturnType<typeof makePlant>>;
let hr: Awaited<ReturnType<typeof makeStaff>>;
let general: Awaited<ReturnType<typeof makeStaff>>;
let keeper: Awaited<ReturnType<typeof makeStaff>>;

const handoff = (cookie: string, module: string) => call(handoffRoute.POST as Handler, { cookie, body: { module } });
const tick = (cookie: string, userId: string, alert_modules: string[]) =>
  call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie, params: { id: userId }, body: { alert_modules } });
const settings = async (cookie: string) =>
  (await call(settingsRoute.GET as Handler, { cookie })).body as { kind: string; urgent: boolean; bell_only: boolean }[];
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const lookup = (code: string, authorization: string | null = basic("job_applications", JOBS_SECRET)) =>
  call(byCodeRoute.GET as Handler, { params: { code }, headers: authorization ? { authorization } : {} });

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://jobs.example.test', client_secret_hash = $1, status = 'active' where id = 'job_applications'", [sha256(JOBS_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1, status = 'active' where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "job_applications"] });
  hr = await makeStaff(A, "hr", ["hr_desk"]);
  general = await makeStaff(A, "general", ["plant_staff"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
});

describe("module and role", () => {
  it("the HR desk role, its button text and the tile text exist", () => {
    expect(ROLE_LABELS.hr_desk).toBe("HR desk");
    expect(MODULES.job_applications).toMatchObject({ label: "Job applications", icon: "📋", staff: "Applications", setup: { label: "⚙ Openings", path: "/openings" } });
    expect(roleChoices(["job_applications"], []).find((c) => c.role === "hr_desk")).toMatchObject({ hint: "Job applications: see and call applicants", off: false });
    expect(roleWorksIn("hr_desk", "job_applications")).toBe(true);
    expect(roleWorksIn("plant_staff", "job_applications")).toBe(false);
    expect(roleWorksIn("store_keeper", "job_applications")).toBe(false);
  });

  it("HR desk opens Job applications; plant staff and a store keeper don't", async () => {
    expect((await handoff(hr.cookie, "job_applications")).status).toBe(200);
    expect((await handoff(hr.cookie, "floor_stock")).status).toBe(403);
    expect((await handoff(general.cookie, "job_applications")).status).toBe(403);
    expect((await handoff(keeper.cookie, "job_applications")).status).toBe(403);
  });

  it("only when the plant's plan includes it", async () => {
    const Q = await makePlant({ modules: ["floor_stock"] });
    const noPlan = await makeStaff(Q, "hr", ["hr_desk"]);
    expect((await handoff(noPlan.cookie, "job_applications")).status).toBe(403);
  });

  it("an HR-desk-only user lands straight in Job applications; the owner sees its tile", async () => {
    const mine = await call(launcherRoute.GET as Handler, { cookie: hr.cookie });
    expect(mine.body.landing).toBe("job_applications");
    expect(mine.body.tiles).toEqual([{ module: "job_applications", state: "open", view: "staff" }]);
    const owner = await call(launcherRoute.GET as Handler, { cookie: A.adminCookie });
    expect(owner.body.tiles.find((t: { module: string }) => t.module === "job_applications")).toMatchObject({ state: "open", view: "owner" });
  });

  it("the plan screen has a storage limit for it", () => {
    const body = planBody({ ...emptyPlan, jobs_storage_mb: "200" });
    expect(body.limits.modules).toEqual({ job_applications: { storage_mb: 200 } });
    expect(moduleLimitFormValues(body.limits.modules).jobs_storage_mb).toBe("200");
  });
});

describe("alerts, permissions and notification settings", () => {
  it("the 'Gets alerts' tick box offers Job applications to HR desk only", async () => {
    expect((await tick(A.adminCookie, hr.userId, ["job_applications"])).body.alert_modules).toEqual(["job_applications"]);
    expect((await tick(A.adminCookie, general.userId, ["job_applications"])).status).toBe(400);
    expect((await tick(A.adminCookie, keeper.userId, ["job_applications"])).status).toBe(400);
  });

  it("the Permissions grid shows HR desk, with 🔔 when ticked; plant staff have no access", () => {
    expect(cellFor(["hr_desk"], ["job_applications"], "job_applications")).toEqual({ kind: "work", label: "HR desk", alerts: true });
    expect(cellFor(["hr_desk"], [], "job_applications")).toEqual({ kind: "work", label: "HR desk", alerts: false });
    expect(cellFor(["plant_staff"], [], "job_applications")).toBeNull();
  });

  it("the settings page lists the two kinds; 'new' is bell only, none urgent", async () => {
    const list = (await settings(hr.cookie)).filter((s) => s.kind.startsWith("job_applications."));
    expect(list.map((s) => s.kind).sort()).toEqual(["job_applications.new", "job_applications.storage"]);
    expect(list.filter((s) => s.bell_only).map((s) => s.kind)).toEqual(["job_applications.new"]);
    expect(list.some((s) => s.urgent)).toBe(false);
    expect((await settings(A.adminCookie)).some((s) => s.kind.startsWith("job_applications."))).toBe(true);
    expect((await settings(general.cookie)).some((s) => s.kind.startsWith("job_applications."))).toBe(false);
  });
});

describe("GET /api/m/plants/by-code/:code (the public page's plant lookup)", () => {
  const refused = { status: 404, body: { error: "This page is not available" } };

  it("a good code answers the plant id and name only; lower case works", async () => {
    const res = await lookup(A.code);
    expect(res).toMatchObject({ status: 200, body: { tenant_id: A.tenantId, name: `Plant ${A.code}` } });
    expect(Object.keys(res.body).sort()).toEqual(["name", "tenant_id"]);
    expect((await lookup(A.code.toLowerCase())).body.tenant_id).toBe(A.tenantId);
  });

  it("unknown, malformed, module switched off and suspended plants get the same 404", async () => {
    expect(await lookup("NOSUCHPLANT")).toMatchObject(refused);
    expect(await lookup("a b")).toMatchObject(refused);
    expect(await lookup("x".repeat(33))).toMatchObject(refused);
    const off = await makePlant({ modules: ["floor_stock"] });
    expect(await lookup(off.code)).toMatchObject(refused);
    const gone = await makePlant({ modules: ["job_applications"] });
    expect((await lookup(gone.code)).status).toBe(200);
    await asOwner("update platform.tenants set status = 'suspended' where id = $1", [gone.tenantId]);
    expect(await lookup(gone.code)).toMatchObject(refused);
  });

  it("no credentials, a wrong secret and another module's real credentials get the same 404", async () => {
    expect(await lookup(A.code, null)).toMatchObject(refused);
    expect(await lookup(A.code, basic("job_applications", "wrong-secret"))).toMatchObject(refused);
    expect(await lookup(A.code, basic("floor_stock", STOCK_SECRET))).toMatchObject(refused);
    expect(await lookup(A.code, "Bearer something")).toMatchObject(refused);
  });
});

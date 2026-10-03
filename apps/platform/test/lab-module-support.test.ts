// Phase 3 platform additions for Lab Records: the "Lab lead" role, alert contacts and products for modules,
// and the Lab Records history limit on the plan.
import { beforeAll, describe, expect, it } from "vitest";
import * as handoffRoute from "@/app/api/sso/handoff/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as skusRoute from "@/app/api/admin/skus/route";
import * as alertContactsRoute from "@/app/api/m/tenants/[tid]/alert-contacts/route";
import * as moduleSkusRoute from "@/app/api/m/tenants/[tid]/skus/route";
import * as superPlanRoute from "@/app/api/super/tenants/[id]/plan/route";
import * as planRoute from "@/app/api/tenants/[id]/plan/route";
import { sha256 } from "@/server/crypto";
import { emptyPlan, labHistoryMonths, planBody } from "@/lib/plan-body";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const LAB_SECRET = "lab-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const LAB = basic("lab_records", LAB_SECRET);
const STOCK = basic("floor_stock", STOCK_SECRET);

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let lead: Awaited<ReturnType<typeof makeStaff>>;
let tech: Awaited<ReturnType<typeof makeStaff>>;
let keeper: Awaited<ReturnType<typeof makeStaff>>;

const patchUser = (cookie: string, id: string, body: unknown) =>
  call(adminUserRoute.PATCH as Handler, { cookie, method: "PATCH", body, params: { id } });

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  A = await makePlant({ modules: ["lab_records", "floor_stock"] });
  B = await makePlant({ modules: ["lab_records", "floor_stock"] });
  lead = await makeStaff(A, "lead", ["lab_lead"]);
  tech = await makeStaff(A, "tech", ["lab_technician"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
  await patchUser(A.adminCookie, lead.userId, { phone: "+919800000001" });
  await patchUser(A.adminCookie, A.adminUserId, { phone: "+919800000000" });
});

describe("Lab lead role", () => {
  it("the owner can give it; it opens Lab Records but not Floor Stock", async () => {
    const handoff = (module: string) => call(handoffRoute.POST as Handler, { cookie: lead.cookie, body: { module } });
    expect((await handoff("lab_records")).status).toBe(200);
    expect((await handoff("floor_stock")).status).toBe(403);
  });

  it("can be combined with other roles and removed again", async () => {
    expect((await patchUser(A.adminCookie, tech.userId, { roles: ["lab_technician", "lab_lead"] })).body.roles).toEqual(["lab_lead", "lab_technician"]);
    expect((await patchUser(A.adminCookie, tech.userId, { roles: ["lab_technician"] })).body.roles).toEqual(["lab_technician"]);
  });

  it("staff can't give themselves the role", async () => {
    expect((await patchUser(tech.cookie, tech.userId, { roles: ["lab_lead"] })).status).toBe(403);
  });
});

describe("alert contacts for modules", () => {
  const contacts = (tid: string, headers: Record<string, string> = LAB) => call(alertContactsRoute.GET as Handler, { headers, params: { tid } });

  it("Lab Records gets owners + lab staff with phones; never store keepers", async () => {
    const res = await contacts(A.tenantId);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.map((c: { display_name: string }) => [c.display_name, c]));
    expect(Object.keys(byName).sort()).toEqual(["Owner", "lead", "tech"]);
    expect(byName.Owner).toEqual({ user_id: A.adminUserId, display_name: "Owner", phone: "+919800000000", roles: ["tenant_admin"] });
    expect(byName.lead).toMatchObject({ phone: "+919800000001", roles: ["lab_lead"] });
    expect(byName.tech.phone).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/secret|hash/i);
  });

  it("Floor Stock gets owners + store keepers instead", async () => {
    const names = (await contacts(A.tenantId, STOCK)).body.map((c: { display_name: string }) => c.display_name).sort();
    expect(names).toEqual(["Owner", "keeper"]);
  });

  it("disabled users drop out; another plant's users never appear", async () => {
    const gone = await makeStaff(A, "gone", ["lab_technician"]);
    await patchUser(A.adminCookie, gone.userId, { status: "disabled" });
    const names = (await contacts(A.tenantId)).body.map((c: { display_name: string }) => c.display_name);
    expect(names).not.toContain("gone");
    const bNames = (await contacts(B.tenantId)).body.map((c: { user_id: string }) => c.user_id);
    expect(bNames).toEqual([B.adminUserId]);
  });

  it("requires module credentials", async () => {
    expect((await contacts(A.tenantId, {})).status).toBe(401);
    expect((await call(alertContactsRoute.GET as Handler, { cookie: A.adminCookie, params: { tid: A.tenantId } })).status).toBe(401);
  });
});

describe("products for modules", () => {
  it("returns the plant's products (incl. inactive), only that plant's, only with module credentials", async () => {
    await call(skusRoute.POST as Handler, { cookie: A.adminCookie, body: { name: "500 ml x 24", volume_ml: 500, units_per_pack: 24, pack_type: "case" } });
    const res = await call(moduleSkusRoute.GET as Handler, { headers: LAB, params: { tid: A.tenantId } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ name: "500 ml x 24", volume_ml: 500, units_per_pack: 24, pack_type: "case", status: "active" })]);
    expect((await call(moduleSkusRoute.GET as Handler, { headers: LAB, params: { tid: B.tenantId } })).body).toEqual([]);
    expect((await call(moduleSkusRoute.GET as Handler, { params: { tid: A.tenantId } })).status).toBe(401);
  });
});

describe("Lab Records history limit on the plan", () => {
  it("planBody sets and clears history_months and keeps other module limits", () => {
    const v = { ...emptyPlan, enabled_modules: ["lab_records"], lab_history_months: "12" };
    expect(planBody(v, { floor_stock: { items: 50 } }).limits.modules).toEqual({ floor_stock: { items: 50 }, lab_records: { history_months: 12 } });
    expect(planBody({ ...v, lab_history_months: "" }, { lab_records: { history_months: 12, other: 1 } }).limits.modules).toEqual({ lab_records: { other: 1 } });
    expect(planBody({ ...v, lab_history_months: "" }, { lab_records: { history_months: 12 } }).limits.modules).toEqual({});
    expect(labHistoryMonths({ lab_records: { history_months: 24 } })).toBe("24");
    expect(labHistoryMonths(undefined)).toBe("");
  });

  it("super_admin saves it and the module reads it from the plan endpoint", async () => {
    const sa = await makeSuperAdmin();
    const body = planBody({ ...emptyPlan, enabled_modules: ["lab_records", "floor_stock"], lab_history_months: "12" });
    const put = await call(superPlanRoute.PUT as Handler, { cookie: sa.cookie, method: "PUT", body, params: { id: A.tenantId } });
    expect(put.status).toBe(200);
    const plan = await call(planRoute.GET as Handler, { headers: LAB, params: { id: A.tenantId } });
    expect(plan.body.limits.modules.lab_records).toEqual({ history_months: 12 });
  });
});

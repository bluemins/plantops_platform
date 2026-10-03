// Role access: who may do what. Server-side checks, not just hidden buttons.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as superTenantsRoute from "@/app/api/super/tenants/route";
import * as superTenantRoute from "@/app/api/super/tenants/[id]/route";
import * as superPlanRoute from "@/app/api/super/tenants/[id]/plan/route";
import * as superAdminsRoute from "@/app/api/super/tenants/[id]/admins/route";
import * as superResetRoute from "@/app/api/super/tenants/[id]/users/[userId]/reset-secret/route";
import * as meRoute from "@/app/api/auth/me/route";
import { superDb } from "@/server/db";
import { call, cookieFrom, login, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

let plant: Awaited<ReturnType<typeof makePlant>>;
let staff: Awaited<ReturnType<typeof makeStaff>>;
let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;

beforeAll(async () => {
  plant = await makePlant();
  staff = await makeStaff(plant, "ramesh", ["lab_technician"]);
  sa = await makeSuperAdmin();
});

const patchUser = (cookie: string, id: string, body: unknown) =>
  call(adminUserRoute.PATCH as Handler, { cookie, method: "PATCH", body, params: { id } });

describe("staff vs owner", () => {
  it("no session -> 401; staff -> 403 on user management", async () => {
    expect((await call(adminUsersRoute.GET as Handler)).status).toBe(401);
    expect((await call(adminUsersRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(403);
    const create = await call(adminUsersRoute.POST as Handler, {
      cookie: staff.cookie,
      body: { username: "x1", display_name: "x", roles: ["tenant_admin"] },
    });
    expect(create.status).toBe(403);
    expect((await patchUser(staff.cookie, staff.userId, { roles: ["tenant_admin"] })).status).toBe(403);
  });

  it("owner and staff cannot use super_admin routes", async () => {
    for (const cookie of [plant.adminCookie, staff.cookie]) {
      expect((await call(superTenantsRoute.GET as Handler, { cookie })).status).toBe(401);
    }
  });

  it("a user can hold several roles", async () => {
    const multi = await makeStaff(plant, "multi", ["lab_technician", "store_keeper"]);
    const me = await call(meRoute.GET as Handler, { cookie: multi.cookie });
    expect(me.body.roles).toEqual(["lab_technician", "store_keeper"]);
  });

  it("usernames are unique within a plant only", async () => {
    const dup = await call(adminUsersRoute.POST as Handler, {
      cookie: plant.adminCookie,
      body: { username: "ramesh", display_name: "Another", roles: ["store_keeper"] },
    });
    expect(dup.status).toBe(409);
  });

  it("rejects unknown roles and empty role lists", async () => {
    for (const roles of [[], ["chief_wizard"], ["store_keeper", "store_keeper"]]) {
      const res = await call(adminUsersRoute.POST as Handler, {
        cookie: plant.adminCookie,
        body: { username: "badroles", display_name: "x", roles },
      });
      expect(res.status).toBe(400);
    }
  });

  it("promoting staff to owner switches PIN -> password, set at next login", async () => {
    const s = await makeStaff(plant, "promoted", ["store_keeper"], "555666");
    const res = await patchUser(plant.adminCookie, s.userId, { roles: ["tenant_admin", "store_keeper"] });
    expect(res.body).toMatchObject({ secret_kind: "password", must_change_secret: true });
    const again = await login(plant.code, "promoted", "555666");
    expect(again.status).toBe(200);
    expect(again.body.must_change_secret).toBe(true);
  });
});

describe("guard rails", () => {
  it("the last owner cannot remove their own owner role or disable themselves", async () => {
    const p = await makePlant();
    expect((await patchUser(p.adminCookie, p.adminUserId, { roles: ["lab_technician"] })).status).toBe(409);
    expect((await patchUser(p.adminCookie, p.adminUserId, { status: "disabled" })).status).toBe(409);
  });

  it("with a second active owner, the first may step down", async () => {
    const p = await makePlant();
    const second = await call(adminUsersRoute.POST as Handler, {
      cookie: p.adminCookie,
      body: { username: "owner2", display_name: "Owner 2", roles: ["tenant_admin"] },
    });
    expect(second.status).toBe(201);
    expect((await patchUser(p.adminCookie, p.adminUserId, { roles: ["lab_technician"] })).status).toBe(200);
  });

  it("enforces the plan's max_users, including when re-enabling a disabled user", async () => {
    const p = await makePlant({ maxUsers: 2 }); // owner counts as 1
    const s = await makeStaff(p, "one", ["store_keeper"]);
    const third = await call(adminUsersRoute.POST as Handler, {
      cookie: p.adminCookie,
      body: { username: "two", display_name: "Two", roles: ["store_keeper"] },
    });
    expect(third.status).toBe(409);
    expect(third.body.error).toMatch(/User limit reached \(2\)/);

    expect((await patchUser(p.adminCookie, s.userId, { status: "disabled" })).status).toBe(200);
    const replacement = await call(adminUsersRoute.POST as Handler, {
      cookie: p.adminCookie,
      body: { username: "two", display_name: "Two", roles: ["store_keeper"] },
    });
    expect(replacement.status).toBe(201);
    expect((await patchUser(p.adminCookie, s.userId, { status: "active" })).status).toBe(409);
  });
});

describe("super_admin", () => {
  it("creates a plant with plan and first owner; duplicate plant codes are refused", async () => {
    const body = {
      code: "newplant1",
      name: "New Plant",
      plan: { plan_name: "Starter", enabled_modules: ["lab_records"], limits: { platform: { max_users: 5 }, modules: { lab_records: { batches_per_month: 100 } } } },
      admin: { username: "boss", display_name: "Boss", phone: "+919999999999" },
    };
    const res = await call(superTenantsRoute.POST as Handler, { cookie: sa.cookie, body });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe("NEWPLANT1");
    expect(res.body.admin_temporary_password).toHaveLength(12);
    expect((await login("NEWPLANT1", "boss", res.body.admin_temporary_password)).status).toBe(200);
    expect((await call(superTenantsRoute.POST as Handler, { cookie: sa.cookie, body })).status).toBe(409);
  });

  it("rejects plans with unknown modules", async () => {
    const res = await call(superPlanRoute.PUT as Handler, {
      cookie: sa.cookie,
      method: "PUT",
      body: { plan_name: "X", enabled_modules: ["crypto_mining"], limits: {} },
      params: { id: plant.tenantId },
    });
    expect(res.status).toBe(400);
  });

  it("updates a plan", async () => {
    const res = await call(superPlanRoute.PUT as Handler, {
      cookie: sa.cookie,
      method: "PUT",
      body: { plan_name: "Growth", enabled_modules: ["lab_records", "floor_stock", "preventive_mgmt"], limits: { platform: { max_users: 10 } }, renews_on: "2027-01-12" },
      params: { id: plant.tenantId },
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ plan_name: "Growth", renews_on: "2027-01-12", limits: { platform: { max_users: 10 } } });
  });

  it("can add an owner and reset an owner's password and a staff member's PIN", async () => {
    const added = await call(superAdminsRoute.POST as Handler, {
      cookie: sa.cookie,
      body: { username: "owner3", display_name: "Owner 3" },
      params: { id: plant.tenantId },
    });
    expect(added.status).toBe(201);
    const reset = (userId: string) =>
      call(superResetRoute.POST as Handler, { cookie: sa.cookie, body: {}, params: { id: plant.tenantId, userId } });
    const ok = await reset(added.body.id);
    expect(ok.status).toBe(200);
    expect(ok.body.secret_kind).toBe("password");
    expect((await login(plant.code, "owner3", ok.body.temporary_secret)).status).toBe(200);
    const pin = await reset(staff.userId);
    expect(pin.body.secret_kind).toBe("pin");
    expect((await login(plant.code, "ramesh", pin.body.temporary_secret)).status).toBe(200);
  });

  it("unknown or malformed plant ids are 404", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await call(superTenantRoute.GET as Handler, { cookie: sa.cookie, params: { id } })).status).toBe(404);
    }
  });

  it("admin actions are written to the audit log", async () => {
    const { rows } = await superDb().execute<{ action: string }>(
      sql`select action from platform.audit_log where tenant_id = ${plant.tenantId}`,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.created", "tenant.plan_set", "user.created", "user.secret_changed", "user.secret_reset"]));
  });
});

describe("super_admin password change", () => {
  it("needs the current password, enforces length, and logs out the other sessions", async () => {
    const changeRoute = (await import("@/app/api/super/change-password/route")).POST as Handler;
    const superLogin = (await import("@/app/api/super/login/route")).POST as Handler;
    const superMe = (await import("@/app/api/super/me/route")).GET as Handler;
    const me = await makeSuperAdmin(); // password: super-secret-password
    const other = cookieFrom((await call(superLogin, { body: { email: me.email, password: "super-secret-password" } })).setCookie);

    expect((await call(changeRoute, { body: { current: "x", next: "brand-new-password" } })).status).toBe(401);
    expect((await call(changeRoute, { cookie: me.cookie, body: { current: "wrong-password", next: "brand-new-password" } })).status).toBe(400);
    expect((await call(changeRoute, { cookie: me.cookie, body: { current: "super-secret-password", next: "short" } })).status).toBe(400);
    expect((await call(changeRoute, { cookie: me.cookie, body: { current: "super-secret-password", next: "brand-new-password" } })).status).toBe(200);

    expect((await call(superMe, { cookie: me.cookie })).status).toBe(200);
    expect((await call(superMe, { cookie: other })).status).toBe(401);
    expect((await call(superLogin, { body: { email: me.email, password: "super-secret-password" } })).status).toBe(401);
    expect((await call(superLogin, { body: { email: me.email, password: "brand-new-password" } })).status).toBe(200);
  });
});

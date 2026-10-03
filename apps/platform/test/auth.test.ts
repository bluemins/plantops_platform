// Login, PIN rules, lockout, forced first change, sessions.
import { beforeAll, describe, expect, it } from "vitest";
import * as meRoute from "@/app/api/auth/me/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as changeSecretRoute from "@/app/api/auth/change-secret/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as unlockRoute from "@/app/api/admin/users/[id]/unlock/route";
import * as superTenantRoute from "@/app/api/super/tenants/[id]/route";
import { MAX_FAILED_ATTEMPTS } from "@/server/auth";
import { call, cookieFrom, login, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

let plant: Awaited<ReturnType<typeof makePlant>>;
beforeAll(async () => {
  plant = await makePlant();
});

describe("login", () => {
  it("staff log in with plant code + username + PIN (plant code and username are case-insensitive)", async () => {
    const staff = await makeStaff(plant, "sunil", ["store_keeper"]);
    const res = await login(plant.code.toLowerCase(), "SUNIL", staff.pin);
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    const me = await call(meRoute.GET as Handler, { cookie: cookieFrom(res.setCookie) });
    expect(me.body).toMatchObject({ username: "sunil", roles: ["store_keeper"], secret_kind: "pin" });
  });

  it("wrong PIN, unknown user and unknown plant all give the same 401 message", async () => {
    await makeStaff(plant, "wrongpin", ["store_keeper"]);
    const a = await login(plant.code, "wrongpin", "000000");
    const b = await login(plant.code, "nobody", "000000");
    const c = await login("NOSUCHPLANT", "wrongpin", "000000");
    expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
    expect(a.body.error).toBe(b.body.error);
    expect(b.body.error).toBe(c.body.error);
  });

  it(`locks the account after ${MAX_FAILED_ATTEMPTS} wrong tries, even for the right PIN; owner can unlock`, async () => {
    const staff = await makeStaff(plant, "locky", ["lab_technician"]);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) expect((await login(plant.code, "locky", "999999")).status).toBe(401);
    expect((await login(plant.code, "locky", "999999")).status).toBe(423);
    expect((await login(plant.code, "locky", staff.pin)).status).toBe(423);

    const list = await call(adminUsersRoute.GET as Handler, { cookie: plant.adminCookie });
    expect(list.body.find((u: { id: string }) => u.id === staff.userId).locked).toBe(true);

    const unlocked = await call(unlockRoute.POST as Handler, { cookie: plant.adminCookie, body: {}, params: { id: staff.userId } });
    expect(unlocked.status).toBe(200);
    expect((await login(plant.code, "locky", staff.pin)).status).toBe(200);
  });

  it("rate-limits many logins from one IP", async () => {
    const statuses = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await call((await import("@/app/api/auth/login/route")).POST as Handler, {
        body: { plant_code: "X", username: "y", secret: "z" },
        headers: { "x-forwarded-for": "10.9.9.9" },
      })).status);
    }
    expect(statuses).toContain(429);
  });

  it("rejects non-JSON POSTs (cross-site form protection)", async () => {
    const res = await call((await import("@/app/api/auth/login/route")).POST as Handler, {
      body: {},
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(415);
  });
});

describe("temporary PIN must be replaced on first login", () => {
  it("blocks everything except change-secret until the user sets their own PIN", async () => {
    const created = await call(adminUsersRoute.POST as Handler, {
      cookie: plant.adminCookie,
      body: { username: "newbie", display_name: "Newbie", roles: ["lab_technician"] },
    });
    expect(created.body.temporary_secret).toMatch(/^\d{6}$/);
    const first = await login(plant.code, "newbie", created.body.temporary_secret);
    expect(first.body.must_change_secret).toBe(true);
    const cookie = cookieFrom(first.setCookie);

    const handoff = (await import("@/app/api/sso/handoff/route")).POST as Handler;
    expect((await call(handoff, { cookie, body: { module: "lab_records" } })).status).toBe(403);

    const change = (next: string, current = created.body.temporary_secret) =>
      call(changeSecretRoute.POST as Handler, { cookie, body: { current, next } });
    expect((await change("12345")).status).toBe(400); // too short
    expect((await change("abcdef")).status).toBe(400); // not digits
    expect((await change("135790", "000000")).status).toBe(400); // wrong current
    expect((await change(created.body.temporary_secret)).status).toBe(400); // same as before
    expect((await change("135790")).status).toBe(200);

    const me = await call(meRoute.GET as Handler, { cookie });
    expect(me.body.must_change_secret).toBe(false);
  });

  it("owners must choose a password of at least 10 characters", async () => {
    const created = await call(adminUsersRoute.POST as Handler, {
      cookie: plant.adminCookie,
      body: { username: "coowner", display_name: "Co-owner", roles: ["tenant_admin"] },
    });
    expect(created.body.secret_kind).toBe("password");
    const cookie = cookieFrom((await login(plant.code, "coowner", created.body.temporary_secret)).setCookie);
    const short = await call(changeSecretRoute.POST as Handler, { cookie, body: { current: created.body.temporary_secret, next: "short" } });
    expect(short.status).toBe(400);
  });

  it("changing the PIN logs out the user's other sessions", async () => {
    const staff = await makeStaff(plant, "twophones", ["store_keeper"], "111222");
    const phone2 = cookieFrom((await login(plant.code, "twophones", "111222")).setCookie);
    const res = await call(changeSecretRoute.POST as Handler, { cookie: staff.cookie, body: { current: "111222", next: "333444" } });
    expect(res.status).toBe(200);
    expect((await call(meRoute.GET as Handler, { cookie: phone2 })).status).toBe(401);
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(200);
  });
});

describe("sessions", () => {
  it("logout ends the session", async () => {
    const staff = await makeStaff(plant, "leaver", ["store_keeper"]);
    await call(logoutRoute.POST as Handler, { cookie: staff.cookie, body: {} });
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(401);
  });

  it("disabling a user ends their sessions and blocks login", async () => {
    const staff = await makeStaff(plant, "disabled1", ["store_keeper"]);
    const res = await call(adminUserRoute.PATCH as Handler, {
      cookie: plant.adminCookie,
      method: "PATCH",
      body: { status: "disabled" },
      params: { id: staff.userId },
    });
    expect(res.status).toBe(200);
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(401);
    expect((await login(plant.code, "disabled1", staff.pin)).status).toBe(401);
  });

  it("forged or garbage session cookies are rejected", async () => {
    for (const cookie of ["plantops_session=garbage", `plantops_session=${plant.tenantId}.forged`, "plantops_session=not-a-uuid.x"]) {
      expect((await call(meRoute.GET as Handler, { cookie })).status).toBe(401);
    }
  });

  it("suspending a plant logs everyone out and blocks new logins; reactivating restores login", async () => {
    const p = await makePlant();
    const staff = await makeStaff(p, "worker", ["lab_technician"]);
    const sa = await makeSuperAdmin();
    const patch = (status: string) =>
      call(superTenantRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body: { status }, params: { id: p.tenantId } });

    expect((await patch("suspended")).status).toBe(200);
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(401);
    expect((await login(p.code, "worker", staff.pin)).status).toBe(401);

    expect((await patch("active")).status).toBe(200);
    expect((await login(p.code, "worker", staff.pin)).status).toBe(200);
  });
});

// Editing a user's details after they were added: name, phone, email, roles, and a new temporary PIN/password.
// Owner does it for their own plant; super_admin can do it for any plant. Same rules for both.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as resetSecretRoute from "@/app/api/admin/users/[id]/reset-secret/route";
import * as superTenantRoute from "@/app/api/super/tenants/[id]/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import * as superResetRoute from "@/app/api/super/tenants/[id]/users/[userId]/reset-secret/route";
import * as meRoute from "@/app/api/auth/me/route";
import { superDb } from "@/server/db";
import { call, cookieFrom, login, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;

beforeAll(async () => {
  A = await makePlant();
  B = await makePlant();
  sa = await makeSuperAdmin();
});

const patch = (cookie: string, id: string, body: unknown) => call(adminUserRoute.PATCH as Handler, { cookie, method: "PATCH", body, params: { id } });
const reset = (cookie: string, id: string, body: unknown = {}) => call(resetSecretRoute.POST as Handler, { cookie, body, params: { id } });
const superPatch = (tenantId: string, userId: string, body: unknown) =>
  call(superUserRoute.PATCH as Handler, { cookie: sa.cookie, method: "PATCH", body, params: { id: tenantId, userId } });
const superReset = (tenantId: string, userId: string, body: unknown = {}) =>
  call(superResetRoute.POST as Handler, { cookie: sa.cookie, body, params: { id: tenantId, userId } });

describe("owner edits a user's details", () => {
  it("adds a user with email, then changes name, phone, email and roles", async () => {
    const created = await call(adminUsersRoute.POST as Handler, {
      cookie: A.adminCookie,
      body: { username: "lab1", display_name: "Lab One", phone: "", email: "Lab1@Example.com", roles: ["lab_technician"] },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call(adminUserRoute.GET as Handler, { cookie: A.adminCookie, params: { id } })).body).toMatchObject({ email: "lab1@example.com", phone: null });

    const res = await patch(A.adminCookie, id, {
      display_name: "Lab One Sahu",
      phone: "+91 98765 43210",
      email: "lab.one@example.com",
      roles: ["lab_technician", "store_keeper"],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      display_name: "Lab One Sahu",
      phone: "+91 98765 43210",
      email: "lab.one@example.com",
      roles: ["lab_technician", "store_keeper"],
      username: "lab1",
    });

    const cleared = await patch(A.adminCookie, id, { email: "", phone: " " });
    expect(cleared.body).toMatchObject({ email: null, phone: null, display_name: "Lab One Sahu" });
  });

  it.each([
    ["bad email", { email: "not-an-email" }],
    ["phone with letters", { phone: "abc" }],
    ["empty name", { display_name: "" }],
    ["no roles", { roles: [] }],
  ])("rejects %s", async (_n, body) => {
    const staff = await makeStaff(A, `bad${Math.random().toString(36).slice(2, 8)}`, ["store_keeper"]);
    expect((await patch(A.adminCookie, staff.userId, body)).status).toBe(400);
  });

  it("owner types a temporary PIN: it works once, then the user must choose their own", async () => {
    const staff = await makeStaff(A, "typed", ["lab_technician"]);
    const res = await reset(A.adminCookie, staff.userId, { secret: "350375" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ temporary_secret: "350375", secret_kind: "pin" });
    expect((await call(meRoute.GET as Handler, { cookie: staff.cookie })).status).toBe(401); // logged out
    const again = await login(A.code, "typed", "350375");
    expect(again.status).toBe(200);
    expect(again.body.must_change_secret).toBe(true);
  });

  it("blank = random temporary PIN; a typed one must follow the PIN/password rules", async () => {
    const staff = await makeStaff(A, "random", ["lab_technician"]);
    const random = await reset(A.adminCookie, staff.userId, { secret: "" });
    expect(random.body.temporary_secret).toMatch(/^\d{6}$/);
    expect((await reset(A.adminCookie, staff.userId, { secret: "1234" })).status).toBe(400);
    expect((await reset(A.adminCookie, staff.userId, { secret: "abcdef" })).status).toBe(400);
    // an owner account needs a password of 10+ characters
    expect((await reset(A.adminCookie, A.adminUserId, { secret: "123456" })).status).toBe(400);
  });

  it("the audit log never contains the PIN/password", async () => {
    const { rows } = await superDb().execute<{ details: unknown }>(
      sql`select details from platform.audit_log where tenant_id = ${A.tenantId} and action = 'user.secret_reset'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("350375");
  });

  it("staff cannot edit users or reset PINs", async () => {
    const staff = await makeStaff(A, "nosy", ["lab_technician"]);
    expect((await patch(staff.cookie, staff.userId, { display_name: "x" })).status).toBe(403);
    expect((await reset(staff.cookie, staff.userId, { secret: "111111" })).status).toBe(403);
  });
});

describe("super_admin sees and edits users added by the owner", () => {
  it("plant page shows every user's details", async () => {
    await patch(A.adminCookie, A.adminUserId, { phone: "9876543210", email: "owner@example.com" });
    const res = await call(superTenantRoute.GET as Handler, { cookie: sa.cookie, params: { id: A.tenantId } });
    expect(res.body.users.find((u: { id: string }) => u.id === A.adminUserId)).toMatchObject({
      phone: "9876543210",
      email: "owner@example.com",
      secret_kind: "password",
      roles: ["tenant_admin"],
    });
  });

  it("edits a staff member's name, phone, email, roles and username in one go", async () => {
    const staff = await makeStaff(A, "suresh", ["store_keeper"]);
    const res = await superPatch(A.tenantId, staff.userId, {
      username: "suresh.k",
      display_name: "Suresh Kumar",
      phone: "+91 90000 00000",
      email: "suresh@example.com",
      roles: ["store_keeper", "maintenance_technician"],
    });
    expect(res.status).toBe(200);
    expect(res.body.users.find((u: { id: string }) => u.id === staff.userId)).toMatchObject({
      username: "suresh.k",
      display_name: "Suresh Kumar",
      email: "suresh@example.com",
      roles: ["maintenance_technician", "store_keeper"],
    });
  });

  it("follows the same rules as the owner: keeps at least one active owner, validates input", async () => {
    expect((await superPatch(B.tenantId, B.adminUserId, { status: "disabled" })).status).toBe(409);
    expect((await superPatch(B.tenantId, B.adminUserId, { roles: ["lab_technician"] })).status).toBe(409);
    expect((await superPatch(B.tenantId, B.adminUserId, { email: "nope" })).status).toBe(400);
    // nothing was half-applied
    expect((await login(B.code, "owner", B.adminPassword)).status).toBe(200);
  });

  it("making a staff member an owner switches their PIN to a password", async () => {
    const staff = await makeStaff(B, "promote", ["lab_technician"]);
    const res = await superPatch(B.tenantId, staff.userId, { roles: ["tenant_admin", "lab_technician"] });
    expect(res.body.users.find((u: { id: string }) => u.id === staff.userId)).toMatchObject({ secret_kind: "password", must_change_secret: true });
  });

  it("resets a staff PIN with a typed or random temporary PIN", async () => {
    const staff = await makeStaff(B, "pinreset", ["lab_technician"]);
    const typed = await superReset(B.tenantId, staff.userId, { secret: "864209" });
    expect(typed.body).toEqual({ temporary_secret: "864209", secret_kind: "pin" });
    const res = await login(B.code, "pinreset", "864209");
    expect(res.body.must_change_secret).toBe(true);
    const random = await superReset(B.tenantId, staff.userId);
    expect(random.body.temporary_secret).toMatch(/^\d{6}$/);
    expect((await call(meRoute.GET as Handler, { cookie: cookieFrom(res.setCookie) })).status).toBe(401); // logged out
  });

  it("cannot reach a user through the wrong plant", async () => {
    expect((await superPatch(A.tenantId, B.adminUserId, { display_name: "x" })).status).toBe(404);
    expect((await superReset(A.tenantId, B.adminUserId)).status).toBe(404);
  });

  it("owner and staff cannot use these super_admin routes", async () => {
    expect((await call(superUserRoute.PATCH as Handler, { cookie: A.adminCookie, method: "PATCH", body: { display_name: "x" }, params: { id: A.tenantId, userId: A.adminUserId } })).status).toBe(401);
    expect((await call(superResetRoute.POST as Handler, { cookie: A.adminCookie, body: {}, params: { id: A.tenantId, userId: A.adminUserId } })).status).toBe(401);
  });
});

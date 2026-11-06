// Attendance "days back" (owner, 2026-11-06; migration 0022): the owner sets, per Office staff / Supervisor, how far
// back they may fix someone's IN / OUT. Saved with the user, shown in the user view, sent to Attendance only in the
// status re-check (absent = 2); ignored for anyone else; owners have no limit.
import { beforeAll, describe, expect, it } from "vitest";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as statusRoute from "@/app/api/m/tenants/[tid]/users/[uid]/status/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import { sha256 } from "@/server/crypto";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const ATT_SECRET = "attendance-days-back-secret";
const OC_SECRET = "order-days-back-secret";
const ATT = { authorization: "Basic " + btoa(`attendance_salary:${ATT_SECRET}`) };
const OC = { authorization: "Basic " + btoa(`order_capture:${OC_SECRET}`) };

let A: Awaited<ReturnType<typeof makePlant>>;
const status = async (uid: string, headers = ATT, tid = A.tenantId) => call(statusRoute.GET as Handler, { headers, params: { tid, uid } });
const patch = (id: string, body: unknown) => call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie: A.adminCookie, params: { id }, body });
const listed = async (id: string) => ((await call(adminUsersRoute.GET as Handler, { cookie: A.adminCookie })).body as { id: string; fix_days_back: number | null }[]).find((u) => u.id === id)!;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://attendance.example.test', client_secret_hash = $1, status = 'active' where id = 'attendance_salary'", [sha256(ATT_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://orders.example.test', client_secret_hash = $1, status = 'active' where id = 'order_capture'", [sha256(OC_SECRET)]);
  A = await makePlant({ modules: ["attendance_salary", "order_capture"] });
});

describe("Attendance days back", () => {
  it("no number saved: Attendance gets 2 for Office staff and Supervisors; the user view shows 2", async () => {
    const office = await makeStaff(A, "office1", ["office_staff", "plant_staff"]);
    const sup = await makeStaff(A, "sup1", ["supervisor"]);
    expect((await status(office.userId)).body.fix_days_back).toBe(2);
    expect((await status(sup.userId)).body.fix_days_back).toBe(2);
    expect((await listed(office.userId)).fix_days_back).toBe(2);
  });

  it("the owner sets it on Edit user (audited); Attendance sees the new number; other modules never get it", async () => {
    const office = await makeStaff(A, "office2", ["office_staff"]);
    const r = await patch(office.userId, { fix_days_back: 5 });
    expect(r.status).toBe(200);
    expect(r.body.fix_days_back).toBe(5);
    expect((await status(office.userId)).body.fix_days_back).toBe(5);
    expect((await patch(office.userId, { fix_days_back: 0 })).body.fix_days_back).toBe(0);
    expect((await status(office.userId)).body.fix_days_back).toBe(0);
    const os = await status(office.userId, OC);
    expect(os.status).toBe(200);
    expect(os.body).not.toHaveProperty("fix_days_back");
    const { rows } = await asOwner("select details from platform.audit_log where tenant_id = $1 and target = $2 and action = 'user.updated' order by at", [A.tenantId, office.userId]);
    expect(rows.map((x) => x.details.fix_days_back)).toEqual([5, 0]);
  });

  it("set when the user is added; ignored for anyone who is not Office staff / Supervisor, and for owners", async () => {
    const add = (username: string, roles: string[], fix_days_back: number) =>
      call(adminUsersRoute.POST as Handler, { cookie: A.adminCookie, body: { username, display_name: username, roles, fix_days_back } });
    const sup = await add("sup3", ["supervisor"], 7);
    expect(sup.status).toBe(201);
    expect((await status(sup.body.id)).body.fix_days_back).toBe(7);
    const worker = await add("worker3", ["plant_staff"], 7);
    expect((await status(worker.body.id)).body).not.toHaveProperty("fix_days_back");
    expect((await listed(worker.body.id)).fix_days_back).toBeNull();
    const owner = await add("owner3", ["tenant_admin", "office_staff"], 7);
    expect((await status(owner.body.id)).body).not.toHaveProperty("fix_days_back");
    const { rows } = await asOwner("select count(*)::int as n from platform.fix_days_back where user_id = any($1)", [[worker.body.id, owner.body.id]]);
    expect(rows[0]!.n).toBe(0);
  });

  it("only whole numbers 0-31", async () => {
    const office = await makeStaff(A, "office4", ["office_staff"]);
    for (const bad of [-1, 32, 1.5, "3"]) expect((await patch(office.userId, { fix_days_back: bad })).status, String(bad)).toBe(400);
    expect((await patch(office.userId, { fix_days_back: 31 })).status).toBe(200);
  });

  it("super_admin can set it too; another plant's number never shows (row-level security)", async () => {
    const office = await makeStaff(A, "office5", ["office_staff"]);
    const sa = await makeSuperAdmin();
    const r = await call(superUserRoute.PATCH as Handler, { method: "PATCH", cookie: sa.cookie, params: { id: A.tenantId, userId: office.userId }, body: { fix_days_back: 9 } });
    expect(r.status).toBe(200);
    expect((await status(office.userId)).body.fix_days_back).toBe(9);
    const B = await makePlant({ modules: ["attendance_salary"] });
    const officeB = await makeStaff(B, "office5", ["office_staff"]);
    expect((await status(officeB.userId, ATT, B.tenantId)).body.fix_days_back).toBe(2);
    // A's user asked through B's address: unknown there
    expect((await status(office.userId, ATT, B.tenantId)).status).toBe(404);
  });
});

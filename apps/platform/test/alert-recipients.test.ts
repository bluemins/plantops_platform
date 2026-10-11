// Notifications N2 (decided 2026-10-11): besides the owners, only people the owner ticks get a module's alerts
// (e.g. a manager). The platform re-checks each one at send time: active, this plant, works in that module.
import { beforeAll, describe, expect, it } from "vitest";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as unreadRoute from "@/app/api/m/tenants/[tid]/users/[uid]/notifications/unread/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as adminUsersRoute from "@/app/api/admin/users/route";
import * as superUserRoute from "@/app/api/super/tenants/[id]/users/[userId]/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as launcherRoute from "@/app/api/launcher/route";
import { sha256 } from "@/server/crypto";
import { asOwner, call, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const STOCK_SECRET = "stock-module-test-secret";
const LAB_SECRET = "lab-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const STOCK = basic("floor_stock", STOCK_SECRET);
const LAB = basic("lab_records", LAB_SECRET);

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let manager: Awaited<ReturnType<typeof makeStaff>>; // store keeper, ticked for Floor Stock
let keeper: Awaited<ReturnType<typeof makeStaff>>; // store keeper, not ticked
let lead: Awaited<ReturnType<typeof makeStaff>>; // lab lead, ticked for Lab Records
let tech: Awaited<ReturnType<typeof makeStaff>>; // lab technician, not ticked
let general: Awaited<ReturnType<typeof makeStaff>>; // plant staff
let bKeeper: Awaited<ReturnType<typeof makeStaff>>; // plant B

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "lab_records"] });
  B = await makePlant({ modules: ["floor_stock", "lab_records"] });
  manager = await makeStaff(A, "manager", ["store_keeper"]);
  keeper = await makeStaff(A, "keeper", ["store_keeper"]);
  lead = await makeStaff(A, "lead", ["lab_lead"]);
  tech = await makeStaff(A, "tech", ["lab_technician"]);
  general = await makeStaff(A, "general", ["plant_staff"]);
  bKeeper = await makeStaff(B, "bkeeper", ["store_keeper"]);
  expect((await tick(A.adminCookie, manager.userId, ["floor_stock"])).status).toBe(200);
  expect((await tick(A.adminCookie, lead.userId, ["lab_records"])).status).toBe(200);
  expect((await tick(B.adminCookie, bKeeper.userId, ["floor_stock"])).status).toBe(200);
});

const tick = (cookie: string, userId: string, alert_modules: string[]) =>
  call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie, params: { id: userId }, body: { alert_modules } });
let seq = 0;
const send = (tenantId: string, over: Record<string, unknown> = {}, headers: Record<string, string> = STOCK) =>
  call(moduleNotifyRoute.POST as Handler, { headers, params: { tid: tenantId }, body: { kind: "k", title: `Event ${++seq}`, dedupe_key: `n2:${seq}`, ...over } });
const titles = async (cookie: string) => (await call(inboxRoute.GET as Handler, { cookie })).body.items.map((n: { title: string }) => n.title) as string[];

describe("who receives", () => {
  it("owners + ticked people only; an unticked store keeper gets nothing", async () => {
    const r = await send(A.tenantId);
    expect(r.body).toEqual({ recipients: 2, created: 2 }); // owner + manager
    const t = `Event ${seq}`;
    expect(await titles(A.adminCookie)).toContain(t);
    expect(await titles(manager.cookie)).toContain(t);
    expect(await titles(keeper.cookie)).not.toContain(t);
  });

  it("a ticked person never gets another module's alerts", async () => {
    await send(A.tenantId, {}, LAB);
    const t = `Event ${seq}`;
    expect(await titles(lead.cookie)).toContain(t);
    expect(await titles(manager.cookie)).not.toContain(t);
  });

  it("never another plant's: plant B's ticked keeper gets only plant B's events", async () => {
    await send(A.tenantId);
    const t = `Event ${seq}`;
    expect(await titles(bKeeper.cookie)).not.toContain(t);
    await send(B.tenantId);
    expect(await titles(bKeeper.cookie)).toContain(`Event ${seq}`);
  });

  it("whoever did it is left out, even when ticked", async () => {
    expect((await send(A.tenantId, { exclude_user_id: manager.userId })).body.recipients).toBe(1);
  });

  it("a ticked but disabled person gets nothing", async () => {
    await asOwner("update platform.users set status = 'disabled' where id = $1", [manager.userId]);
    try {
      expect((await send(A.tenantId)).body.recipients).toBe(1);
    } finally {
      await asOwner("update platform.users set status = 'active' where id = $1", [manager.userId]);
    }
  });

  it("a ticked person whose role no longer works in the module gets nothing (checked at send time)", async () => {
    await asOwner("update platform.user_roles set role_id = 'lab_technician' where user_id = $1", [manager.userId]);
    try {
      expect((await send(A.tenantId)).body.recipients).toBe(1);
    } finally {
      await asOwner("update platform.user_roles set role_id = 'store_keeper' where user_id = $1", [manager.userId]);
    }
  });

  it("also_user_ids (the people an event is about): added when they work in the module, ignored otherwise", async () => {
    // tech works in Lab Records -> added; keeper doesn't -> ignored; plant B's keeper -> ignored
    const r = await send(A.tenantId, { also_user_ids: [tech.userId, keeper.userId, bKeeper.userId] }, LAB);
    expect(r.body.recipients).toBe(3); // owner + ticked lead + tech
    expect(await titles(tech.cookie)).toContain(`Event ${seq}`);
    expect(await titles(keeper.cookie)).not.toContain(`Event ${seq}`);
    expect(await titles(bKeeper.cookie)).not.toContain(`Event ${seq}`);
  });
});

describe("the owner's tick boxes", () => {
  it("shown on the user and in the list", async () => {
    const list = (await call(adminUsersRoute.GET as Handler, { cookie: A.adminCookie })).body as { id: string; alert_modules: string[] }[];
    expect(list.find((u) => u.id === manager.userId)!.alert_modules).toEqual(["floor_stock"]);
    expect(list.find((u) => u.id === keeper.userId)!.alert_modules).toEqual([]);
  });

  it("only modules the person works in, and only modules switched on for the plant", async () => {
    expect((await tick(A.adminCookie, tech.userId, ["floor_stock"])).status).toBe(400);
    expect((await tick(A.adminCookie, general.userId, ["lab_records"])).status).toBe(400); // plant staff: not Lab Records
    expect((await tick(A.adminCookie, general.userId, ["preventive_mgmt"])).status).toBe(400); // not switched on
    expect((await tick(A.adminCookie, general.userId, ["floor_stock"])).body.alert_modules).toEqual(["floor_stock"]);
  });

  it("untick any time", async () => {
    expect((await tick(A.adminCookie, general.userId, [])).body.alert_modules).toEqual([]);
    expect((await send(A.tenantId)).body.recipients).toBe(2);
  });

  it("owners always get alerts, so ticks for an owner are ignored", async () => {
    const r = await tick(A.adminCookie, A.adminUserId, ["floor_stock"]);
    expect(r.status).toBe(200);
    expect(r.body.alert_modules).toEqual([]);
  });

  it("staff can't tick anyone (owner only), and every change is audited", async () => {
    expect((await tick(keeper.cookie, keeper.userId, ["floor_stock"])).status).toBe(403);
    const { rows } = await asOwner<{ details: { alert_modules?: string[] } }>(
      "select details from platform.audit_log where tenant_id = $1 and action = 'user.updated' and target = $2 order by at desc limit 1",
      [A.tenantId, manager.userId],
    );
    expect(rows[0]!.details.alert_modules).toEqual(["floor_stock"]);
  });

  it("a role change drops modules the person no longer works in", async () => {
    const p = await makeStaff(A, "mover", ["store_keeper"]);
    await tick(A.adminCookie, p.userId, ["floor_stock"]);
    const r = await call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie: A.adminCookie, params: { id: p.userId }, body: { roles: ["lab_technician"] } });
    expect(r.body.alert_modules).toEqual([]);
  });

  it("can be set when adding a user, and by super_admin", async () => {
    const created = await call(adminUsersRoute.POST as Handler, {
      cookie: A.adminCookie,
      body: { username: "newmgr", display_name: "New manager", roles: ["store_keeper"], alert_modules: ["floor_stock"] },
    });
    expect(created.status).toBe(201);
    const sa = await makeSuperAdmin();
    const r = await call(superUserRoute.PATCH as Handler, { method: "PATCH", cookie: sa.cookie, params: { id: A.tenantId, userId: created.body.id }, body: { alert_modules: [] } });
    expect(r.status).toBe(200);
    const { rows } = await asOwner<{ n: number }>("select count(*)::int as n from platform.alert_recipients where user_id = $1", [created.body.id]);
    expect(rows[0]!.n).toBe(0);
  });

  it("the launcher tells a ticked person to turn on phone alerts, but not an unticked one", async () => {
    const me = async (cookie: string) => (await call(launcherRoute.GET as Handler, { cookie })).body.user.gets_alerts;
    expect(await me(A.adminCookie)).toBe(true);
    expect(await me(manager.cookie)).toBe(true);
    expect(await me(keeper.cookie)).toBe(false);
  });
});

describe("unread count for a module's header bell", () => {
  const unread = (tid: string, uid: string, headers: Record<string, string> = STOCK) =>
    call(unreadRoute.GET as Handler, { headers, params: { tid, uid } });

  it("needs module credentials", async () => {
    expect((await unread(A.tenantId, manager.userId, {})).status).toBe(401);
  });

  it("counts the person's unread notifications; another plant's person is 0", async () => {
    const r = await unread(A.tenantId, manager.userId);
    expect(r.status).toBe(200);
    expect(r.body.unread).toBeGreaterThan(0);
    expect((await unread(A.tenantId, bKeeper.userId)).body.unread).toBe(0);
  });
});

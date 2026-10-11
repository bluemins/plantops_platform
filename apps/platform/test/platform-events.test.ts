// Notifications N3: events PlantOps itself writes into the OWNERS' inbox (never ticked people): a person locked out,
// support opened a module, plan changes by super_admin, plan renewal coming up (the platform's daily job).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as adminUserRoute from "@/app/api/admin/users/[id]/route";
import * as planRoute from "@/app/api/super/tenants/[id]/plan/route";
import * as supportRoute from "@/app/api/super/tenants/[id]/support/[module]/route";
import * as cronRoute from "@/app/api/cron/daily/route";
import * as openRoute from "@/app/n/[id]/route";
import { sha256 } from "@/server/crypto";
import { notifyOwnersDirect } from "@/server/notifications";
import { renewalStage, runPlatformDaily } from "@/server/platform-events";
import { asOwner, call, login, makePlant, makeStaff, makeSuperAdmin, type Handler } from "./helpers";

const LAB_SECRET = "lab-module-test-secret";
const DOC_SECRET = "doc-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let owner2: Awaited<ReturnType<typeof makeStaff>>;
let lead: Awaited<ReturnType<typeof makeStaff>>; // ticked for Lab Records
let keeper: Awaited<ReturnType<typeof makeStaff>>; // document keeper
let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://docs.example.test', client_secret_hash = $1 where id = 'document_store'", [sha256(DOC_SECRET)]);
  A = await makePlant({ modules: ["lab_records", "document_store"] });
  B = await makePlant({ modules: ["lab_records"] });
  owner2 = await makeStaff(A, "owner2", ["tenant_admin"], "second-owner-password");
  lead = await makeStaff(A, "lead", ["lab_lead"]);
  keeper = await makeStaff(A, "keeper", ["document_keeper"]);
  await call(adminUserRoute.PATCH as Handler, { method: "PATCH", cookie: A.adminCookie, params: { id: lead.userId }, body: { alert_modules: ["lab_records"] } });
  sa = await makeSuperAdmin();
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

type Item = { id: string; kind: string; title: string; body: string; module: string | null; level: string; open_url: string };
const inbox = async (cookie: string) => (await call(inboxRoute.GET as Handler, { cookie })).body.items as Item[];
const ofKind = async (cookie: string, kind: string) => (await inbox(cookie)).filter((n) => n.kind === kind);
const open = (cookie: string, id: string) =>
  openRoute.GET(new Request(`http://localhost/n/${id}`, { headers: { cookie } }), { params: Promise.resolve({ id }) }).then((r) => r.headers.get("location"));

describe("locked out after 5 wrong PINs", () => {
  it("the owners hear it once, with a link to Manage users; the locked person never does", async () => {
    const tech = await makeStaff(A, "slowfingers", ["lab_technician"]);
    for (let i = 0; i < 5; i++) expect((await login(A.code, "slowfingers", "000000")).status).not.toBe(200);
    expect((await login(A.code, "slowfingers", "000000")).status).toBe(423); // still locked: nothing new
    const [n] = await ofKind(A.adminCookie, "platform.user_locked");
    expect(n).toMatchObject({ title: "slowfingers is locked out", module: null, level: "push" });
    expect(n!.body).toMatch(/^5 wrong PINs at .+\. They can try again in 15 minutes, or you can unlock them now in Manage users\.$/);
    expect((await ofKind(A.adminCookie, "platform.user_locked")).length).toBe(1);
    expect(await ofKind(owner2.cookie, "platform.user_locked")).toHaveLength(1);
    expect(await ofKind(lead.cookie, "platform.user_locked")).toHaveLength(0); // ticked people: never platform events
    expect(await open(A.adminCookie, n!.id)).toBe("/admin/users");
    expect(tech.userId).toBeTruthy();
  });

  it("an owner locked out: the other owner hears it, not the locked one", async () => {
    await asOwner("update platform.users set locked_until = null, failed_attempts = 0 where id = $1", [owner2.userId]);
    const before = (await ofKind(A.adminCookie, "platform.user_locked")).length;
    for (let i = 0; i < 5; i++) await login(A.code, "owner2", "wrong-password-xx");
    expect((await ofKind(A.adminCookie, "platform.user_locked")).length).toBe(before + 1);
    expect((await ofKind(A.adminCookie, "platform.user_locked"))[0]!.body).toMatch(/5 wrong passwords/);
    await asOwner("update platform.users set locked_until = null, failed_attempts = 0 where id = $1", [owner2.userId]);
  });
});

describe("PlantOps support opened a module", () => {
  it("owners get a bell notification that opens the module's Support access page; ticked people don't", async () => {
    const r = await call(supportRoute.POST as Handler, { cookie: sa.cookie, params: { id: A.tenantId, module: "lab_records" }, body: {} });
    expect(r.status).toBe(200);
    const [n] = await ofKind(A.adminCookie, "platform.support_opened");
    expect(n).toMatchObject({ title: "PlantOps support viewed Lab Records", module: "lab_records", level: "bell" });
    expect(await open(A.adminCookie, n!.id)).toBe(`/sso/start?module=lab_records&next=${encodeURIComponent("/support-access")}`);
    expect(await ofKind(lead.cookie, "platform.support_opened")).toHaveLength(0);
    expect(await ofKind(B.adminCookie, "platform.support_opened")).toHaveLength(0);
  });
});

describe("plan changed by super_admin", () => {
  const plan = (modules: string[], over: Record<string, unknown> = {}) => ({ plan_name: "Growth", enabled_modules: modules, limits: { platform: {}, modules: {} }, renews_on: null, ...over });
  const put = (body: unknown) => call(planRoute.PUT as Handler, { method: "PUT", cookie: sa.cookie, params: { id: A.tenantId }, body });

  it("a module switched on: phone + bell, opens the module", async () => {
    expect((await put(plan(["lab_records", "document_store", "floor_stock"]))).status).toBe(200);
    const [n] = await ofKind(A.adminCookie, "platform.module_on");
    expect(n).toMatchObject({ title: "Floor Stock is now switched on", module: "floor_stock", level: "push" });
  });

  it("switched off and other changes: bell only; a save that changes nothing sends nothing", async () => {
    await put(plan(["lab_records", "document_store"], { plan_name: "Basic", renews_on: "2027-01-31" }));
    const [off] = await ofKind(A.adminCookie, "platform.module_off");
    expect(off).toMatchObject({ title: "Floor Stock is switched off", module: null, level: "bell" });
    const [changed] = await ofKind(A.adminCookie, "platform.plan_changed");
    expect(changed).toMatchObject({ title: "Your PlantOps plan was updated", level: "bell" });
    expect(changed!.body).toBe("Changed: plan Basic, renewal date 31 Jan 2027. See the plan card on your PlantOps home.");
    const count = (await inbox(A.adminCookie)).length;
    await put(plan(["lab_records", "document_store"], { plan_name: "Basic", renews_on: "2027-01-31" }));
    expect((await inbox(A.adminCookie)).length).toBe(count);
  });
});

describe("plan renewal (the platform's daily job)", () => {
  const ist = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86_400_000));

  it("stages: 30 / 7 / 1 days before and on the day", () => {
    const t = "2026-10-11";
    expect(renewalStage("2026-11-11", t)).toBeNull(); // 31 days
    expect(renewalStage("2026-11-10", t)).toBe("d30");
    expect(renewalStage("2026-10-18", t)).toBe("d7");
    expect(renewalStage("2026-10-13", t)).toBe("d7");
    expect(renewalStage("2026-10-12", t)).toBe("d1");
    expect(renewalStage("2026-10-11", t)).toBe("d0");
    expect(renewalStage("2026-10-10", t)).toBeNull(); // past: billing is handled outside the app
  });

  it("needs the cron secret", async () => {
    const post = (secret?: string) => cronRoute.POST(new Request("http://localhost/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
    expect((await post()).status).toBe(503);
    process.env.CRON_SECRET = "cron-test-secret";
    expect((await post("wrong")).status).toBe(401);
    expect((await post("cron-test-secret")).status).toBe(200);
  });

  it("reminds the owners once per stage; another plant, a suspended plant or no date: nothing", async () => {
    const R = await makePlant({ modules: ["lab_records"] });
    const S = await makePlant({ modules: ["lab_records"] });
    await asOwner("update platform.tenant_plans set renews_on = $2 where tenant_id = $1", [R.tenantId, ist(7)]);
    await asOwner("update platform.tenant_plans set renews_on = $2 where tenant_id = $1", [S.tenantId, ist(7)]);
    await asOwner("update platform.tenants set status = 'suspended' where id = $1", [S.tenantId]);
    await runPlatformDaily();
    await runPlatformDaily();
    const got = await ofKind(R.adminCookie, "platform.plan_renewal");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Your PlantOps plan renews in 7 days", module: null, level: "push" });
    expect(await ofKind(B.adminCookie, "platform.plan_renewal")).toHaveLength(0);
    const { rows } = await asOwner<{ n: number }>("select count(*)::int as n from platform.notifications where tenant_id = $1", [S.tenantId]);
    expect(rows[0]!.n).toBe(0);
  });
});

describe("PlantOps events without a module", () => {
  it("are stored once per person even though module is empty (nulls not distinct)", async () => {
    const e = { module: null, kind: "platform.test", title: "Test", body: "", link: "/home", level: "bell" as const, dedupe_key: "same-key" };
    expect(await notifyOwnersDirect(A.tenantId, e)).toBe(2);
    expect(await notifyOwnersDirect(A.tenantId, e)).toBe(0);
  });

  it("their link opens the platform page directly (and never another site)", async () => {
    await notifyOwnersDirect(A.tenantId, { module: null, kind: "platform.test2", title: "Elsewhere", body: "", link: "//evil.example", level: "bell", dedupe_key: "evil" });
    const [n] = await ofKind(A.adminCookie, "platform.test2");
    expect(await open(A.adminCookie, n!.id)).toBe("/home?launcher=1");
  });
});

describe("only_listed (\"you are now responsible\")", () => {
  const send = (body: Record<string, unknown>) =>
    call(moduleNotifyRoute.POST as Handler, { headers: basic("document_store", DOC_SECRET), params: { tid: A.tenantId }, body: { kind: "k", title: "You are responsible", dedupe_key: `r:${Math.random()}`, only_listed: true, ...body } });

  it("only the listed person, not the owners", async () => {
    expect((await send({ also_user_ids: [keeper.userId] })).body).toEqual({ recipients: 1, created: 1 });
    expect((await inbox(keeper.cookie))[0]!.title).toBe("You are responsible");
  });

  it("still checked: someone who doesn't work in the module, or from another plant, gets nothing", async () => {
    expect((await send({ also_user_ids: [lead.userId] })).body.recipients).toBe(0);
    expect((await send({ also_user_ids: [B.adminUserId] })).body.recipients).toBe(0);
    expect((await send({ also_user_ids: [] })).body.recipients).toBe(0);
  });
});

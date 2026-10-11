// Notifications N4: each person's choice per kind (phone + bell / bell only / off; urgent kinds always on) and the
// 90-day cleanup through a locked-down database function (the app login still can't delete notifications).
import { beforeAll, describe, expect, it } from "vitest";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as settingsRoute from "@/app/api/notifications/settings/route";
import { sha256 } from "@/server/crypto";
import { schema, withTenant } from "@/server/db";
import { notifyOwnersDirect, notifyPlant } from "@/server/notifications";
import { runPlatformDaily } from "@/server/platform-events";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const STOCK_SECRET = "stock-module-test-secret";
const LAB_SECRET = "lab-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let owner2: Awaited<ReturnType<typeof makeStaff>>;
let tech: Awaited<ReturnType<typeof makeStaff>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "lab_records"] });
  B = await makePlant({ modules: ["floor_stock"] });
  owner2 = await makeStaff(A, "owner2", ["tenant_admin"], "second-owner-password");
  tech = await makeStaff(A, "tech", ["lab_technician"]);
});

type Setting = { kind: string; module: string | null; label: string; urgent: boolean; mode: string };
const settings = async (cookie: string) => (await call(settingsRoute.GET as Handler, { cookie })).body as Setting[];
const choose = (cookie: string, kind: string, mode: string) => call(settingsRoute.PUT as Handler, { method: "PUT", cookie, body: { kind, mode } });
const inbox = async (cookie: string) => (await call(inboxRoute.GET as Handler, { cookie })).body.items as { kind: string; title: string; level: string }[];
let seq = 0;
const event = (kind: string, over: Record<string, unknown> = {}) => ({ kind, title: `${kind} ${++seq}`, body: "", link: null, level: "push" as const, dedupe_key: `s:${seq}`, ...over });

describe("the settings list", () => {
  it("owners: their plant's modules + PlantOps; urgent ones marked; everything starts as phone + bell", async () => {
    const list = await settings(A.adminCookie);
    const kinds = list.map((s) => s.kind);
    expect(kinds).toContain("floor_stock.count_saved");
    expect(kinds).toContain("lab_records.batch_held");
    expect(kinds).toContain("platform.plan_renewal");
    expect(kinds).not.toContain("document_store.expiry"); // not switched on for plant A
    expect(list.find((s) => s.kind === "lab_records.batch_held")).toMatchObject({ urgent: true, mode: "push" });
    expect(list.every((s) => s.mode === "push")).toBe(true);
  });

  it("staff: only the modules they work in, never PlantOps events", async () => {
    const kinds = (await settings(tech.cookie)).map((s) => s.kind);
    expect(kinds.every((k) => k.startsWith("lab_records."))).toBe(true);
    expect(kinds).toContain("lab_records.batch_approved");
  });
});

describe("choices", () => {
  it("bell only: still in the bell, but no phone message for that person (others unchanged)", async () => {
    expect((await choose(A.adminCookie, "floor_stock.count_saved", "bell")).status).toBe(200);
    const r = await notifyPlant("floor_stock", A.tenantId, event("floor_stock.count_saved"));
    expect(r.created).toBe(2);
    expect([...r.messages.keys()]).toEqual([owner2.userId]);
    expect((await inbox(A.adminCookie))[0]).toMatchObject({ kind: "floor_stock.count_saved", level: "bell" });
    expect((await settings(A.adminCookie)).find((s) => s.kind === "floor_stock.count_saved")!.mode).toBe("bell");
  });

  it("off: that person gets nothing; back to phone + bell any time", async () => {
    await choose(A.adminCookie, "floor_stock.low_stock", "off");
    const r = await call(moduleNotifyRoute.POST as Handler, { headers: basic("floor_stock", STOCK_SECRET), params: { tid: A.tenantId }, body: event("floor_stock.low_stock") });
    expect(r.body).toEqual({ recipients: 1, created: 1 });
    expect((await inbox(A.adminCookie)).map((n) => n.kind)).not.toContain("floor_stock.low_stock");
    await choose(A.adminCookie, "floor_stock.low_stock", "push");
    expect((await notifyPlant("floor_stock", A.tenantId, event("floor_stock.low_stock"))).created).toBe(2);
  });

  it("a choice never raises the level: a bell-only event stays bell", async () => {
    const r = await notifyPlant("floor_stock", A.tenantId, event("floor_stock.setup_changed", { level: "bell" }));
    expect(r.messages.size).toBe(0);
  });

  it("urgent kinds can't be changed, and a stray 'off' row is ignored", async () => {
    expect((await choose(A.adminCookie, "lab_records.batch_held", "off")).status).toBe(400);
    await asOwner("insert into platform.notification_prefs (tenant_id, user_id, kind, mode) values ($1, $2, 'lab_records.batch_held', 'off')", [A.tenantId, A.adminUserId]);
    const r = await notifyPlant("lab_records", A.tenantId, event("lab_records.batch_held"));
    expect(r.created).toBe(2);
    expect(r.messages.has(A.adminUserId)).toBe(true);
  });

  it("unknown kinds, and kinds you never get, can't be set", async () => {
    expect((await choose(A.adminCookie, "made.up", "off")).status).toBe(400);
    expect((await choose(tech.cookie, "floor_stock.count_saved", "off")).status).toBe(400);
    expect((await choose(tech.cookie, "platform.plan_changed", "off")).status).toBe(400);
    expect((await choose(A.adminCookie, "floor_stock.count_saved", "loud")).status).toBe(400);
  });

  it("PlantOps events respect the choices too", async () => {
    await choose(A.adminCookie, "platform.plan_changed", "off");
    expect(await notifyOwnersDirect(A.tenantId, { module: null, kind: "platform.plan_changed", title: "Plan", body: "", link: null, level: "bell", dedupe_key: `p:${++seq}` })).toBe(1);
  });

  it("your own settings only: another plant's owner sees none of yours", async () => {
    const theirs = await settings(B.adminCookie);
    expect(theirs.every((s) => s.mode === "push")).toBe(true);
    const rows = await withTenant(B.tenantId, (tx) => tx.select().from(schema.notificationPrefs));
    expect(rows.every((r) => r.tenantId === B.tenantId)).toBe(true);
  });
});

describe("cleanup after 90 days", () => {
  it("the daily job removes only notifications older than 90 days, in every plant", async () => {
    await notifyPlant("floor_stock", B.tenantId, event("floor_stock.count_missing"));
    await asOwner(
      `insert into platform.notifications (tenant_id, user_id, module_id, kind, title, dedupe_key, created_at)
       values ($1, $2, 'floor_stock', 'floor_stock.count_saved', 'old A', 'old-a', now() - interval '91 days'),
              ($3, $4, 'floor_stock', 'floor_stock.count_saved', 'old B', 'old-b', now() - interval '120 days'),
              ($1, $2, 'floor_stock', 'floor_stock.count_saved', 'recent A', 'recent-a', now() - interval '89 days')`,
      [A.tenantId, A.adminUserId, B.tenantId, B.adminUserId],
    );
    const r = await runPlatformDaily();
    expect(r.removed).toBeGreaterThanOrEqual(2);
    const { rows } = await asOwner<{ title: string }>("select title from platform.notifications where title in ('old A', 'old B', 'recent A')");
    expect(rows.map((x) => x.title)).toEqual(["recent A"]);
  });

  it("the app login still can't delete a notification itself", async () => {
    let message = "";
    try {
      await withTenant(A.tenantId, (tx) => tx.delete(schema.notifications));
    } catch (err) {
      message = ((err as { cause?: Error }).cause ?? (err as Error)).message;
    }
    expect(message).toMatch(/permission denied/);
  });
});

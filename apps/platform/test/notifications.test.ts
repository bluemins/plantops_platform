// App notifications (CLAUDE.md "Notifications"): modules report events, the platform picks the recipients (N1: the
// plant's active owners), each person has their own read mark, and "push" level ones go to their phones.
import { beforeAll, describe, expect, it } from "vitest";
import * as moduleNotifyRoute from "@/app/api/m/tenants/[tid]/notifications/route";
import * as inboxRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import * as pushRoute from "@/app/api/push/route";
import * as openRoute from "@/app/n/[id]/route";
import { sha256 } from "@/server/crypto";
import { schema, withTenant } from "@/server/db";
import { pushToUsers, type PushSender, type PushTarget } from "@/server/push";
import { asOwner, call, makePlant, makeStaff, type Handler } from "./helpers";

const STOCK_SECRET = "stock-module-test-secret";
const LAB_SECRET = "lab-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const STOCK = basic("floor_stock", STOCK_SECRET);
const LAB = basic("lab_records", LAB_SECRET);

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;
let secondOwner: Awaited<ReturnType<typeof makeStaff>>;
let keeper: Awaited<ReturnType<typeof makeStaff>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1 where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1 where id = 'lab_records'", [sha256(LAB_SECRET)]);
  A = await makePlant({ modules: ["floor_stock", "lab_records"] });
  B = await makePlant({ modules: ["floor_stock"] });
  secondOwner = await makeStaff(A, "owner2", ["tenant_admin"], "second-owner-password");
  keeper = await makeStaff(A, "atharv", ["store_keeper"]);
});

let seq = 0;
const event = (over: Record<string, unknown> = {}) => ({
  kind: "floor_stock.count_saved",
  title: "Stock count saved",
  body: "Atharv, 11 Oct, 6:40 pm",
  link: "/day/2026-10-11",
  dedupe_key: `count:test:${++seq}`,
  ...over,
});
const send = (tenantId: string, body: unknown, headers: Record<string, string> = STOCK) =>
  call(moduleNotifyRoute.POST as Handler, { body, headers, params: { tid: tenantId } });
const inbox = (cookie: string) => call(inboxRoute.GET as Handler, { cookie });

describe("module endpoint: modules report, the platform picks recipients", () => {
  it("wrong or missing module secret -> 401", async () => {
    expect((await send(A.tenantId, event(), basic("floor_stock", "wrong"))).status).toBe(401);
    expect((await send(A.tenantId, event(), {})).status).toBe(401);
  });

  it("module not enabled for the plant -> 403", async () => {
    expect((await send(B.tenantId, event(), LAB)).status).toBe(403);
  });

  it("bad input -> 400 (title too long, link to another site)", async () => {
    expect((await send(A.tenantId, event({ title: "x".repeat(81) }))).status).toBe(400);
    expect((await send(A.tenantId, event({ link: "//evil.example/x" }))).status).toBe(400);
    expect((await send(A.tenantId, event({ link: "https://evil.example/x" }))).status).toBe(400);
  });

  it("goes to every active owner of that plant, never to staff or another plant", async () => {
    const before = (await inbox(keeper.cookie)).body.items.length;
    const bBefore = (await inbox(B.adminCookie)).body.items.length;
    const res = await send(A.tenantId, event({ title: "Both owners" }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recipients: 2, created: 2 });
    expect((await inbox(A.adminCookie)).body.items[0].title).toBe("Both owners");
    expect((await inbox(secondOwner.cookie)).body.items[0].title).toBe("Both owners");
    expect((await inbox(keeper.cookie)).body.items.length).toBe(before);
    expect((await inbox(B.adminCookie)).body.items.length).toBe(bBefore);
  });

  it("whoever did it is not notified about their own action", async () => {
    const res = await send(A.tenantId, event({ title: "Own count", exclude_user_id: A.adminUserId }));
    expect(res.body).toEqual({ recipients: 1, created: 1 });
    expect((await inbox(A.adminCookie)).body.items.map((n: { title: string }) => n.title)).not.toContain("Own count");
  });

  it("the same event twice is stored once per person (per module)", async () => {
    const e = event({ dedupe_key: "count:2026-10-11:v1" });
    expect((await send(A.tenantId, e)).body.created).toBe(2);
    expect((await send(A.tenantId, e)).body.created).toBe(0);
    // another module may use the same key without being swallowed
    expect((await send(A.tenantId, { ...e, kind: "lab_records.x" }, LAB)).body.created).toBe(2);
  });

  it("a disabled owner gets nothing", async () => {
    await asOwner("update platform.users set status = 'disabled' where id = $1", [secondOwner.userId]);
    try {
      expect((await send(A.tenantId, event())).body).toEqual({ recipients: 1, created: 1 });
    } finally {
      await asOwner("update platform.users set status = 'active' where id = $1", [secondOwner.userId]);
    }
  });
});

describe("the inbox (bell)", () => {
  it("needs a login", async () => {
    expect((await call(inboxRoute.GET as Handler)).status).toBe(401);
  });

  it("shows the newest first with an unread count and opens through /n/<id>", async () => {
    await send(A.tenantId, event({ title: "Newest" }));
    const res = await inbox(A.adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.unread).toBeGreaterThan(0);
    expect(res.body.items[0]).toMatchObject({ title: "Newest", module: "floor_stock", read: false, level: "push" });
    expect(res.body.items[0].open_url).toBe(`/n/${res.body.items[0].id}`);
  });

  it("mark read only touches your own rows", async () => {
    await send(A.tenantId, event({ title: "Shared event" }));
    const mine = (await inbox(A.adminCookie)).body.items[0];
    const theirs = (await inbox(secondOwner.cookie)).body.items[0];
    // owner 1 tries to mark owner 2's copy: nothing changes
    expect((await call(readRoute.POST as Handler, { cookie: A.adminCookie, body: { ids: [theirs.id] } })).body.marked).toBe(0);
    expect((await inbox(secondOwner.cookie)).body.items[0].read).toBe(false);
    expect((await call(readRoute.POST as Handler, { cookie: A.adminCookie, body: { ids: [mine.id] } })).body.marked).toBe(1);
    expect((await inbox(A.adminCookie)).body.items[0].read).toBe(true);
  });

  it("mark all read", async () => {
    await send(A.tenantId, event());
    await call(readRoute.POST as Handler, { cookie: A.adminCookie, body: { all: true } });
    expect((await inbox(A.adminCookie)).body.unread).toBe(0);
    expect((await call(readRoute.POST as Handler, { cookie: A.adminCookie, body: {} })).status).toBe(400);
  });

  it("tapping marks it read and goes to the module page through /sso/start", async () => {
    await send(A.tenantId, event({ title: "Tap me", link: "/day/2026-10-11" }));
    const n = (await inbox(secondOwner.cookie)).body.items[0];
    const open = (cookie?: string, id = n.id) =>
      openRoute.GET(new Request(`http://localhost/n/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
    const res = await open(secondOwner.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/sso/start?module=floor_stock&next=${encodeURIComponent("/day/2026-10-11")}`);
    expect((await inbox(secondOwner.cookie)).body.items[0].read).toBe(true);
    // not logged in: login first, then back here
    expect((await open()).headers.get("location")).toBe(`/login?next=${encodeURIComponent(`/n/${n.id}`)}`);
    // someone else's notification: back to the launcher, nothing revealed
    expect((await open(A.adminCookie)).headers.get("location")).toBe("/home?launcher=1");
    expect((await open(B.adminCookie)).headers.get("location")).toBe("/home?launcher=1");
  });

  it("plant B's owner never sees plant A's notifications, even at database level", async () => {
    const rows = await withTenant(B.tenantId, (tx) => tx.select().from(schema.notifications));
    expect(rows.every((r) => r.tenantId === B.tenantId)).toBe(true);
    const aRows = await asOwner<{ n: number }>("select count(*)::int as n from platform.notifications where tenant_id = $1", [A.tenantId]);
    expect(aRows.rows[0]!.n).toBeGreaterThan(0);
  });

  it("the app login cannot edit or delete notifications (only mark them read)", async () => {
    const err = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return "";
      } catch (e) {
        return ((e as { cause?: Error }).cause ?? (e as Error)).message;
      }
    };
    expect(await err(() => withTenant(A.tenantId, (tx) => tx.update(schema.notifications).set({ title: "changed" })))).toMatch(/permission denied/);
    expect(await err(() => withTenant(A.tenantId, (tx) => tx.delete(schema.notifications)))).toMatch(/permission denied/);
  });
});

const phone = (n: number) => ({ endpoint: `https://push.example.test/sub/${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });

describe("phones (push subscriptions)", () => {
  it("turn on / check / turn off", async () => {
    const p = phone(1);
    expect((await call(pushRoute.POST as Handler, { cookie: A.adminCookie, body: p })).status).toBe(201);
    const check = (cookie: string) =>
      pushRoute.GET(new Request(`http://localhost/api/push?endpoint=${encodeURIComponent(p.endpoint)}`, { headers: { cookie } }), {} as never).then((r) => r.json());
    expect(await check(A.adminCookie)).toMatchObject({ subscribed: true });
    expect(await check(secondOwner.cookie)).toMatchObject({ subscribed: false });
    expect((await call(pushRoute.DELETE as Handler, { method: "DELETE", cookie: A.adminCookie, body: { endpoint: p.endpoint } })).body.removed).toBe(1);
    expect(await check(A.adminCookie)).toMatchObject({ subscribed: false });
  });

  it("only real (https) push addresses are accepted", async () => {
    const res = await call(pushRoute.POST as Handler, { cookie: A.adminCookie, body: { ...phone(2), endpoint: "http://push.example.test/x" } });
    expect(res.status).toBe(400);
  });

  it("a shared phone moves to whoever turned it on last in that plant", async () => {
    const p = phone(3);
    await call(pushRoute.POST as Handler, { cookie: A.adminCookie, body: p });
    await call(pushRoute.POST as Handler, { cookie: secondOwner.cookie, body: p });
    const { rows } = await asOwner<{ user_id: string }>("select user_id from platform.push_subscriptions where endpoint = $1 and tenant_id = $2", [p.endpoint, A.tenantId]);
    expect(rows.map((r) => r.user_id)).toEqual([secondOwner.userId]);
  });

  it("the same phone can be used in two plants (no hidden clash between plants)", async () => {
    const p = phone(4);
    expect((await call(pushRoute.POST as Handler, { cookie: A.adminCookie, body: p })).status).toBe(201);
    expect((await call(pushRoute.POST as Handler, { cookie: B.adminCookie, body: p })).status).toBe(201);
  });
});

describe("push sending", () => {
  async function freshPlantWithPhones() {
    const P = await makePlant({ modules: ["floor_stock"] });
    await call(pushRoute.POST as Handler, { cookie: P.adminCookie, body: phone(100 + ++seq) });
    await call(pushRoute.POST as Handler, { cookie: P.adminCookie, body: phone(100 + ++seq) });
    return P;
  }
  const recorder = (statusFor: (t: PushTarget) => number = () => 201) => {
    const sent: { target: PushTarget; payload: Record<string, string> }[] = [];
    const sender: PushSender = async (target, payload) => {
      sent.push({ target, payload: JSON.parse(payload) });
      return statusFor(target);
    };
    return { sent, sender };
  };

  it("each phone of the recipient gets title, body and the /n/<id> link", async () => {
    const P = await freshPlantWithPhones();
    const { notifyOwners } = await import("@/server/notifications");
    const r = await notifyOwners("floor_stock", P.tenantId, { kind: "k", title: "Low stock: 3 items", body: "Caps 500 ml", link: "/day/2026-10-11", level: "push", dedupe_key: "x" });
    const { sent, sender } = recorder();
    const result = await pushToUsers(P.tenantId, r.messages, sender);
    expect(result).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(sent[0]!.payload).toMatchObject({ title: "Low stock: 3 items", body: "Caps 500 ml" });
    expect(sent[0]!.payload.url).toMatch(/^\/n\/[0-9a-f-]{36}$/);
  });

  it("a phone the push service says is gone (410 / 404) is removed; other errors keep it", async () => {
    const P = await freshPlantWithPhones();
    const { notifyOwners } = await import("@/server/notifications");
    const r = await notifyOwners("floor_stock", P.tenantId, { kind: "k", title: "t", body: "", link: null, level: "push", dedupe_key: "y" });
    let first = true;
    const { sender } = recorder(() => (first ? ((first = false), 410) : 500));
    expect(await pushToUsers(P.tenantId, r.messages, sender)).toEqual({ sent: 0, removed: 1, failed: 1 });
    const { rows } = await asOwner<{ n: number }>("select count(*)::int as n from platform.push_subscriptions where tenant_id = $1", [P.tenantId]);
    expect(rows[0]!.n).toBe(1);
  });

  it("bell-level notifications never go to phones", async () => {
    const P = await freshPlantWithPhones();
    const { notifyOwners } = await import("@/server/notifications");
    const r = await notifyOwners("floor_stock", P.tenantId, { kind: "k", title: "Setup changed", body: "", link: "/setup", level: "bell", dedupe_key: "z" });
    expect(r.created).toBe(1);
    expect(r.messages.size).toBe(0);
  });

  it("without push keys nothing is sent and the bell still works", async () => {
    const P = await freshPlantWithPhones();
    const res = await send(P.tenantId, event({ title: "No keys" }));
    expect(res.status).toBe(201);
    expect((await inbox(P.adminCookie)).body.items[0].title).toBe("No keys");
    expect(await pushToUsers(P.tenantId, new Map([[P.adminUserId, { id: "x", title: "t", body: "" }]]), null)).toEqual({ sent: 0, removed: 0, failed: 0 });
  });
});

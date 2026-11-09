// Drop Phase 6 on the database and the routes, against a fake Firebase: a phone signs up per login, each event reaches
// only the right shop's live phones (and only for its Drop brands), the same event twice is one push, logout and an
// ended session stop pushes, Firebase's answers (sent, phone gone, try later, key refused → owners' alert after an
// hour), new polls and points ending, the push job's secret, and nothing leaks across plants.
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TenantSku } from "@plantops/types";
import { resetRateLimits } from "@plantops/module-kit/http";
import { POST as deviceRoute } from "@/app/api/app/v1/devices/route";
import { POST as logoutRoute } from "@/app/api/app/v1/logout/route";
import { POST as pushJobRoute } from "@/app/api/cron/drop-push/route";
import { createCustomer } from "@/server/customers";
import { tokenHash } from "@/server/drop/login";
import { setDrop, SetDropInput } from "@/server/drop/manage";
import { PointsSettingsInput, savePointsSettings } from "@/server/drop/points";
import { createPoll, PollInput } from "@/server/drop/polls";
import { linesText, pushFreeBoxes, pushOrder, queuePointsEnding, queuePolls, runPushJob, sendWaiting } from "@/server/drop/push";
import { saveRates } from "@/server/rates";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, plant } from "./helpers";

const sku = (name: string, ml: number) => ({ id: randomUUID(), name, sku_code: null, volume_ml: ml, units_per_pack: 12, pack_type: "case", status: "active" }) as TenantSku;
const b1 = sku("Bluemins 1L Water Bottle", 1000);
const b500 = sku("Bluemins 500ml Water Bottle", 500);
const m1 = sku("Mr.Charge 1 Litre Deionised Water", 1000);

// ---------- a fake Firebase (token + send) ----------
type Sent = { token: string; title: string; body: string; tab: string };
const fcm = { sent: [] as Sent[], answer: (_m: Sent): [number, unknown] => [200, { name: "projects/p/messages/1" }], tokenStatus: 200, tokenCalls: 0 };
let fcmServer: Server;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

let platform: FakePlatform;
const plants: string[] = [];
const IST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const daysFrom = (n: number) => IST(new Date(Date.now() + n * 86_400_000));

function configure() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
}
beforeAll(async () => {
  platform = await startFakePlatform();
  platform.skus = [b1, b500, m1];
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
  process.env.CRON_SECRET = "c".repeat(40);
  fcmServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/token") {
        fcm.tokenCalls++;
        res.writeHead(fcm.tokenStatus, { "content-type": "application/json" }).end(JSON.stringify(fcm.tokenStatus === 200 ? { access_token: "at-1", expires_in: 3600 } : { error: "invalid_grant" }));
        return;
      }
      const m = (JSON.parse(raw) as { message: { token: string; notification: { title: string; body: string }; data: { tab: string } } }).message;
      const sent = { token: m.token, title: m.notification.title, body: m.notification.body, tab: m.data.tab };
      const [status, body] = fcm.answer(sent);
      if (status === 200) fcm.sent.push(sent);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => fcmServer.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(fcmServer.address() as AddressInfo).port}`;
  process.env.FCM_API_URL = url;
  process.env.FCM_TOKEN_URL = `${url}/token`;
  process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({ project_id: "drop-test", client_email: "push@drop-test.iam.gserviceaccount.com", private_key: privateKey });
});
afterAll(async () => {
  await platform.close();
  await new Promise((r) => fcmServer.close(r));
  for (const k of ["DROP_APPS", "DROP_CODE_SECRET", "CRON_SECRET", "FCM_API_URL", "FCM_TOKEN_URL", "FCM_SERVICE_ACCOUNT"]) delete process.env[k];
});
beforeEach(() => {
  resetRateLimits();
  configure();
  fcm.sent = [];
  fcm.answer = () => [200, { name: "projects/p/messages/1" }];
  fcm.tokenStatus = 200;
  platform.notifications.length = 0;
});

let n = 0;
async function pushPlant() {
  const p = plant();
  plants.push(p.tenantId);
  configure();
  await saveRates(p.owner, { rates: [{ sku_id: m1.id, unit: "box", default_rate: "", brand: "Mr.Charge" }] });
  return { ...p, app: `app-${plants.length - 1}` };
}

/** A switched-on shop (optionally also Mr.Charge) with a logged-in phone that signed up for pushes. */
async function shop(p: Awaited<ReturnType<typeof pushPlant>>, o: { brands?: string[]; device?: boolean } = {}) {
  const phone = `98620${String(++n).padStart(5, "0")}`;
  const c = (await createCustomer(p.owner, { name: `Shop ${n}`, phone, place: "Bijepur" })).customer;
  await setDrop(p.owner, c.id, SetDropInput.parse({ enabled: true, brands: o.brands ?? [] }));
  const token = `dpt_${randomBytes(32).toString("base64url")}`;
  await asOwner(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ($1, $2, $3, $4, now() + interval '90 days')`, [p.tenantId, c.id, phone, tokenHash(token)]);
  const fcmToken = `fcm-${randomBytes(24).toString("hex")}`;
  if (o.device !== false) expect((await device(p.app, token, fcmToken)).status).toBe(200);
  return { ...c, token, fcmToken };
}

const headers = (app: string, token: string) => ({ "content-type": "application/json", "x-drop-app": app, authorization: `Bearer ${token}`, "x-forwarded-for": "10.0.0.2" });
async function device(app: string, token: string, fcmToken: string) {
  const res = await deviceRoute(new Request("http://localhost:3005/api/app/v1/devices", { method: "POST", headers: headers(app, token), body: JSON.stringify({ token: fcmToken }) }));
  return { status: res.status, body: await res.json() };
}

/** A pending order with lines straight in the database (the staff form's save is tested elsewhere). */
async function order(p: { tenantId: string }, c: { id: string; phone: string }, lines: { sku: TenantSku; qty: number; free?: boolean }[]) {
  const [o] = (await asOwner<{ id: string }>(
    `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, total, entered_by, entered_by_name)
     values ($1, ${3000 + ++n}, $2, $3, 'Shop', $4, 'Bijepur', 500, gen_random_uuid(), 'Atharv') returning id`,
    [p.tenantId, `k-${randomUUID()}`, c.id, c.phone],
  )).rows;
  let no = 0;
  for (const l of lines)
    await asOwner(`insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total, free) values ($1, $2, 1, $3, $4, $5, 'box', $6, $7, $8, $9)`, [
      p.tenantId, o!.id, ++no, l.sku.id, l.sku.name, l.qty, l.free ? 0 : 50, l.free ? 0 : 50 * l.qty, !!l.free,
    ]);
  return o!.id;
}

const outbox = async (tenantId: string) =>
  (await asOwner<{ kind: string; title: string; body: string; tab: string; sent_at: Date | null; gave_up_at: Date | null; tries: number; fcm_token: string; device_removed: Date | null }>(
    `select o.kind, o.title, o.body, o.tab, o.sent_at, o.gave_up_at, o.tries, d.fcm_token, d.removed_at as device_removed
       from order_capture.app_push_outbox o join order_capture.app_devices d on d.id = o.device_id where o.tenant_id = $1 order by o.created_at`, [tenantId])).rows;

describe("Drop push", () => {
  it("lines text: sizes, units and free boxes, never money", () => {
    expect(linesText([{ size: "1L", unit: "box", qty: 20, free: 2 }, { size: "500ml", unit: "box", qty: 10, free: 0 }])).toBe("1L × 20 box + 2 free, 500ml × 10 box");
    expect(linesText([{ size: "1L", unit: "box", qty: 0, free: 1 }])).toBe("1L × 1 free");
  });

  it("a phone signs up per login; the same token again is one row; a new login takes the token over", async () => {
    const p = await pushPlant();
    const s = await shop(p);
    expect((await device(p.app, s.token, s.fcmToken)).status).toBe(200);
    expect((await asOwner(`select 1 from order_capture.app_devices where tenant_id = $1 and removed_at is null`, [p.tenantId])).rows).toHaveLength(1);
    // without a login: refused
    expect((await device(p.app, "dpt_" + "x".repeat(43), s.fcmToken)).status).toBe(401);
    // the same phone logs in again (new session): the old row is replaced
    const token2 = `dpt_${randomBytes(32).toString("base64url")}`;
    await asOwner(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ($1, $2, $3, $4, now() + interval '90 days')`, [p.tenantId, s.id, s.phone, tokenHash(token2)]);
    expect((await device(p.app, token2, s.fcmToken)).status).toBe(200);
    const rows = (await asOwner<{ remove_reason: string | null }>(`select remove_reason from order_capture.app_devices where tenant_id = $1 order by created_at`, [p.tenantId])).rows;
    expect(rows.map((r) => r.remove_reason)).toEqual(["replaced", null]);
  });

  it("order received / delivered: only the shop's phones, only its Drop brands, once per event, no amounts", async () => {
    const p = await pushPlant();
    const a = await shop(p);
    const other = await shop(p);
    const both = await shop(p, { brands: ["Mr.Charge"] });
    const id = await order(p, a, [{ sku: b1, qty: 20 }, { sku: b1, qty: 2, free: true }, { sku: m1, qty: 5 }, { sku: b500, qty: 10 }]);
    expect(await pushOrder(p.tenantId, id, "received")).toBe(1);
    expect(await pushOrder(p.tenantId, id, "received")).toBe(0); // same event again
    expect(fcm.sent).toEqual([{ token: a.fcmToken, title: "Order received", body: "1L × 20 box + 2 free, 500ml × 10 box", tab: "home" }]);
    expect(JSON.stringify(fcm.sent)).not.toMatch(/₹|500 |Atharv/);
    // a Mr.Charge-only order pushes nothing to a Bluemins-only shop, but reaches a shop that has Mr.Charge ticked
    expect(await pushOrder(p.tenantId, await order(p, other, [{ sku: m1, qty: 5 }]), "received")).toBe(0);
    expect(await pushOrder(p.tenantId, await order(p, both, [{ sku: m1, qty: 5 }]), "delivered")).toBe(1);
    expect(fcm.sent.at(-1)).toEqual({ token: both.fcmToken, title: "Order delivered", body: "1L × 5 box", tab: "home" });
    // a shop switched off for Drop hears nothing
    await setDrop(p.owner, a.id, SetDropInput.parse({ enabled: false }));
    expect(await pushOrder(p.tenantId, id, "delivered")).toBe(0);
  });

  it("logout and an ended session stop pushes; a shop without a phone gets nothing", async () => {
    const p = await pushPlant();
    const s = await shop(p);
    const res = await logoutRoute(new Request("http://localhost:3005/api/app/v1/logout", { method: "POST", headers: headers(p.app, s.token), body: "{}" }));
    expect(res.status).toBe(200);
    expect((await asOwner<{ remove_reason: string }>(`select remove_reason from order_capture.app_devices where tenant_id = $1`, [p.tenantId])).rows).toEqual([{ remove_reason: "logout" }]);
    expect(await pushOrder(p.tenantId, await order(p, s, [{ sku: b1, qty: 1 }]), "received")).toBe(0);
    const ended = await shop(p);
    await asOwner(`update order_capture.app_sessions set ended_at = now(), end_reason = 'switched_off' where tenant_id = $1 and customer_id = $2`, [p.tenantId, ended.id]);
    expect(await pushOrder(p.tenantId, await order(p, ended, [{ sku: b1, qty: 1 }]), "received")).toBe(0);
    const none = await shop(p, { device: false });
    expect(await pushOrder(p.tenantId, await order(p, none, [{ sku: b1, qty: 1 }]), "received")).toBe(0);
  });

  it("Firebase's answers: phone gone → removed; try later → waits; bad message → given up", async () => {
    const p = await pushPlant();
    const gone = await shop(p);
    const later = await shop(p);
    fcm.answer = (m) => (m.token === gone.fcmToken ? [404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }] : [503, { error: { status: "UNAVAILABLE" } }]);
    await pushOrder(p.tenantId, await order(p, gone, [{ sku: b1, qty: 1 }]), "received");
    await pushOrder(p.tenantId, await order(p, later, [{ sku: b1, qty: 1 }]), "received");
    const rows = await outbox(p.tenantId);
    expect(rows.find((r) => r.fcm_token === gone.fcmToken)).toMatchObject({ gave_up_at: expect.any(Date), device_removed: expect.any(Date) });
    expect(rows.find((r) => r.fcm_token === later.fcmToken)).toMatchObject({ sent_at: null, gave_up_at: null, tries: 1 });
    // not due yet: nothing tried; due again and Firebase back → sent
    fcm.answer = () => [200, {}];
    expect((await sendWaiting(p.tenantId)).sent).toBe(0);
    expect((await sendWaiting(p.tenantId, 200, new Date(Date.now() + 10 * 60_000))).sent).toBe(1);
    // a message Firebase can't take is given up, the phone kept
    const bad = await shop(p);
    fcm.answer = () => [400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } }];
    await pushOrder(p.tenantId, await order(p, bad, [{ sku: b1, qty: 1 }]), "received");
    expect((await outbox(p.tenantId)).find((r) => r.fcm_token === bad.fcmToken)).toMatchObject({ gave_up_at: expect.any(Date), device_removed: null });
  });

  it("key refused: retried, and the owners hear about it once the push has waited an hour", async () => {
    const p = await pushPlant();
    const s = await shop(p);
    fcm.tokenStatus = 400;
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({ project_id: "drop-test-2", client_email: "push@drop-test.iam.gserviceaccount.com", private_key: privateKey }); // new key: no cached token
    await pushOrder(p.tenantId, await order(p, s, [{ sku: b1, qty: 1 }]), "received");
    expect(platform.notifications.filter((x) => x.body.kind === "order_capture.drop_push_failed")).toHaveLength(0);
    await sendWaiting(p.tenantId, 200, new Date(Date.now() + 2 * 3_600_000));
    expect(platform.notifications.filter((x) => x.tenantId === p.tenantId && x.body.kind === "order_capture.drop_push_failed")).toHaveLength(1);
    expect((await outbox(p.tenantId))[0]).toMatchObject({ sent_at: null, gave_up_at: null });
    // older than 3 days: given up
    await sendWaiting(p.tenantId, 200, new Date(Date.now() + 4 * 86_400_000));
    expect((await outbox(p.tenantId))[0]).toMatchObject({ gave_up_at: expect.any(Date) });
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({ project_id: "drop-test", client_email: "push@drop-test.iam.gserviceaccount.com", private_key: privateKey });
  });

  it("free box on an order: to that shop, once", async () => {
    const p = await pushPlant();
    const s = await shop(p);
    const id = await order(p, s, [{ sku: b1, qty: 1 }]);
    await asOwner(
      `insert into order_capture.points_redemptions (tenant_id, customer_id, asked_by_phone, sku_id, label, points, year_end, request_key, order_id, added_by, added_by_name, added_at)
       values ($1, $2, $3, $4, '1L box', 800, $5, $6, $7, gen_random_uuid(), 'Atharv', now())`,
      [p.tenantId, s.id, s.phone, b1.id, daysFrom(60), `rk-${randomUUID().slice(0, 12)}`, id],
    );
    expect(await pushFreeBoxes(p.tenantId, id)).toBe(1);
    expect(await pushFreeBoxes(p.tenantId, id)).toBe(0);
    expect(fcm.sent).toEqual([{ token: s.fcmToken, title: "Your free box is coming", body: "Your free 1L box comes with your next delivery.", tab: "points" }]);
  });

  it("new polls: open ones of the shop's brands, not answered, once; by the push job", async () => {
    const p = await pushPlant();
    const blue = await shop(p);
    const charge = await shop(p, { brands: ["Mr.Charge"] });
    const done = await shop(p);
    await savePointsSettings(p.owner, PointsSettingsInput.parse({ effective_from: daysFrom(0), start_date: daysFrom(-40), rupees_per_point: "20", late_days: 5, poll_points: 10, redeem_months: [7], rewards: [] }));
    const poll = await createPoll(p.owner, PollInput.parse({ question: "Which size sells most?", choices: ["1L", "500ml"], other_allowed: false, brands: ["Mr.Charge"], opens_on: daysFrom(0), closes_on: daysFrom(6) }));
    await createPoll(p.owner, PollInput.parse({ question: "Opens tomorrow?", choices: ["Yes", "No"], other_allowed: false, brands: ["Bluemins"], opens_on: daysFrom(1), closes_on: daysFrom(6) }));
    await asOwner(`insert into order_capture.poll_answers (tenant_id, poll_id, customer_id, phone, choice, points, points_reason) values ($1, $2, $3, $4, 0, 0, 'no_recent_order')`, [p.tenantId, poll.id, done.id, done.phone]);
    expect(await queuePolls(p.tenantId)).toBe(1);
    expect(await queuePolls(p.tenantId)).toBe(0);
    const job = await runPushJob();
    expect(job.sent).toBeGreaterThanOrEqual(1);
    expect(fcm.sent.filter((m) => [blue.fcmToken, charge.fcmToken, done.fcmToken].includes(m.token))).toEqual([{ token: charge.fcmToken, title: "New poll: earn 10 points", body: "Which size sells most?", tab: "polls" }]);
  });

  it("points ending: only on 1 Dec and 15 Jan, shops with points", async () => {
    const p = await pushPlant();
    const s = await shop(p);
    const none = await shop(p);
    await savePointsSettings(p.owner, PointsSettingsInput.parse({ effective_from: daysFrom(0), start_date: daysFrom(-40), rupees_per_point: "20", late_days: 5, poll_points: 10, redeem_months: [7], rewards: [] }));
    const poll = await createPoll(p.owner, PollInput.parse({ question: "Which size?", choices: ["A", "B"], other_allowed: false, brands: ["Bluemins"], opens_on: daysFrom(0), closes_on: daysFrom(6) }));
    await asOwner(`insert into order_capture.poll_answers (tenant_id, poll_id, customer_id, phone, choice, points, points_reason) values ($1, $2, $3, $4, 0, 10, 'counted')`, [p.tenantId, poll.id, s.id, s.phone]);
    const at = (ymd: string) => new Date(`${ymd}T09:00:00+05:30`);
    const year = Number(daysFrom(0).slice(0, 4));
    expect(await queuePointsEnding(p.tenantId, at(`${year}-11-30`))).toBe(0);
    // the points-on date is relative to now, so check on a 1 Dec / 15 Jan that is after today
    const dec = Number(daysFrom(0).slice(5, 7)) === 12 ? `${year + 1}-01-15` : `${year}-12-01`;
    expect(await queuePointsEnding(p.tenantId, at(dec))).toBe(1);
    expect(await queuePointsEnding(p.tenantId, at(dec))).toBe(0);
    const rows = await outbox(p.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "points_ending", title: "Your points end soon", tab: "points", fcm_token: s.fcmToken });
    expect(rows[0]!.body).toMatch(/^10 points end on /);
    expect(none.id).toBeTruthy();
  });

  it("the push job needs its secret; plants never see each other's phones or pushes", async () => {
    expect((await pushJobRoute(new Request("http://localhost:3005/api/cron/drop-push", { method: "POST" }))).status).toBe(401);
    expect((await pushJobRoute(new Request("http://localhost:3005/api/cron/drop-push", { method: "POST", headers: { "x-cron-secret": "c".repeat(40) } }))).status).toBe(200);
    const a = await pushPlant();
    const b = await pushPlant();
    const s = await shop(a);
    await pushOrder(a.tenantId, await order(a, s, [{ sku: b1, qty: 1 }]), "received");
    expect((await asApp(b.tenantId, `select * from order_capture.app_devices where tenant_id = '${a.tenantId}'`)).rows).toEqual([]);
    expect((await asApp(b.tenantId, `select * from order_capture.app_push_outbox where tenant_id = '${a.tenantId}'`)).rows).toEqual([]);
    expect((await asApp(a.tenantId, `select * from order_capture.app_push_outbox`)).rows.length).toBe(1);
  });
});

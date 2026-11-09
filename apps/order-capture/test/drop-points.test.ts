// Drop Phase 3 on the database and the routes: the points API, asking for a free box, staff putting it on an order
// (New order and the order page), delivered = spent, order cancelled / staff cancel = points back, the rules for asking,
// settings (owner only), no amounts in the app's answers, plant isolation, the notification, set-once refusals.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSku } from "@plantops/types";
import { resetRateLimits } from "@plantops/module-kit/http";
import { GET as homeRoute } from "@/app/api/app/v1/home/route";
import { GET as pointsRoute } from "@/app/api/app/v1/points/route";
import { POST as redeemRoute } from "@/app/api/app/v1/points/redeem/route";
import { recentChanges } from "@/server/audit";
import { createCustomer } from "@/server/customers";
import { tokenHash } from "@/server/drop/login";
import { setDrop, SetDropInput } from "@/server/drop/manage";
import { addRewardToOrder, cancelReward, PointsSettingsInput, rewardsList, savePointsSettings } from "@/server/drop/points";
import { cancelOrder, deliverOrder, DeliverInput, getOrder, ReasonInput } from "@/server/handling";
import { listOrders } from "@/server/list";
import { createOrder, lookupCustomer, OrderInput } from "@/server/orders";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, plant, refused } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const sku = (name: string, ml: number) => ({ id: randomUUID(), name, sku_code: null, volume_ml: ml, units_per_pack: 12, pack_type: "case", status: "active" }) as TenantSku;
const b1 = sku("Bluemins 1L Water Bottle", 1000);
const m1 = sku("Mr.Charge 1 Litre Deionised Water", 1000);

let platform: FakePlatform;
const plants: string[] = [];
const IST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const daysAgo = (n: number) => IST(new Date(Date.now() - n * 86_400_000));
const today = () => IST(new Date());

function configure() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
}
beforeAll(async () => {
  platform = await startFakePlatform();
  platform.skus = [b1, m1];
  process.env.PLATFORM_URL = platform.url;
  process.env.DROP_CODE_SECRET = "s".repeat(40);
});
afterAll(async () => {
  await platform.close();
  for (const k of ["DROP_APPS", "DROP_CODE_SECRET"]) delete process.env[k];
});
beforeEach(() => {
  resetRateLimits();
  configure();
});

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const settings = (over: Partial<Record<string, unknown>> = {}) =>
  PointsSettingsInput.parse({ effective_from: today(), start_date: daysAgo(40), rupees_per_point: "1", late_days: 5, poll_points: 10, redeem_months: ALL_MONTHS, rewards: [{ sku_id: b1.id, points: 800 }], ...over });

let n = 0;
const key = () => `rk${Date.now().toString(36)}${(n++).toString(36)}xyz`;
const newOrder = (p: ReturnType<typeof plant>, extra: Record<string, unknown> = {}) =>
  createOrder(p.desk, OrderInput.parse({ request_key: key(), customer: { phone: "9861000001" }, lines: [{ sku_id: b1.id, quantity: 5, rate: "100" }], ...extra }));

/** A switched-on shop that earned 2,000 points: a ₹2,000 Bluemins bill for an order delivered 10 days ago, paid 2 days later. */
async function shopPlant() {
  const p = plant();
  plants.push(p.tenantId);
  configure();
  const shop = (await createCustomer(p.owner, { name: "Shree Stores", phone: "9861000001", place: "Bijepur" })).customer;
  await setDrop(p.owner, shop.id, SetDropInput.parse({ enabled: true }));
  await savePointsSettings(p.owner, settings());
  const t = p.tenantId;
  const o = await newOrder(p);
  await asOwner(`update order_capture.orders set status = 'delivered', delivered_at = now() - interval '10 days', delivered_by = gen_random_uuid(), delivered_by_name = 'x', status_changed_at = now() - interval '10 days' where id = $1`, [o.id]);
  const [b] = (await asOwner<{ id: string }>(`insert into order_capture.bills (tenant_id, source, number, ref_no, bill_date, customer_id, customer_name, order_id, sub_total, total, created_by, created_by_name)
    values ($1, 'plantops', 'B-0501', 501, $2, $3, 'Shree Stores', $4, 2000, 2000, gen_random_uuid(), 'Sujata') returning id`, [t, daysAgo(10), shop.id, o.id])).rows;
  await asOwner(`insert into order_capture.bill_lines (tenant_id, bill_id, line_no, sku_id, item_name, quantity, rate, line_total) values ($1, $2, 1, $3, $4, 20, 100, 2000)`, [t, b!.id, b1.id, b1.name]);
  const [pay] = (await asOwner<{ id: string }>(`insert into order_capture.payments (tenant_id, source, number, ref_no, payment_date, customer_id, customer_name, mode, amount, created_by, created_by_name)
    values ($1, 'plantops', 'P-0501', 501, $2, $3, 'Shree Stores', 'cash', 2000, gen_random_uuid(), 'Sujata') returning id`, [t, daysAgo(8), shop.id])).rows;
  await asOwner(`insert into order_capture.payment_allocations (tenant_id, payment_id, bill_id, amount, allocated_on, created_by, created_by_name) values ($1, $2, $3, 2000, $4, gen_random_uuid(), 'Sujata')`, [t, pay!.id, b!.id, daysAgo(8)]);
  const token = `dpt_${randomBytes(32).toString("base64url")}`;
  await asOwner(`insert into order_capture.app_sessions (tenant_id, customer_id, phone, token_sha256, expires_at) values ($1, $2, '9861000001', $3, now() + interval '90 days')`, [t, shop.id, tokenHash(token)]);
  return { ...p, app: `app-${plants.length - 1}`, shop, token };
}

const req = (app: string, token: string, body?: unknown) =>
  new Request("http://localhost:3005/api/app/v1/points", {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-drop-app": app, authorization: `Bearer ${token}`, "x-forwarded-for": "10.0.0.1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function points(p: { app: string; token: string }) {
  const res = await pointsRoute(req(p.app, p.token));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}
async function ask(p: { app: string; token: string }, reward: string, k = key()) {
  const res = await redeemRoute(req(p.app, p.token, { reward, request_key: k }));
  await settle();
  return { status: res.status, body: await res.json() };
}
const seen = (status: "pending" | "delivered", version = 1) => ({ status, version });

describe("Drop points", () => {
  it("the shop's points: balance, free boxes it can use, the monthly record; never bills or amounts", async () => {
    const p = await shopPlant();
    const r = await points(p);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ on: true, balance: 2000, redeem_open: true, opens_on: null, open_request: null });
    expect(r.body.rewards).toEqual([{ id: b1.id, label: b1.name, size: "1L", points: 800, can_use: true, why_not: null }]);
    expect(r.body.record).toEqual([{ month: daysAgo(8).slice(0, 7), purchases: 2000, polls: 0, boxes: [] }]);
    for (const leak of ["B-0501", "P-0501", "2000.00", "rate", "amount", "paise", "cash", "Sujata"]) expect(r.text).not.toContain(leak);
    const home = await homeRoute(new Request("http://localhost:3005/api/app/v1/home", { headers: { "x-drop-app": p.app, authorization: `Bearer ${p.token}` } }));
    expect((await home.json()).points).toEqual({ balance: 2000, next: { label: b1.name, missing: 0 } });
  });

  it("asking: points held at once, the owners told, one at a time, a repeated tap is the same request", async () => {
    const p = await shopPlant();
    const before = platform.notifications.length;
    const k = key();
    const a = await ask(p, b1.id, k);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ balance: 1200, open_request: { label: b1.name, state: "asked" }, asked: { label: b1.name, points: 800 } });
    const sent = platform.notifications.slice(before).filter((x) => x.tenantId === p.tenantId);
    expect(sent.map((x) => x.body.kind)).toEqual(["order_capture.drop_redeem"]);
    expect(sent[0]!.body).toMatchObject({ title: "Free box asked: Shree Stores", link: "/customers/drop/rewards", level: "push" });
    const again = await ask(p, b1.id, k);
    expect(again.status).toBe(200);
    expect(again.body.balance).toBe(1200);
    const other = await ask(p, b1.id);
    expect(other.status).toBe(409);
    expect(other.body.error.message).toMatch(/already asked/);
    const { rows } = await asOwner("select 1 from order_capture.points_redemptions where tenant_id = $1", [p.tenantId]);
    expect(rows).toHaveLength(1);
    expect(platform.notifications.slice(before).filter((x) => x.tenantId === p.tenantId)).toHaveLength(1);
  });

  it("refused outside the free-box months, with too few points, for a reward not offered; another plant's app can't", async () => {
    const p = await shopPlant();
    const month = Number(today().slice(5, 7));
    await savePointsSettings(p.owner, settings({ redeem_months: ALL_MONTHS.filter((m) => m !== month) }));
    const off = await ask(p, b1.id);
    expect(off.status).toBe(409);
    expect(off.body.error.message).toMatch(/free-box months/);
    expect((await points(p)).body).toMatchObject({ redeem_open: false, opens_on: expect.stringMatching(/^\d{4}-\d{2}-01$/) });
    await savePointsSettings(p.owner, settings({ rewards: [{ sku_id: b1.id, points: 5000 }] }));
    expect((await ask(p, b1.id)).body.error.message).toMatch(/Not enough points/);
    expect((await ask(p, m1.id)).status).toBe(404);
    const q = await shopPlant();
    expect((await ask({ app: q.app, token: p.token }, b1.id)).status).toBe(401);
  });

  it("New order offers the free box asked and puts it on the order (not a line, not charged); delivered = spent", async () => {
    const p = await shopPlant();
    await ask(p, b1.id);
    const look = await lookupCustomer(p.desk, "9861000001");
    expect(look.reward_asked).toMatchObject({ label: b1.name, points: 800 });
    const o = await newOrder(p, { reward_id: look.reward_asked!.id });
    expect(o.rewards).toEqual([{ label: b1.name }]);
    expect(o.lines).toHaveLength(1);
    expect(o.total).toBe("500.00");
    expect((await lookupCustomer(p.desk, "9861000001")).reward_asked).toBeNull();
    const list = await listOrders(p.desk, { tab: "pending" });
    expect(list.orders.find((x) => x.id === o.id)!.rewards).toEqual([b1.name]);
    expect((await rewardsList(p.desk)).open[0]).toMatchObject({ state: "on_order", order: { id: o.id } });
    expect((await points(p)).body.open_request).toEqual({ label: b1.name, state: "on_order" });
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: seen("pending") }));
    const after = await points(p);
    expect(after.body.balance).toBe(1200);
    expect(after.body.open_request).toBeNull();
    expect((await refused(() => cancelReward(p.desk, look.reward_asked!.id, { reason: "Changed mind" }))).status).toBe(409);
    const changes = (await recentChanges(p.owner)).map((c) => c.text);
    expect(changes.some((c) => c.includes("added to O-"))).toBe(true);
  });

  it("an order cancelled, or staff cancelling the request, gives the points back", async () => {
    const p = await shopPlant();
    await ask(p, b1.id);
    const r1 = (await rewardsList(p.owner)).open[0]!;
    const o = await newOrder(p);
    await addRewardToOrder(p.desk, r1.id, o.id);
    expect((await getOrder(p.desk, o.id)).id).toBe(o.id);
    await cancelOrder(p.desk, o.id, ReasonInput.parse({ expected: seen("pending"), reason: "Shop closed" }));
    let r = await points(p);
    expect(r.body.balance).toBe(2000);
    expect(r.body.record[0].boxes).toEqual([{ label: b1.name, state: "returned", date: today() }]);
    await ask(p, b1.id);
    const r2 = (await rewardsList(p.owner)).open[0]!;
    expect(r2.state).toBe("asked");
    expect((await refused(() => cancelReward(p.support, r2.id, { reason: "x y z" }))).status).toBe(403);
    await cancelReward(p.desk, r2.id, { reason: "Asked by mistake" });
    r = await points(p);
    expect(r.body.balance).toBe(2000);
    expect(r.body.open_request).toBeNull();
    expect((await refused(() => cancelReward(p.desk, r2.id, { reason: "Again" }))).status).toBe(409);
  });

  it("staff rules: owner only for settings, no past dates, a free box only on its own shop's pending order", async () => {
    const p = await shopPlant();
    expect((await refused(() => savePointsSettings(p.desk, settings()))).status).toBe(403);
    expect((await refused(() => savePointsSettings(p.owner, settings({ effective_from: daysAgo(1) })))).status).toBe(400);
    await ask(p, b1.id);
    const r = (await rewardsList(p.owner)).open[0]!;
    const other = (await createCustomer(p.owner, { name: "Other Shop", phone: "9437000002", place: "Bargarh" })).customer;
    const theirs = await createOrder(p.desk, OrderInput.parse({ request_key: key(), customer: { phone: other.phone }, lines: [{ sku_id: b1.id, quantity: 1, rate: "100" }] }));
    expect((await refused(() => addRewardToOrder(p.desk, r.id, theirs.id))).status).toBe(400);
    const mine = await newOrder(p);
    await deliverOrder(p.desk, mine.id, DeliverInput.parse({ expected: seen("pending") }));
    expect((await refused(() => addRewardToOrder(p.desk, r.id, mine.id))).status).toBe(409);
    expect((await refused(() => addRewardToOrder(p.staff, r.id, mine.id))).status).toBe(403);
  });

  it("the database: an order link and a cancellation are each set once", async () => {
    const p = await shopPlant();
    await ask(p, b1.id);
    const r = (await rewardsList(p.owner)).open[0]!;
    const o = await newOrder(p);
    await addRewardToOrder(p.desk, r.id, o.id);
    const o2 = await newOrder(p);
    expect(await dbError(asApp(p.tenantId, `update order_capture.points_redemptions set order_id = '${o2.id}' where id = '${r.id}'`))).toMatch(/only once/);
    await cancelReward(p.owner, r.id, { reason: "Not needed" });
    expect(await dbError(asApp(p.tenantId, `update order_capture.points_redemptions set cancel_reason = 'Other reason' where id = '${r.id}'`))).toMatch(/only once/);
  });
});

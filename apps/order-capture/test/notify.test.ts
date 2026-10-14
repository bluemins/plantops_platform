// Phase 6: the three notifications exactly as the plan's table (kind, recipients, excluded actor, level, dedupe,
// texts), sent through the real routes once the answer has gone; the outbox (kept on 5xx, not on 4xx); the daily
// job's secret.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeInput, changeOrder, ReasonInput, undoDelivered } from "@/server/handling";
import { cancelledNotification, deliveredNotification, newOrderNotification } from "@/server/notify";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, jsonReq, plant, signInAs } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const { POST: postOrder } = await import("@/app/api/orders/route");
const { POST: postDeliver } = await import("@/app/api/orders/[id]/deliver/route");
const { POST: postCancel } = await import("@/app/api/orders/[id]/cancel/route");
const { POST: cron } = await import("@/app/api/cron/daily/route");

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifications.length = 0;
  platform.notifyStatus = 201;
});
afterEach(() => vi.restoreAllMocks());

const [b1l, b500] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0]];
let k = 0;
const SAMPLE = { customer: { phone: "98765 43210", name: "Sri ram hotel", place: "bijepur" }, lines: [{ sku_id: b500.id, quantity: 1, rate: "90" }, { sku_id: b1l.id, quantity: 3, rate: "140" }] };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const sent = () => platform.notifications.map((n) => n.body);

/** The Order desk saves the sample order through the real route; returns the saved order. */
async function saveSample(p: ReturnType<typeof plant>, key = `notify-${Date.now()}-${++k}`) {
  signInAs(p.desk);
  const res = await postOrder(jsonReq("POST", "/api/orders", { request_key: key, ...SAMPLE }), undefined as never);
  vi.restoreAllMocks();
  await settle();
  return (await res.json()) as { id: string; ref: string };
}

describe("1. new order (phone + bell): owners + ticked people, not whoever saved it", () => {
  it("one notification exactly as the plan's table, no phone number", async () => {
    const p = plant();
    const o = await saveSample(p);
    expect(sent()).toEqual([
      {
        kind: "order_capture.new",
        title: "New order O-0001: ₹510",
        body: "Sri ram hotel, bijepur. Bluemins (500 ml × 24) 1 box, Bluemins (1 L × 12) 3 box (by Atharv)",
        link: `/o/${o.id}`,
        level: "push",
        dedupe_key: `new:${o.id}`,
        exclude_user_id: p.desk.userId,
      },
    ]);
    expect(platform.notifications[0]!.tenantId).toBe(p.tenantId);
    expect(JSON.stringify(sent())).not.toMatch(/98765|9876543210/);
  });

  it("a repeated request key returns the same order and tells nobody again", async () => {
    const p = plant();
    await saveSample(p, "same-key-notify-1");
    await saveSample(p, "same-key-notify-1");
    expect(sent()).toHaveLength(1);
  });

  it("long texts are trimmed to the platform's limits", () => {
    const p = plant();
    const n = newOrderNotification(p.desk, {
      id: "x",
      ref: "O-0042",
      created: true,
      total: "510.00",
      customer: { name: "N".repeat(100), place: "P".repeat(200), phone: "9876543210" },
      lines: [{ product: "X".repeat(120), unit: "box", quantity: 1, rate: "90.00", total: "90.00" }],
      note: "N".repeat(300),
    });
    expect(n.title.length).toBeLessThanOrEqual(80);
    expect(n.body!.length).toBe(300);
    expect(n.body!.endsWith("…")).toBe(true);
  });

  it("the order note goes at the end of the body, on one line", () => {
    const p = plant();
    const n = newOrderNotification(p.desk, {
      id: "x",
      ref: "O-0042",
      created: true,
      total: "90.00",
      customer: { name: "Sri ram hotel", place: "bijepur", phone: "9876543210" },
      lines: [{ product: "Bluemins (500 ml × 24)", unit: "box", quantity: 1, rate: "90.00", total: "90.00" }],
      note: "Deliver after 4 pm\nGate 2",
    });
    expect(n.body).toBe("Sri ram hotel, bijepur. Bluemins (500 ml × 24) 1 box (by Atharv) Note: Deliver after 4 pm Gate 2");
  });
});

describe("2. delivered (bell): only the person who entered it", () => {
  it("the owner delivers the desk's order: to the desk only (also_user_ids + only_listed), not the owner", async () => {
    const p = plant();
    const o = await saveSample(p);
    platform.notifications.length = 0;
    signInAs(p.owner);
    await postDeliver(jsonReq("POST", "/x", { expected: { status: "pending", version: 1 }, note: "handed to the manager", invoice_no: "INV-1" }), ctx(o.id));
    await settle();
    const [n] = sent();
    const [ev] = (await asOwner<{ id: string }>("select id from order_capture.order_events where order_id = $1 and kind = 'delivered'", [o.id])).rows;
    expect(sent()).toHaveLength(1);
    expect(n).toEqual({
      kind: "order_capture.delivered",
      title: "O-0001 delivered",
      body: "Sri ram hotel · handed to the manager",
      link: `/o/${o.id}`,
      level: "bell",
      dedupe_key: `delivered:${o.id}:${ev!.id}`,
      exclude_user_id: p.owner.userId,
      also_user_ids: [p.desk.userId],
      only_listed: true,
    });
  });

  it("nobody is told when the person who entered it delivers it themselves", async () => {
    const p = plant();
    const o = await saveSample(p);
    platform.notifications.length = 0;
    signInAs(p.desk);
    expect((await postDeliver(jsonReq("POST", "/x", { expected: { status: "pending", version: 1 } }), ctx(o.id))).status).toBe(200);
    await settle();
    expect(sent()).toEqual([]);
    expect(deliveredNotification(p.desk, { order_id: o.id, ref: "O-0001", customer: "x", place: "y", entered_by: p.desk.userId, event_id: "e", text: null })).toBeNull();
  });
});

describe("3. cancelled (bell): owners + ticked people + whoever entered it, not whoever cancelled", () => {
  it("the owner cancels: the desk is added; the reason is the body", async () => {
    const p = plant();
    const o = await saveSample(p);
    platform.notifications.length = 0;
    signInAs(p.owner);
    await postCancel(jsonReq("POST", "/x", { expected: { status: "pending", version: 1 }, reason: "customer changed mind" }), ctx(o.id));
    await settle();
    expect(sent()).toEqual([
      {
        kind: "order_capture.cancelled",
        title: "O-0001 cancelled",
        body: "customer changed mind",
        link: `/o/${o.id}`,
        level: "bell",
        dedupe_key: `cancelled:${o.id}`,
        exclude_user_id: p.owner.userId,
        also_user_ids: [p.desk.userId],
      },
    ]);
  });

  it("cancelledNotification never carries the customer's phone", () => {
    const p = plant();
    const n = cancelledNotification(p.owner, { order_id: "o", ref: "O-0007", customer: "Sri ram hotel", place: "bijepur", entered_by: p.desk.userId, event_id: "e", text: "wrong product" });
    expect(JSON.stringify(n)).not.toMatch(/\d{10}/);
  });
});

describe("no notification for a change or an undo (not in the plan's table)", () => {
  it("changing an order and undoing Delivered send nothing", async () => {
    const p = plant();
    const o = await saveSample(p);
    platform.notifications.length = 0;
    await changeOrder(p.desk, o.id, ChangeInput.parse({ expected: { status: "pending", version: 1 }, lines: [{ sku_id: b500.id, quantity: 2, rate: "90" }] }));
    signInAs(p.owner);
    await postDeliver(jsonReq("POST", "/x", { expected: { status: "pending", version: 2 } }), ctx(o.id));
    await settle();
    platform.notifications.length = 0;
    await undoDelivered(p.owner, o.id, ReasonInput.parse({ expected: { status: "delivered", version: 2 }, reason: "marked by mistake" }));
    await settle();
    expect(sent()).toEqual([]);
  });
});

describe("outbox", () => {
  it("platform down (503): the notification waits in the outbox, the daily job sends it later", async () => {
    const p = plant();
    platform.notifyStatus = 503;
    const o = await saveSample(p);
    const kept = await asOwner<{ dedupe: string }>("select input->>'dedupe_key' as dedupe from order_capture.notification_outbox where tenant_id = $1", [p.tenantId]);
    expect(kept.rows).toEqual([{ dedupe: `new:${o.id}` }]);
    platform.notifyStatus = 201;
    process.env.CRON_SECRET = "cron-test-secret";
    const res = await cron(new Request("http://localhost:3005/api/cron/daily", { method: "POST", headers: { "x-cron-secret": "cron-test-secret" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).outbox.sent).toBeGreaterThanOrEqual(1);
    expect(sent().map((n) => n.dedupe_key)).toContain(`new:${o.id}`);
    expect((await asOwner("select sent_at is not null as sent from order_capture.notification_outbox where tenant_id = $1", [p.tenantId])).rows).toEqual([{ sent: true }]);
  });

  it("a refusal (403, e.g. module switched off) is not kept", async () => {
    const p = plant();
    platform.notifyStatus = 403;
    await saveSample(p);
    expect((await asOwner("select count(*)::int as n from order_capture.notification_outbox where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 0 });
  });
});

describe("the daily job's secret", () => {
  const call = (secret?: string) => cron(new Request("http://localhost:3005/api/cron/daily", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} }));
  it("not configured → 503; no or wrong secret → 401; the right one → 200", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("anything")).status).toBe(503);
    process.env.CRON_SECRET = "cron-test-secret";
    expect((await call()).status).toBe(401);
    expect((await call("cron-test-secreT")).status).toBe(401);
    expect((await call("short")).status).toBe(401);
    const ok = await call("cron-test-secret");
    expect([ok.status, Object.keys(await ok.json())]).toEqual([200, ["outbox", "whatsapp_thanks"]]);
  });
});

it("saving through the module never waits for the platform: a slow / failing platform still saves the order", async () => {
  const p = plant();
  platform.notifyStatus = 500;
  signInAs(p.desk);
  const res = await postOrder(jsonReq("POST", "/api/orders", { request_key: `slow-${Date.now()}`, ...SAMPLE }), undefined as never);
  expect(res.status).toBe(201);
  await settle();
  expect((await asOwner("select count(*)::int as n from order_capture.orders where tenant_id = $1", [p.tenantId])).rows[0]).toEqual({ n: 1 });
});

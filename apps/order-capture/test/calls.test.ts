// Phone calls Phase 2 (docs/CALLS_PHASE_PLAN.md "Recording a call", "Notifications"): the order phone's key (missing /
// wrong / removed / broken setting), the plant from the key only, the ring rules (incoming, missed joins, lone missed,
// 60 s repeats, number forms), the "Not an order number" list dropping a call before anything is stored, limits, and
// the "Customer called" alert (Delivery staff only, first ring, the 10-minute rule, after Attended, text, outbox).
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";
import type { AlertContact } from "@plantops/types";
import { callNumber, hashCallKey, recordCall, type CallKey } from "@/server/calls";
import { createOrder } from "@/server/orders";
import { deliverOrder } from "@/server/handling";
import { listCustomers } from "@/server/customers";
import { listOrders } from "@/server/list";
import { callNotification } from "@/server/notify";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, ocUser, plant, refused, seedPlant } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const { POST: callRoute } = await import("@/app/api/calls/v1/route");
const { GET: healthRoute } = await import("@/app/health/route");

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.notifications.length = 0;
  platform.notifyStatus = 201;
  resetRateLimits();
});
afterEach(async () => {
  await settle();
  vi.restoreAllMocks();
  delete process.env.ORDER_CALL_KEYS;
});

const newKey = () => `occ_${randomBytes(32).toString("base64url")}`;
/** A plant with a phone key for it, and its Delivery staff (Raju), an Order desk and an owner in the contact list. */
function phonePlant(extra: CallKey[] = []) {
  const p = plant();
  const key = newKey();
  const entry: CallKey = { id: randomUUID(), tenant_id: p.tenantId, sha256: hashCallKey(key), label: "Order phone" };
  process.env.ORDER_CALL_KEYS = JSON.stringify([entry, ...extra]);
  const raju = randomUUID();
  const both = randomUUID();
  platform.contacts = [
    { user_id: p.owner.userId, display_name: "Sujata", phone: null, roles: ["tenant_admin"] },
    { user_id: p.desk.userId, display_name: "Atharv", phone: null, roles: ["order_desk"] },
    { user_id: raju, display_name: "Raju", phone: null, roles: ["delivery_staff", "plant_staff"] },
    { user_id: both, display_name: "Owner on deliveries", phone: null, roles: ["tenant_admin", "delivery_staff"] },
  ] as AlertContact[];
  return { ...p, key, entry, raju };
}

const send = (key: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  callRoute(
    new Request("http://localhost:3005/api/calls/v1", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const events = async (tenantId: string) =>
  (await asOwner<{ phone: string; event: string; ring_id: string | null; id: string }>("select id, phone, event, ring_id from order_capture.call_events where tenant_id = $1 order by created_at, id", [tenantId])).rows;

const T0 = Date.now() - 60 * 60_000; // an hour ago, so every test time is in the past
const at = (minutes: number, seconds = 0) => new Date(T0 + minutes * 60_000 + seconds * 1000);
const ring = (k: CallKey, phone: string, event: "incoming" | "missed", when: Date) => recordCall(k, { phone, event }, when);

describe("the key", () => {
  it("missing, wrong, another kind of key or a removed one: 401 unauthorized, nothing stored", async () => {
    const p = phonePlant();
    for (const key of [undefined, newKey(), `ocb_${randomBytes(32).toString("base64url")}`, "occ_short"]) {
      const res = await send(key, { phone: "9876543210", event: "incoming" });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "Unknown or missing phone key" } });
    }
    process.env.ORDER_CALL_KEYS = "[]"; // the entry removed
    expect((await send(p.key, { phone: "9876543210", event: "incoming" })).status).toBe(401);
    expect(await events(p.tenantId)).toEqual([]);
  });

  it("more than 10 refused keys a minute from one address: 429", async () => {
    phonePlant();
    for (let i = 0; i < 10; i++) expect((await send(newKey(), {}, { "x-forwarded-for": "203.0.113.9" })).status).toBe(401);
    const res = await send(newKey(), {}, { "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });

  it("a broken ORDER_CALL_KEYS switches calls off and /health says so (still 200)", async () => {
    const p = phonePlant();
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.ORDER_CALL_KEYS = `"reminder": 1`; // a fragment, not the whole value
    expect((await send(p.key, { phone: "9876543210", event: "incoming" })).status).toBe(401);
    const health = await healthRoute();
    expect(health.status).toBe(200);
    expect((await health.json()).warnings).toContain("ORDER_CALL_KEYS is not valid, so phone calls are off");
  });

  it("the plant comes from the key: plant A's key writes A's rows only, plant B sees none", async () => {
    const a = phonePlant();
    const b = plant();
    expect((await send(a.key, { phone: "9876543210", event: "incoming" })).status).toBe(201);
    expect(await events(a.tenantId)).toHaveLength(1);
    expect((await asApp(b.tenantId, `select * from order_capture.call_events where tenant_id = '${a.tenantId}'`)).rows).toEqual([]);
    expect(await dbError(asApp(b.tenantId, `insert into order_capture.call_events (tenant_id, key_id, phone, event) values ('${a.tenantId}', gen_random_uuid(), '9876543210', 'incoming')`))).toMatch(/row-level security/);
  });

  it("plant without Order Capture: 403 module_off", async () => {
    const p = phonePlant();
    platform.enabled.set(p.tenantId, ["floor_stock"]);
    const res = await send(p.key, { phone: "9876543210", event: "incoming" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("module_off");
    expect(await events(p.tenantId)).toEqual([]);
  });
});

describe("the request", () => {
  it("not JSON, too big, unknown field, wrong event: 400", async () => {
    const p = phonePlant();
    expect((await send(p.key, "phone=9876543210")).status).toBe(400);
    expect((await send(p.key, { phone: "9876543210", event: "incoming", pad: "x".repeat(1100) })).status).toBe(400);
    expect((await send(p.key, { phone: "9876543210", event: "incoming", contact: "Ramesh" })).status).toBe(400);
    expect((await send(p.key, { phone: "9876543210", event: "answered" })).status).toBe(400);
    expect((await send(p.key, { phone: "1".repeat(16), event: "incoming" })).status).toBe(400);
    expect(await events(p.tenantId)).toEqual([]);
  });

  it("30 events a minute per key, then 429", async () => {
    const p = phonePlant();
    for (let i = 0; i < 30; i++) expect((await send(p.key, { phone: `98765${String(i).padStart(5, "0")}`, event: "incoming" })).status).toBe(201);
    expect((await send(p.key, { phone: "9000000001", event: "incoming" })).status).toBe(429);
  });

  it("numbers: a mobile in any spelling, a landline's digits, an empty number is hidden", () => {
    for (const typed of ["+91 98765 43210", "09876543210", "919876543210", "98765-43210"]) expect(callNumber(typed)).toBe("9876543210");
    expect(callNumber("011 2345 6789")).toBe("01123456789");
    // an Odisha landline (area code 06xx) reads as a mobile under the shared rule; tel:+91… still dials it
    expect(callNumber("0674 2345678")).toBe("6742345678");
    expect(callNumber("")).toBe("hidden");
    expect(callNumber("Private number")).toBe("hidden");
  });
});

describe("ring rules", () => {
  it("incoming = a ring; missed within 3 minutes marks it (one ring, missed)", async () => {
    const p = phonePlant();
    await ring(p.entry, "+91 98765 43210", "incoming", at(0));
    await ring(p.entry, "9876543210", "missed", at(0, 40));
    const [inc, miss] = await events(p.tenantId);
    expect(inc).toMatchObject({ phone: "9876543210", event: "incoming", ring_id: null });
    expect(miss).toMatchObject({ event: "missed", ring_id: inc!.id });
  });

  it("a missed with no incoming before it (lost), or more than 3 minutes later, is its own ring", async () => {
    const p = phonePlant();
    await ring(p.entry, "9876543210", "missed", at(0));
    await ring(p.entry, "9123456780", "incoming", at(1));
    await ring(p.entry, "9123456780", "missed", at(4, 30));
    const rows = await events(p.tenantId);
    expect(rows.map((r) => r.ring_id)).toEqual([null, null, null]);
  });

  it("a second missed never marks a ring that is already missed", async () => {
    const p = phonePlant();
    await ring(p.entry, "9876543210", "incoming", at(0));
    await ring(p.entry, "9876543210", "missed", at(0, 30));
    await ring(p.entry, "9876543210", "missed", at(2)); // > 60 s later, so not a repeat
    const rows = await events(p.tenantId);
    expect(rows[1]!.ring_id).toBe(rows[0]!.id);
    expect(rows[2]!.ring_id).toBeNull();
  });

  it("the same number + event within 60 s is a repeat send: ignored, 200", async () => {
    const p = phonePlant();
    expect(await ring(p.entry, "9876543210", "incoming", at(0))).toMatchObject({ status: 201 });
    expect(await ring(p.entry, "9876543210", "incoming", at(0, 50))).toEqual({ status: 200, body: { recorded: false, repeat: true } });
    expect(await ring(p.entry, "9876543210", "incoming", at(1, 30))).toMatchObject({ status: 201 });
    const res = await send(p.key, { phone: "9123456780", event: "incoming" });
    expect(res.status).toBe(201);
    const again = await send(p.key, { phone: "9123456780", event: "incoming" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ recorded: false, repeat: true });
    expect(await events(p.tenantId)).toHaveLength(3);
  });

  it("landline and hidden numbers are stored too", async () => {
    const p = phonePlant();
    await ring(p.entry, "011 2345 6789", "incoming", at(0));
    await ring(p.entry, "", "missed", at(1));
    expect((await events(p.tenantId)).map((r) => r.phone)).toEqual(["01123456789", "hidden"]);
  });
});

describe("Not an order number", () => {
  const list = (tenantId: string, phone: string, action: "add" | "remove") =>
    asApp(tenantId, `insert into order_capture.ignored_number_changes (tenant_id, phone, action, label, changed_by, changed_by_name) values ('${tenantId}', '${phone}', '${action}', ${action === "add" ? "'Brother'" : "null"}, gen_random_uuid(), 'Sujata')`);

  it("a listed number (any spelling) is not stored at all and alerts nobody; after Remove it is recorded again", async () => {
    const p = phonePlant();
    await list(p.tenantId, "9111111111", "add");
    const res = await send(p.key, { phone: "+91 91111 11111", event: "incoming" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(await send(p.key, { phone: "09111111111", event: "missed" }).then((r) => r.json())).toEqual({ ignored: true });
    await settle();
    expect(await events(p.tenantId)).toEqual([]);
    expect(platform.notifications).toEqual([]);
    await list(p.tenantId, "9111111111", "remove");
    expect((await send(p.key, { phone: "9111111111", event: "incoming" })).status).toBe(201);
    expect(await events(p.tenantId)).toHaveLength(1);
  });

  it("a landline can be listed (by its digits); the list needs a label and can't hold 'hidden'", async () => {
    const p = phonePlant();
    await list(p.tenantId, "01123456789", "add");
    expect(await ring(p.entry, "011-2345-6789", "incoming", at(0))).toEqual({ status: 200, body: { ignored: true } });
    expect(await dbError(list(p.tenantId, "hidden", "add"))).toMatch(/check/);
    expect(await dbError(asApp(p.tenantId, `insert into order_capture.ignored_number_changes (tenant_id, phone, action, changed_by, changed_by_name) values ('${p.tenantId}', '9222222222', 'add', gen_random_uuid(), 'x')`))).toMatch(/check/);
  });
});

describe("Customer called alert", () => {
  const attend = (tenantId: string, phone: string, upto: Date) =>
    asApp(tenantId, `insert into order_capture.call_attended (tenant_id, phone, upto, outcome, attended_by, attended_by_name) values ('${tenantId}', '${phone}', '${upto.toISOString()}', 'known', gen_random_uuid(), 'Raju')`);

  it("goes to Delivery staff only (not owners, not Order desk), after the answer, with no amounts", async () => {
    const p = phonePlant();
    expect((await send(p.key, { phone: "70081 44562", event: "incoming" })).status).toBe(201);
    await settle();
    expect(platform.notifications).toHaveLength(1);
    const n = platform.notifications[0]!;
    expect(n.tenantId).toBe(p.tenantId);
    expect(n.body).toMatchObject({
      kind: "order_capture.call",
      title: "Call: New number 70081 44562",
      body: "Open Calls to call back.",
      link: "/calls",
      level: "push",
      also_user_ids: [p.raju],
      only_listed: true,
    });
    expect(JSON.stringify(n.body)).not.toMatch(/₹/);
  });

  it("a known customer by name and place; a lone missed says Missed call; hidden and landline numbers", async () => {
    const p = phonePlant();
    await seedPlant(p.tenantId, 1, "9876543210"); // customer Sri ram hotel, bijepur
    const known = await ring(p.entry, "9876543210", "missed", at(0));
    expect(known.status === 201 && callNotification(known.alert!, ["u"])?.title).toBe("Missed call: Sri ram hotel (bijepur)");
    const hidden = await ring(p.entry, "", "incoming", at(0));
    expect(hidden.status === 201 && callNotification(hidden.alert!, ["u"])?.title).toBe("Call: Hidden number");
    const landline = await ring(p.entry, "011 2345 6789", "incoming", at(0));
    expect(landline.status === 201 && callNotification(landline.alert!, ["u"])?.title).toBe("Call: New number 01123456789");
  });

  it("first ring alerts; more rings within 10 minutes don't; one after 10 minutes does, 'rang N times'; a missed that marks its ring sends nothing", async () => {
    const p = phonePlant();
    const r1 = await ring(p.entry, "9876543210", "incoming", at(0));
    const m1 = await ring(p.entry, "9876543210", "missed", at(0, 30));
    const r2 = await ring(p.entry, "9876543210", "incoming", at(3));
    const r3 = await ring(p.entry, "9876543210", "incoming", at(11));
    expect(r1.status === 201 && r1.alert).toMatchObject({ n: 1, rings: 1 });
    expect(m1.status === 201 && m1.alert).toBeNull();
    expect(r2.status === 201 && r2.alert).toBeNull();
    const a3 = r3.status === 201 ? r3.alert! : null;
    expect(a3).toMatchObject({ n: 2, rings: 3 });
    const first = r1.status === 201 ? r1.alert!.firstRingId : "";
    expect(a3!.firstRingId).toBe(first);
    const note = callNotification(a3!, ["u"])!;
    expect(note.title).toBe("Call: New number 98765 43210 · rang 3 times");
    expect(note.dedupe_key).toBe(`call:9876543210:${first}:2`);
    expect(callNotification(r1.status === 201 ? r1.alert! : a3!, ["u"])!.dedupe_key).toBe(`call:9876543210:${first}`);
  });

  it("a ring after Attended alerts again (a new waiting run)", async () => {
    const p = phonePlant();
    await ring(p.entry, "9876543210", "incoming", at(0));
    await attend(p.tenantId, "9876543210", at(2));
    const again = await ring(p.entry, "9876543210", "incoming", at(4));
    expect(again.status === 201 && again.alert).toMatchObject({ n: 1, rings: 1 });
  });

  it("no Delivery staff in the plant: nothing is sent", async () => {
    const p = phonePlant();
    platform.contacts = [{ user_id: p.owner.userId, display_name: "Sujata", phone: null, roles: ["tenant_admin"] }] as AlertContact[];
    await send(p.key, { phone: "9876543210", event: "incoming" });
    await settle();
    expect(platform.notifications).toEqual([]);
  });

  it("platform down: the alert waits in the outbox", async () => {
    const p = phonePlant();
    platform.notifyStatus = 503;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await send(p.key, { phone: "9123456780", event: "incoming" });
    await settle();
    const kept = await asOwner<{ kind: string }>("select input->>'kind' as kind from order_capture.notification_outbox where tenant_id = $1", [p.tenantId]);
    expect(kept.rows).toEqual([{ kind: "order_capture.call" }]);
  });
});

describe("Delivery staff and the order screens", () => {
  it("every order and customer action refuses them on the server (403)", async () => {
    const p = plant();
    const ids = await seedPlant(p.tenantId);
    const raju = ocUser(p.tenantId, ["delivery_staff", "plant_staff"], "Raju");
    const no = { status: 403, message: "Delivery staff work in Calls only." };
    expect(await refused(() => listOrders(raju))).toEqual(no);
    expect(await refused(() => listCustomers(raju))).toEqual(no);
    expect(await refused(() => createOrder(raju, { request_key: randomUUID(), phone: "9876543210", lines: [{ sku_id: ids.sku500, quantity: 1, rate: "90" }] } as never))).toEqual(no);
    expect(await refused(() => deliverOrder(raju, ids.order, { send_thanks: false } as never))).toEqual(no);
  });
});

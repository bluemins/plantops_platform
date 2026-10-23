// WhatsApp bot API, Step 2 (docs/WHATSAPP_CONTRACT.md 3.2, 3.6, 3.7, 3.11): the bot key (missing / wrong / rotated /
// removed), the plant from the key only (plant B's customer never visible), unknown / switched-off phones, products
// limited to the key's codes and active ones, only the agreed fields (no rates or amounts), errors, limits, audit rows
// kept out of Recent changes, the two alerts and their recipients, and nothing written to orders.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";
import type { TenantSku } from "@plantops/types";
import { recentChanges } from "@/server/audit";
import { hashBotKey } from "@/server/bot";
import { saveRates } from "@/server/rates";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, plant } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const { POST: contextRoute } = await import("@/app/api/bot/v1/context/route");
const { POST: alertsRoute } = await import("@/app/api/bot/v1/alerts/route");

// the bot's own products (codes as in plant 001) + one switched off + one without a code
const PV1 = { id: randomUUID(), name: "Bluemins 1L", sku_code: "PV_BM_1", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" };
const PV500 = { id: randomUUID(), name: "Bluemins 500ml", sku_code: "PV_BM_500", volume_ml: 500, units_per_pack: 24, pack_type: "case", status: "active" };
const PV250 = { id: randomUUID(), name: "Bluemins 250ml", sku_code: "PV_BM_250", volume_ml: 250, units_per_pack: 35, pack_type: "case", status: "inactive" };
const DM1 = { id: randomUUID(), name: "Drinkmate 1L", sku_code: "PV_DM_1", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" };
const BOT_SKUS = [...SKUS, PV1, PV500, PV250, DM1] as TenantSku[];

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());
beforeEach(() => {
  platform.skus = BOT_SKUS;
  platform.notifications.length = 0;
  resetRateLimits();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ORDER_BOT_KEYS;
});

const newKey = () => `ocb_${randomBytes(32).toString("base64url")}`;
interface Entry {
  id: string;
  tenant_id: string;
  sha256: string;
  label: string;
  products: string[];
}
/** A plant with a bot key for it (ORDER_BOT_KEYS holds only the hash). */
function botPlant(extra: Entry[] = []) {
  const p = plant();
  const key = newKey();
  const entry: Entry = { id: randomUUID(), tenant_id: p.tenantId, sha256: hashBotKey(key), label: "Test bot", products: ["PV_BM_1", "PV_BM_500", "PV_BM_250"] };
  process.env.ORDER_BOT_KEYS = JSON.stringify([entry, ...extra]);
  return { ...p, key, entry };
}

const call = (route: (req: Request) => Promise<Response>, path: string, body: unknown, key?: string, headers: Record<string, string> = {}) =>
  route(
    new Request(`http://localhost:3005${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const context = (key: string | undefined, body: unknown, headers?: Record<string, string>) => call(contextRoute, "/api/bot/v1/context", body, key, headers);
const alert = (key: string | undefined, body: unknown) => call(alertsRoute, "/api/bot/v1/alerts", body, key);

const STAFF = randomUUID();
async function customer(tenantId: string, phone = "9876543210", name = "Sri Ram Hotel", active = true) {
  const r = await asApp(
    tenantId,
    `insert into order_capture.customers (tenant_id, name, phone_typed, phone, place, active, created_by, created_by_name)
     values ('${tenantId}', '${name}', '${phone}', '${phone}', 'Bijepur', ${active}, '${STAFF}', 'Atharv') returning id`,
  );
  return (r.rows[0] as { id: string }).id;
}
let ref = 0;
/** An order with its lines (version 1, or the given current version with older lines too). */
async function order(
  tenantId: string,
  customerId: string,
  o: { status?: "pending" | "delivered" | "cancelled"; lines: [string, number][]; deliveredAt?: string; enteredBy?: string; version?: number; oldLines?: [string, number][]; createdAt?: string },
) {
  const status = o.status ?? "pending";
  const delivered = status === "delivered";
  const version = o.version ?? 1;
  const r = await asApp(
    tenantId,
    `insert into order_capture.orders (tenant_id, ref_no, request_key, customer_id, customer_name, customer_phone, customer_place, status, version, total,
       entered_by, entered_by_name, created_at, delivered_at, delivered_by, delivered_by_name)
     values ('${tenantId}', ${++ref}, 'key-${randomUUID()}', '${customerId}', 'Sri Ram Hotel', '9876543210', 'Bijepur', '${status}', ${version}, 0,
       '${o.enteredBy ?? STAFF}', 'Atharv', ${o.createdAt ? `'${o.createdAt}'` : "now()"},
       ${delivered ? `'${o.deliveredAt ?? new Date().toISOString()}'` : "null"}, ${delivered ? `'${STAFF}'` : "null"}, ${delivered ? "'Atharv'" : "null"}) returning id, ref_no`,
  );
  const { id, ref_no } = r.rows[0] as { id: string; ref_no: number };
  const add = async (v: number, lines: [string, number][]) => {
    for (const [i, [sku, q]] of lines.entries())
      await asApp(tenantId, `insert into order_capture.order_lines (tenant_id, order_id, version, line_no, sku_id, product_name, unit, quantity, rate, line_total)
        values ('${tenantId}', '${id}', ${v}, ${i + 1}, '${sku}', 'x', 'box', ${q}, 0, 0)`);
  };
  if (o.oldLines) await add(1, o.oldLines);
  await add(version, o.lines);
  return { id, ref: `O-${String(ref_no).padStart(4, "0")}` };
}
const countOrders = async (tenantId: string) => Number((await asOwner("select count(*)::int as n from order_capture.orders where tenant_id = $1", [tenantId])).rows[0]!.n);
const botAudit = async (tenantId: string) =>
  (await asOwner<{ actor: string; action: string; target: string | null; details: Record<string, unknown> }>("select actor, action, target, details from order_capture.audit_log where tenant_id = $1 and action like 'bot.%' order by id", [tenantId])).rows;

describe("the bot key (contract 3.6)", () => {
  it("no key, a wrong key, a malformed header: 401 unauthorized in the agreed error shape", async () => {
    const b = botPlant();
    await customer(b.tenantId);
    for (const res of [await context(undefined, { phone: "9876543210" }), await context(newKey(), { phone: "9876543210" }), await context(`${b.key}x`, { phone: "9876543210" })]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized", message: "Unknown or missing bot key" } });
    }
    expect(await botAudit(b.tenantId)).toEqual([]);
  });

  it("rotation: old and new key both work while both entries exist; removing the old entry refuses it at once", async () => {
    const b = botPlant();
    const next = newKey();
    const second = { ...b.entry, id: randomUUID(), sha256: hashBotKey(next) };
    process.env.ORDER_BOT_KEYS = JSON.stringify([b.entry, second]);
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(200);
    expect((await context(next, { phone: "9876543210" })).status).toBe(200);
    process.env.ORDER_BOT_KEYS = JSON.stringify([second]);
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(401);
    expect((await context(next, { phone: "9876543210" })).status).toBe(200);
  });

  it("a broken ORDER_BOT_KEYS switches the API off (401), never half on", async () => {
    const b = botPlant();
    process.env.ORDER_BOT_KEYS = JSON.stringify([{ ...b.entry, products: [] }]);
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(401);
    process.env.ORDER_BOT_KEYS = "not json";
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(401);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("more than 10 failures a minute from one address: 429 with Retry-After", async () => {
    botPlant();
    const from = { "x-real-ip": "203.0.113.9" };
    for (let i = 0; i < 10; i++) expect((await context(newKey(), { phone: "9876543210" }, from)).status).toBe(401);
    const res = await context(newKey(), { phone: "9876543210" }, from);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });
});

describe("customer context (contract 3.2)", () => {
  it("a known customer: exactly the agreed fields, the key's active products with their Rates unit, support, last delivered basket", async () => {
    const b = botPlant();
    platform.branding.set(b.tenantId, { support_phone: "7090443303", support_hours: "10 am to 6 pm (Mon-Sat)" });
    await saveRates(b.owner, { rates: [{ sku_id: PV500.id, unit: "crate", default_rate: "90" }] });
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { status: "delivered", lines: [[PV1.id, 3]], deliveredAt: "2026-10-01T06:00:00Z" });
    // newest delivered: version 2 is current (version 1 had 9 box); the 250 ml (switched off) and a jar are dropped
    const last = await order(b.tenantId, c, {
      status: "delivered",
      version: 2,
      oldLines: [[PV1.id, 9]],
      lines: [[PV1.id, 5], [PV500.id, 2], [PV250.id, 4], [SKUS[2]!.id, 1]],
      deliveredAt: "2026-10-12T20:00:00Z",
    });
    await order(b.tenantId, c, { status: "cancelled", lines: [[PV1.id, 50]] });

    const res = await context(b.key, { phone: "+91 98765 43210" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      customer: { id: c, name: "Sri Ram Hotel", place: "Bijepur" },
      products: [
        { sku_id: PV1.id, code: "PV_BM_1", label: "Bluemins 1L (1 L × 12)", unit: "box" },
        { sku_id: PV500.id, code: "PV_BM_500", label: "Bluemins 500ml (500 ml × 24)", unit: "crate" },
      ],
      support: { phone: "7090443303", hours: "10 am to 6 pm (Mon-Sat)" },
      // 20:00 UTC on 12 Oct is 13 Oct in India
      last_delivered: { ref: last.ref, delivered_on: "2026-10-13", lines: [{ sku_id: PV1.id, quantity: 5 }, { sku_id: PV500.id, quantity: 2 }] },
      has_pending_order: false,
      areas: null,
    });
  });

  it("no rates or amounts anywhere, even with a default rate set and priced orders", async () => {
    const b = botPlant();
    await saveRates(b.owner, { rates: [{ sku_id: PV1.id, unit: "box", default_rate: "137.50" }] });
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { status: "delivered", lines: [[PV1.id, 5]] });
    const text = await (await context(b.key, { phone: "9876543210" })).text();
    expect(text).not.toMatch(/rate|total|amount|137|note|Atharv|entered/i);
  });

  it("a pending order sets has_pending_order; no delivered order = last_delivered null; no support filled = null", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { lines: [[PV1.id, 2]] });
    const body = (await (await context(b.key, { phone: "9876543210" })).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ has_pending_order: true, last_delivered: null, support: null });
  });

  it("a last delivered order with only products the bot can't offer: last_delivered null", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { status: "delivered", lines: [[PV250.id, 3], [DM1.id, 1]] });
    expect(((await (await context(b.key, { phone: "9876543210" })).json()) as Record<string, unknown>).last_delivered).toBeNull();
  });

  it("an unknown phone and a switched-off customer: customer null and the reason, nothing else", async () => {
    const b = botPlant();
    await customer(b.tenantId, "9000000001", "Old Shop", false);
    expect(await (await context(b.key, { phone: "9123456789" })).json()).toEqual({ customer: null, reason: "not_found" });
    expect(await (await context(b.key, { phone: "9000000001" })).json()).toEqual({ customer: null, reason: "switched_off" });
  });

  it("tenant isolation: plant B's customer is never visible with plant A's key", async () => {
    const b = botPlant();
    const other = plant();
    await customer(other.tenantId, "9876543210", "Plant B Customer");
    expect(await (await context(b.key, { phone: "9876543210" })).json()).toEqual({ customer: null, reason: "not_found" });
    expect(await botAudit(other.tenantId)).toEqual([]);
  });

  it("the plant comes from the key: a tenant_id in the body is refused (strict), never used", async () => {
    const b = botPlant();
    const res = await context(b.key, { phone: "9876543210", tenant_id: randomUUID() });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("bad input: a short number is bad_phone; not JSON, too big or wrong type is bad_request", async () => {
    const b = botPlant();
    const code = async (res: Response) => [res.status, ((await res.json()) as { error: { code: string } }).error.code];
    expect(await code(await context(b.key, { phone: "12345" }))).toEqual([400, "bad_phone"]);
    expect(await code(await context(b.key, "{not json"))).toEqual([400, "bad_request"]);
    expect(await code(await context(b.key, JSON.stringify({ phone: "9876543210", pad: "x".repeat(9000) })))).toEqual([400, "bad_request"]);
    expect(await code(await context(b.key, { phone: 9876543210 }))).toEqual([400, "bad_request"]);
    expect(await code(await context(b.key, { phone: "9876543210" }, { "content-type": "text/plain" }))).toEqual([400, "bad_request"]);
  });

  it("Order Capture switched off for the plant: 403 module_off; platform down: 503 unavailable", async () => {
    const b = botPlant();
    platform.enabled.set(b.tenantId, ["floor_stock"]);
    const off = await context(b.key, { phone: "9876543210" });
    expect([off.status, ((await off.json()) as { error: { code: string } }).error.code]).toEqual([403, "module_off"]);

    const d = botPlant();
    platform.planDown.add(d.tenantId);
    const down = await context(d.key, { phone: "9876543210" });
    expect([down.status, ((await down.json()) as { error: { code: string } }).error.code]).toEqual([503, "unavailable"]);
  });

  it("products can't be loaded (or none of the key's codes is active): 503 unavailable, so the bot falls back", async () => {
    const b = botPlant();
    platform.skus = null;
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(503);
    const n = botPlant();
    platform.skus = SKUS;
    expect((await context(n.key, { phone: "9876543210" })).status).toBe(503);
  });

  it("limits: 10 a minute per phone, then 429; another phone still answers", async () => {
    const b = botPlant();
    for (let i = 0; i < 10; i++) expect((await context(b.key, { phone: "9876543210" })).status).toBe(200);
    expect((await context(b.key, { phone: "9876543210" })).status).toBe(429);
    expect((await context(b.key, { phone: "9123456789" })).status).toBe(200);
  });

  it("each call is one audit row without the phone number; none of them shows in Recent changes; nothing is written to orders", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { status: "delivered", lines: [[PV1.id, 5]] });
    const before = await countOrders(b.tenantId);
    await context(b.key, { phone: "9876543210" });
    await context(b.key, { phone: "9123456789" });
    const rows = await botAudit(b.tenantId);
    expect(rows.map((r) => [r.actor, r.action, r.target, r.details.result])).toEqual([
      [`whatsapp-bot:${b.entry.id}`, "bot.context", c, "ok"],
      [`whatsapp-bot:${b.entry.id}`, "bot.context", null, "not_found"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/98765|91234|ocb_/);
    expect((await recentChanges(b.owner)).some((ch) => ch.by === "WhatsApp")).toBe(false);
    expect(await countOrders(b.tenantId)).toBe(before);
  });
});

describe("alerts (contract 3.11)", () => {
  it("'Not great' from a customer: owners + whoever entered their last order, named, linked to that order; 202", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    const last = await order(b.tenantId, c, { status: "delivered", lines: [[PV1.id, 5]] });
    const res = await alert(b.key, { kind: "feedback_not_great", phone: "9876543210", feedback_id: "FB-20261020-0007", comment: "Water  tasted\nodd" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ sent: true });
    await settle();
    expect(platform.notifications).toEqual([
      {
        tenantId: b.tenantId,
        body: {
          kind: "order_capture.feedback_low",
          title: "Unhappy customer: Sri Ram Hotel, Bijepur",
          body: `Rated 'Not great' on WhatsApp. Last order ${last.ref}. Comment: Water tasted odd`,
          link: `/o/${last.id}`,
          level: "push",
          dedupe_key: "feedback:FB-20261020-0007",
          also_user_ids: [STAFF],
        },
      },
    ]);
  });

  it("an unknown number: owners only, last 4 digits, never the full number", async () => {
    const b = botPlant();
    await alert(b.key, { kind: "feedback_not_great", phone: "9123456789", feedback_id: "FB-1" });
    await settle();
    const n = platform.notifications[0]!.body;
    expect(n).toMatchObject({ title: "Unhappy customer on WhatsApp", body: "Rated 'Not great' on WhatsApp (number ending 6789).", link: "/" });
    expect(n.also_user_ids).toBeUndefined();
    expect(JSON.stringify(n)).not.toContain("9123456789");
  });

  it("the last order came from the bot (entered_by = a key id): owners only", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    await order(b.tenantId, c, { lines: [[PV1.id, 1]], enteredBy: b.entry.id });
    await alert(b.key, { kind: "handoff", phone: "9876543210" });
    await settle();
    expect(platform.notifications[0]!.body.also_user_ids).toBeUndefined();
  });

  it("handoff: named, 'please call', one per customer per hour (dedupe key without the number)", async () => {
    const b = botPlant();
    const c = await customer(b.tenantId);
    await alert(b.key, { kind: "handoff", phone: "9876543210" });
    await alert(b.key, { kind: "handoff", phone: "9123456789" });
    await settle();
    const [known, unknown] = platform.notifications.map((n) => n.body);
    expect(known).toMatchObject({
      kind: "order_capture.handoff",
      title: "Wants to talk: Sri Ram Hotel, Bijepur",
      body: "Asked for a person on WhatsApp. Please call them.",
      link: "/customers?q=Sri%20Ram%20Hotel",
      level: "push",
    });
    expect(known!.dedupe_key).toMatch(new RegExp(`^handoff:${c}:\\d{4}-\\d{2}-\\d{2}T\\d{2}$`));
    expect(unknown).toMatchObject({ title: "WhatsApp customer asks for a person" });
    expect(String(unknown!.body)).toContain("number ending 6789");
    expect(JSON.stringify(unknown)).not.toContain("9123456789");
    expect((await botAudit(b.tenantId)).map((r) => r.details.kind)).toEqual(["handoff", "handoff"]);
  });

  it("'Not great' without feedback_id, or an unknown kind: 400; more than 10 a minute: 429", async () => {
    const b = botPlant();
    expect((await alert(b.key, { kind: "feedback_not_great", phone: "9876543210" })).status).toBe(400);
    expect((await alert(b.key, { kind: "complaint", phone: "9876543210" })).status).toBe(400);
    resetRateLimits();
    for (let i = 0; i < 10; i++) expect((await alert(b.key, { kind: "handoff", phone: "9876543210" })).status).toBe(202);
    expect((await alert(b.key, { kind: "handoff", phone: "9876543210" })).status).toBe(429);
    await settle();
  });

  it("the plant of the key only: plant B's customer with the same phone is 'unknown' to plant A's bot", async () => {
    const b = botPlant();
    const other = plant();
    await customer(other.tenantId, "9876543210", "Plant B Customer");
    await alert(b.key, { kind: "handoff", phone: "9876543210" });
    await settle();
    expect(platform.notifications.map((n) => [n.tenantId, n.body.title])).toEqual([[b.tenantId, "WhatsApp customer asks for a person"]]);
  });
});

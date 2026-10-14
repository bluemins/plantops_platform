// WhatsApp thank-you on "Delivered" through Twilio (src/server/thanks.ts), against a fake Twilio: sent when ticked,
// never when unticked or for a plant without a sender, once per order ever, Twilio refusals vs outages, the daily
// retry and giving up, the delivery never failing because of WhatsApp, the order page's view.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as deliverRoute } from "@/app/api/orders/[id]/deliver/route";
import { DeliverInput, deliverOrder, getOrder, ReasonInput, undoDelivered } from "@/server/handling";
import { createOrder, OrderInput } from "@/server/orders";
import { MAX_AGE_MS, retryThanks, sendPending, senderFor } from "@/server/thanks";
import { thanksText } from "@/lib/history";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asApp, asOwner, dbError, jsonReq, plant, refused, signInAs } from "./helpers";

// next/server's after() runs once the answer is sent; here it runs at once and can be awaited
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

// ---------- a fake Twilio ----------
type Call = { path: string; auth: string; form: Record<string, string> };
const calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 201, body: { sid: "SM00000000000000000000000000000001", status: "queued" } };
let twilio: Server;
let platform: FakePlatform;

const SID = "AC" + "1".repeat(32);
const TOKEN = "test-auth-token";
const FROM = "whatsapp:+919000000001";
const CONTENT = "HX" + "a".repeat(32);

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  twilio = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", form: Object.fromEntries(new URLSearchParams(raw)) });
      res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => twilio.listen(0, "127.0.0.1", r));
  const { port } = twilio.address() as { port: number };
  process.env.TWILIO_API_URL = `http://127.0.0.1:${port}`;
  process.env.TWILIO_ACCOUNT_SID = SID;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
});
afterAll(async () => {
  await platform.close();
  await new Promise((r) => twilio.close(r));
  for (const k of ["TWILIO_API_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_SENDERS"]) delete process.env[k];
});
beforeEach(() => {
  calls.length = 0;
  answer = { status: 201, body: { sid: "SM00000000000000000000000000000001", status: "queued" } };
});
afterEach(() => {
  vi.restoreAllMocks();
  platform.skus = SKUS;
});

/** Gives these plants a Twilio sender (TWILIO_WHATSAPP_SENDERS). */
function withSender(...tenantIds: string[]) {
  process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify(Object.fromEntries(tenantIds.map((t) => [t, { from: FROM, content_sid: CONTENT }])));
}

const [b1l] = SKUS as [(typeof SKUS)[0]];
let k = 0;
async function sample(p: ReturnType<typeof plant>, phone = "9876543210") {
  return createOrder(p.desk, OrderInput.parse({ request_key: `thanks-${Date.now()}-${++k}`, customer: { phone, name: "Sri ram hotel", place: "bijepur" }, lines: [{ sku_id: b1l.id, quantity: 2, rate: "140" }] }));
}
const deliverVia = async (u: ReturnType<typeof plant>["desk"], id: string, body: Record<string, unknown>, version = 1) => {
  signInAs(u);
  const res = await deliverRoute(jsonReq("POST", `/api/orders/${id}/deliver`, { expected: { status: "pending", version }, ...body }), { params: Promise.resolve({ id }) });
  await settle();
  return res;
};
const rows = async (orderId: string) =>
  (await asOwner<{ status: string; attempts: number; error: string | null; provider_sid: string | null; to_phone: string; requested_by_name: string }>(
    "select status, attempts, error, provider_sid, to_phone, requested_by_name from order_capture.customer_messages where order_id = $1",
    [orderId],
  )).rows;

describe("sending on Delivered", () => {
  it("ticked: one Twilio template message to the customer with their name; the row is 'sent' with Twilio's id", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    const res = await deliverVia(p.desk, o.id, { send_thanks: true });
    expect([res.status, await res.json()]).toEqual([200, { status: "delivered" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`);
    expect(calls[0]!.form).toEqual({ To: "whatsapp:+919876543210", From: FROM, ContentSid: CONTENT, ContentVariables: JSON.stringify({ "1": "Sri ram hotel" }) });
    expect(await rows(o.id)).toEqual([{ status: "sent", attempts: 1, error: null, provider_sid: "SM00000000000000000000000000000001", to_phone: "9876543210", requested_by_name: "Atharv" }]);
    const d = await getOrder(p.owner, o.id);
    expect(d.thanks.available).toBe(true);
    expect(d.thanks.message).toMatchObject({ status: "sent", by: "Atharv" });
    expect(thanksText(d.thanks.message!).title).toBe("WhatsApp thank-you sent");
  });

  it("a Messaging Service SID as the sender is sent as MessagingServiceSid", async () => {
    const p = plant();
    const ms = "MG" + "b".repeat(32);
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [p.tenantId]: { from: ms, content_sid: CONTENT } });
    const o = await sample(p);
    await deliverVia(p.owner, o.id, { send_thanks: true });
    expect(calls[0]!.form).toMatchObject({ MessagingServiceSid: ms, To: "whatsapp:+919876543210" });
    expect(calls[0]!.form.From).toBeUndefined();
  });

  it("unticked: no row, no message", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    expect((await deliverVia(p.desk, o.id, {})).status).toBe(200);
    expect(calls).toEqual([]);
    expect(await rows(o.id)).toEqual([]);
    expect((await getOrder(p.desk, o.id)).thanks).toEqual({ available: true, message: null });
  });

  it("a plant without a sender: no tick box, and send_thanks is refused (400) with nothing saved", async () => {
    const p = plant();
    withSender(randomUUID());
    const o = await sample(p);
    expect((await getOrder(p.desk, o.id)).thanks.available).toBe(false);
    const res = await deliverVia(p.desk, o.id, { send_thanks: true });
    expect([res.status, (await res.json()).error]).toEqual([400, "WhatsApp isn't set up for this plant. Untick the thank-you and try again."]);
    expect((await getOrder(p.desk, o.id)).status).toBe("pending");
    expect(calls).toEqual([]);
  });

  it("off without the Twilio account, and when the settings are broken or invalid", () => {
    const t = randomUUID();
    withSender(t);
    expect(senderFor(t)).toEqual({ from: FROM, contentSid: CONTENT });
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TWILIO_WHATSAPP_SENDERS = "{not json";
    expect(senderFor(t)).toBeNull();
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [t]: { from: "+919000000001", content_sid: CONTENT } });
    expect(senderFor(t)).toBeNull();
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [t]: { from: FROM, content_sid: "template-name" } });
    expect(senderFor(t)).toBeNull();
    withSender(t);
    const token = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    expect(senderFor(t)).toBeNull();
    process.env.TWILIO_AUTH_TOKEN = token;
  });

  it("once per order ever: Undo + Delivered again (ticked) sends nothing more", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    await deliverVia(p.desk, o.id, { send_thanks: true });
    await undoDelivered(p.owner, o.id, ReasonInput.parse({ expected: { status: "delivered", version: 1 }, reason: "marked by mistake" }));
    expect((await deliverVia(p.desk, o.id, { send_thanks: true })).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(await rows(o.id)).toHaveLength(1);
  });

  it("plant staff, a store keeper and support still can't deliver (403), ticked or not", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    for (const u of [p.staff, p.keeper, p.support]) {
      expect((await refused(() => deliverOrder(u, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, send_thanks: true })))).status).toBe(403);
    }
    expect(calls).toEqual([]);
  });
});

describe("when Twilio refuses or is down", () => {
  it("Twilio refuses (400): 'failed' with Twilio's reason, not retried; the order stays delivered", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    answer = { status: 400, body: { code: 63016, message: "Failed to send freeform message because you are outside the allowed window", status: 400 } };
    expect((await deliverVia(p.desk, o.id, { send_thanks: true })).status).toBe(200);
    expect((await getOrder(p.desk, o.id)).status).toBe("delivered");
    expect(await rows(o.id)).toMatchObject([{ status: "failed", attempts: 1, error: "Twilio said 400 (63016): Failed to send freeform message because you are outside the allowed window" }]);
    await sendPending(p.tenantId);
    expect(calls).toHaveLength(1);
    expect(thanksText((await getOrder(p.desk, o.id)).thanks.message!).title).toBe("WhatsApp thank-you not sent");
  });

  it("Twilio down (500): the delivery is saved, the message waits; the daily job sends it", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    answer = { status: 500, body: { message: "Internal error" } };
    expect((await deliverVia(p.desk, o.id, { send_thanks: true })).status).toBe(200);
    expect((await getOrder(p.desk, o.id)).status).toBe("delivered");
    expect(await rows(o.id)).toMatchObject([{ status: "pending", attempts: 1, error: "Twilio said 500: Internal error" }]);
    expect(thanksText((await getOrder(p.desk, o.id)).thanks.message!).title).toBe("WhatsApp thank-you waiting to send");
    answer = { status: 201, body: { sid: "SM00000000000000000000000000000002" } };
    const r = await retryThanks();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(await rows(o.id)).toMatchObject([{ status: "sent", attempts: 2, error: null, provider_sid: "SM00000000000000000000000000000002" }]);
  });

  it("Twilio unreachable: waits; given up after 3 tries", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    const down = async () => ({ ok: false as const, retry: true, error: "Twilio unreachable: connect ECONNREFUSED" });
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, send_thanks: true }));
    await sendPending(p.tenantId, down);
    await sendPending(p.tenantId, down);
    expect(await rows(o.id)).toMatchObject([{ status: "pending", attempts: 2 }]);
    await sendPending(p.tenantId, down);
    expect(await rows(o.id)).toMatchObject([{ status: "failed", attempts: 3, error: "Twilio unreachable: connect ECONNREFUSED" }]);
  });

  it("not sent within 24 hours: given up without calling Twilio", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, send_thanks: true }));
    await sendPending(p.tenantId, twilioDown, Date.now() + MAX_AGE_MS + 60_000);
    expect(calls).toEqual([]);
    expect(await rows(o.id)).toMatchObject([{ status: "failed", error: "Not sent within 24 hours" }]);
  });

  it("the plant's sender removed meanwhile: 'failed', nothing sent", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, send_thanks: true }));
    withSender(randomUUID());
    await sendPending(p.tenantId);
    expect(calls).toEqual([]);
    expect(await rows(o.id)).toMatchObject([{ status: "failed", error: "WhatsApp is no longer set up for this plant" }]);
  });

  it("two senders at once (the route and the daily job) send it only once", async () => {
    const p = plant();
    withSender(p.tenantId);
    const o = await sample(p);
    await deliverOrder(p.desk, o.id, DeliverInput.parse({ expected: { status: "pending", version: 1 }, send_thanks: true }));
    let n = 0;
    const slow = async () => {
      n++;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true as const, sid: "SM-slow" };
    };
    await Promise.all([sendPending(p.tenantId, slow), sendPending(p.tenantId, slow)]);
    expect(n).toBe(1);
    expect(await rows(o.id)).toMatchObject([{ status: "sent", provider_sid: "SM-slow" }]);
  });
});

async function twilioDown() {
  return { ok: false as const, retry: true, error: "down" };
}

describe("database checks", () => {
  it("one thank-you per order; 'sent' needs sent_at; an Indian mobile only", async () => {
    const p = plant();
    const o = await sample(p);
    const t = p.tenantId;
    const ins = (phone = "9876543210", extra = "") =>
      asApp(t, `insert into order_capture.customer_messages (tenant_id, order_id, kind, to_phone, requested_by, requested_by_name${extra ? ", status" : ""}) values ('${t}', '${o.id}', 'delivery_thanks', '${phone}', gen_random_uuid(), 'x'${extra ? `, '${extra}'` : ""})`);
    expect(await dbError(ins("12345"))).toMatch(/check constraint/);
    expect(await dbError(ins("9876543210", "sent"))).toMatch(/check constraint/);
    await ins();
    expect(await dbError(ins())).toMatch(/unique|duplicate/);
  });
});

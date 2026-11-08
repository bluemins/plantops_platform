// Drop Phase 1, the app's side (docs/CUSTOMER_APP_PHASE_PLAN.md "Login"), through the real routes against a fake
// Twilio: the same answer for every number and a code only for a switched-on shop's phone; only an HMAC stored; expiry,
// single use, 5 wrong tries; limits per phone (database) and per connection; 90-day sessions ended by logout, switching
// off, removing the phone or switching the customer off; plant isolation; settings; the thank-you untouched.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@plantops/module-kit/http";
import { POST as startRoute } from "@/app/api/app/v1/login/start/route";
import { POST as verifyRoute } from "@/app/api/app/v1/login/verify/route";
import { POST as logoutRoute } from "@/app/api/app/v1/logout/route";
import { GET as sessionRoute } from "@/app/api/app/v1/session/route";
import { recentChanges } from "@/server/audit";
import { createCustomer, updateCustomer } from "@/server/customers";
import { addPhone, dropCard, removePhone, setDrop, SetDropInput } from "@/server/drop/manage";
import { startLogin, StartInput, verifyLogin } from "@/server/drop/login";
import { dropApp } from "@/server/drop/config";
import { saveRates } from "@/server/rates";
import { senderFor, whatsappProblem } from "@/server/thanks";
import { SKUS, startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, plant } from "./helpers";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const sent: { to: string; content: string; code: string }[] = [];
let twilio: Server;
let platform: FakePlatform;
const FROM = "whatsapp:+919000000001";
const THANKS = "HX" + "a".repeat(32);
const LOGIN = "HX" + "c".repeat(32);
const plants: string[] = [];
const [, , jar] = SKUS as [(typeof SKUS)[0], (typeof SKUS)[0], (typeof SKUS)[0]];

function configure() {
  process.env.DROP_APPS = JSON.stringify(Object.fromEntries(plants.map((t, i) => [`app-${i}`, { tenant_id: t, brand: "Bluemins" }])));
  process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify(Object.fromEntries(plants.map((t) => [t, { from: FROM, content_sid: THANKS, login_content_sid: LOGIN }])));
}

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
  twilio = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      sent.push({ to: form.To!, content: form.ContentSid!, code: JSON.parse(form.ContentVariables ?? "{}")["1"] });
      res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ sid: "SM" + "0".repeat(32) }));
    });
  });
  await new Promise<void>((r) => twilio.listen(0, "127.0.0.1", r));
  process.env.TWILIO_API_URL = `http://127.0.0.1:${(twilio.address() as { port: number }).port}`;
  process.env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32);
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
  process.env.DROP_CODE_SECRET = "s".repeat(40);
});
afterAll(async () => {
  await platform.close();
  await new Promise((r) => twilio.close(r));
  for (const k of ["TWILIO_API_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_SENDERS", "DROP_APPS", "DROP_CODE_SECRET"]) delete process.env[k];
});
beforeEach(() => {
  sent.length = 0;
  resetRateLimits();
  configure();
});

async function dropPlant() {
  const p = plant();
  plants.push(p.tenantId);
  configure();
  const app = `app-${plants.length - 1}`;
  await saveRates(p.owner, { rates: [{ sku_id: jar.id, unit: "jar", default_rate: "", brand: "Mr.Charge" }] });
  const shop = (await createCustomer(p.owner, { name: "Shree Stores", phone: "9861000001", place: "Bijepur" })).customer;
  const off = (await createCustomer(p.owner, { name: "Not on Drop", phone: "9437000002", place: "Bargarh" })).customer;
  await setDrop(p.owner, shop.id, SetDropInput.parse({ enabled: true }));
  return { ...p, app, shop, off };
}

const req = (app: string, path: string, body?: unknown, token?: string, ip = "10.0.0.1") =>
  new Request(`http://localhost:3005${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-drop-app": app, "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function start(app: string, phone: string, ip?: string) {
  const res = await startRoute(req(app, "/api/app/v1/login/start", { phone }, undefined, ip));
  await settle();
  return { status: res.status, body: await res.json() };
}
async function verify(app: string, phone: string, code: string) {
  const res = await verifyRoute(req(app, "/api/app/v1/login/verify", { phone, code }));
  return { status: res.status, body: await res.json() };
}
async function session(app: string, token: string) {
  const res = await sessionRoute(req(app, "/api/app/v1/session", undefined, token));
  return { status: res.status, body: await res.json() };
}
async function login(app: string, phone: string) {
  await start(app, phone);
  const code = sent.at(-1)!.code;
  const v = await verify(app, phone, code);
  expect(v.status).toBe(200);
  return v.body.token as string;
}

describe("asking for a code", () => {
  it("answers the same for every number; a code goes only to a switched-on shop's phone, with the login template", async () => {
    const p = await dropPlant();
    const answers = await Promise.all(["+91 98610 00001", "9437000002", "9000000099"].map(async (ph) => (await start(p.app, ph)).body));
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ ok: true, resend_after: 60 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "whatsapp:+919861000001", content: LOGIN });
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
    const { rows } = await asOwner<{ code_hmac: string }>("select code_hmac from order_capture.app_login_codes where tenant_id = $1", [p.tenantId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.code_hmac).not.toContain(sent[0]!.code);
    // a switched-off customer gets nothing either
    await updateCustomer(p.owner, p.shop.id, { active: false });
    expect((await start(p.app, "9861000001")).body).toEqual({ ok: true, resend_after: 60 });
    expect(sent).toHaveLength(1);
  });

  it("an extra phone gets a code too; a removed one doesn't", async () => {
    const p = await dropPlant();
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    await start(p.app, "7008099001");
    expect(sent.map((s) => s.to)).toEqual(["whatsapp:+917008099001"]);
    await removePhone(p.owner, p.shop.id, { phone: "7008099001" });
    await start(p.app, "7008099001");
    expect(sent).toHaveLength(1);
  });

  it("limits: 3 codes per phone per 15 minutes and 10 a day (from the database), 20 asks per connection an hour", async () => {
    const p = await dropPlant();
    const app = dropApp(p.app)!;
    const t0 = new Date(Date.now() - 23 * 60 * 60_000);
    let made = 0;
    for (let i = 0; i < 12; i++) {
      const at = new Date(t0.getTime() + i * 16 * 60_000);
      if ((await startLogin(app, StartInput.parse({ phone: "9861000001" }), at)).send) made++;
    }
    expect(made).toBe(10); // the day's limit
    for (let i = 0; i < 4; i++) await start(p.app, "9861000001");
    expect(sent).toHaveLength(0); // still 10 in the last 24 h
    resetRateLimits();
    for (let i = 0; i < 20; i++) expect((await start(p.app, "9000000001", "10.9.9.9")).status).toBe(200);
    expect(await start(p.app, "9000000001", "10.9.9.9")).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
  });

  it("3 in 15 minutes", async () => {
    const p = await dropPlant();
    for (let i = 0; i < 4; i++) await start(p.app, "9861000001");
    expect(sent).toHaveLength(3);
  });
});

describe("checking the code", () => {
  it("the right code gives a session once; the session says who is logged in", async () => {
    const p = await dropPlant();
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true, brands: ["Mr.Charge"] }));
    await start(p.app, "9861000001");
    const code = sent[0]!.code;
    const ok = await verify(p.app, "98610 00001", code);
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^dpt_[A-Za-z0-9_-]{43}$/);
    expect(ok.body.shop).toEqual({ name: "Shree Stores" });
    expect(new Date(ok.body.expires_at).getTime() - Date.now()).toBeGreaterThan(89 * 24 * 60 * 60_000);
    expect(await session(p.app, ok.body.token)).toEqual({ status: 200, body: { shop: { name: "Shree Stores" }, phone: "9861000001", brands: ["Bluemins", "Mr.Charge"] } });
    expect((await verify(p.app, "9861000001", code)).body).toEqual({ error: { code: "wrong_code", message: "That code is wrong or has expired. Ask for a new one." } });
    const { rows } = await asOwner<{ token_sha256: string }>("select token_sha256 from order_capture.app_sessions where tenant_id = $1 and customer_id = $2", [p.tenantId, p.shop.id]);
    expect(rows[0]!.token_sha256).not.toContain(ok.body.token.slice(4, 20));
    expect((await dropCard(p.owner, p.shop.id)).main.last_login).not.toBeNull();
    expect((await recentChanges(p.owner)).some((c) => /login|code/i.test(c.text))).toBe(false);
  });

  it("5 wrong tries end the code; an expired code is refused", async () => {
    const p = await dropPlant();
    await start(p.app, "9861000001");
    const code = sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify(p.app, "9861000001", wrong)).status).toBe(401);
    expect((await verify(p.app, "9861000001", code)).status).toBe(401);
    const app = dropApp(p.app)!;
    const old = new Date(Date.now() - 11 * 60_000);
    const r = await startLogin(app, StartInput.parse({ phone: "9437000002" }), old);
    expect(r.send).toBeNull(); // not switched on
    await startLogin(app, StartInput.parse({ phone: "9861000001" }), old);
    await expect(verifyLogin(app, { phone: "9861000001", code: "123456" })).rejects.toMatchObject({ code: "wrong_code" });
  });
});

describe("sessions", () => {
  it("end on logout, switching the shop off, removing the phone or switching the customer off", async () => {
    const p = await dropPlant();
    await addPhone(p.owner, p.shop.id, { phone: "7008099001" });
    const a = await login(p.app, "9861000001");
    const b = await login(p.app, "7008099001");
    await removePhone(p.owner, p.shop.id, { phone: "7008099001" });
    expect(await session(p.app, b)).toMatchObject({ status: 401, body: { error: { code: "session_ended" } } });
    expect((await session(p.app, a)).status).toBe(200);
    await logoutRoute(req(p.app, "/api/app/v1/logout", {}, a));
    expect((await session(p.app, a)).status).toBe(401);
    const c = await login(p.app, "9861000001");
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: false }));
    expect((await session(p.app, c)).status).toBe(401);
    await setDrop(p.owner, p.shop.id, SetDropInput.parse({ enabled: true }));
    expect((await session(p.app, c)).status).toBe(401); // ended for good
    const d = await login(p.app, "9861000001");
    await updateCustomer(p.owner, p.shop.id, { active: false });
    expect((await session(p.app, d)).status).toBe(401);
    const { rows } = await asOwner<{ end_reason: string }>("select end_reason from order_capture.app_sessions where tenant_id = $1 order by created_at", [p.tenantId]);
    expect(rows.map((r) => r.end_reason)).toEqual(["logout", "phone_removed", "switched_off", "customer_off"]);
  });

  it("an expired session, a made-up token or no token is refused", async () => {
    const p = await dropPlant();
    const t = await login(p.app, "9861000001");
    await asOwner("update order_capture.app_sessions set expires_at = now() - interval '1 minute' where tenant_id = $1", [p.tenantId]);
    expect((await session(p.app, t)).status).toBe(401);
    expect((await session(p.app, `dpt_${"A".repeat(43)}`)).status).toBe(401);
    expect((await sessionRoute(req(p.app, "/api/app/v1/session"))).status).toBe(401);
  });

  it("plants are walled off: plant A's token and codes are nothing in plant B", async () => {
    const a = await dropPlant();
    const b = await dropPlant();
    const t = await login(a.app, "9861000001");
    expect((await session(b.app, t)).status).toBe(401);
    await start(a.app, "9861000001");
    expect((await verify(b.app, "9861000001", sent.at(-1)!.code)).status).toBe(401);
    expect((await session(a.app, t)).status).toBe(200);
  });
});

describe("settings and the plant", () => {
  it("unknown app, Sales switched off for the plant, bad requests", async () => {
    const p = await dropPlant();
    expect(await start("nope", "9861000001")).toMatchObject({ status: 401, body: { error: { code: "unknown_app" } } });
    expect(await start(p.app, "12345")).toMatchObject({ status: 400, body: { error: { code: "bad_phone" } } });
    expect((await startRoute(req(p.app, "/api/app/v1/login/start", { phone: "9861000001", extra: 1 }))).status).toBe(400);
    const q = await dropPlant(); // a plant whose plan isn't cached yet
    platform.enabled.set(q.tenantId, []);
    expect(await start(q.app, "9861000001")).toMatchObject({ status: 403, body: { error: { code: "module_off" } } });
  });

  it("without a login template no code is sent; a bad one is named; the thank-you keeps working", async () => {
    const p = await dropPlant();
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [p.tenantId]: { from: FROM, content_sid: THANKS } });
    expect((await start(p.app, "9861000001")).body).toEqual({ ok: true, resend_after: 60 });
    expect(sent).toHaveLength(0);
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [p.tenantId]: { from: FROM, content_sid: THANKS, login_content_sid: "nope" } });
    expect(whatsappProblem(p.tenantId)).toMatch(/login_content_sid/);
    expect(senderFor(p.tenantId)?.contentSid).toBe(THANKS);
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify({ [p.tenantId]: { from: FROM, content_sid: THANKS, login_content_sid: THANKS } });
    expect(whatsappProblem(p.tenantId)).toMatch(/its own template/);
    expect(senderFor(p.tenantId)).toMatchObject({ contentSid: THANKS, loginContentSid: null });
    configure();
    expect(whatsappProblem(p.tenantId)).toBeNull();
  });
});

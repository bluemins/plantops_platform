// Order Capture login, session and support view through the shared module kit (same rules as the other modules),
// who may open the module (owner, Order desk; plant staff view-only), the empty tile answer and the health check.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/sso/callback/route";
import { GET as supportEntry } from "@/app/sso/support/route";
import { GET as summary } from "@/app/api/plantops/summary/route";
import { GET as health } from "@/app/health/route";
import { proxy } from "@/proxy";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { startFakePlatform, TENANT, USER, type FakePlatform } from "./fake-platform";
import { asOwner } from "./helpers";

let platform: FakePlatform;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const cookieOf = (res: Response, name: string) => {
  const m = new RegExp(`${name}=([^;]*)`).exec(res.headers.get("set-cookie") ?? "");
  return m ? decodeURIComponent(m[1]!) : undefined;
};
const cb = (q: string) => callback(new NextRequest(`http://localhost:3005/sso/callback${q}`));

describe("login", () => {
  it("an Order desk user gets a session; the redirect stays on this site", async () => {
    platform.nextToken = await platform.loginToken(["order_desk"]);
    const res = await cb("?code=abc&next=%2Fnew");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/new");
    expect(await kit.openCookie(cookieOf(res, kit.SESSION_COOKIE))).toMatchObject({ tenant_id: TENANT, user_id: USER, roles: ["order_desk"] });
    platform.nextToken = await platform.loginToken(["order_desk"]);
    expect((await cb("?code=abc&next=%2F%2Fevil.example")).headers.get("location")).toBe("/");
  });

  it("the owner, plant staff (view-only) and plant staff who were also given Order desk get a session", async () => {
    for (const roles of [["tenant_admin"], ["plant_staff"], ["plant_staff", "order_desk"]] as const) {
      platform.nextToken = await platform.loginToken([...roles]);
      expect((await cb("?code=abc")).status, roles.join("+")).toBe(307);
    }
  });

  it("a store keeper or a complaint desk (no Order Capture role) are refused", async () => {
    for (const role of ["store_keeper", "complaint_desk"] as const) {
      platform.nextToken = await platform.loginToken([role]);
      expect((await cb("?code=abc")).status, role).toBe(403);
    }
  });

  it("a token for another module is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["order_capture", "floor_stock"] }, "floor_stock");
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("a plant without Order Capture in its plan is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["floor_stock"] });
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("no session: pages go to the platform login, APIs get 401", async () => {
    const page = await proxy(new NextRequest("http://localhost:3005/o/123"));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${platform.url}/sso/start`);
    expect(to.searchParams.get("module")).toBe("order_capture");
    expect(to.searchParams.get("next")).toBe("/o/123");
    expect((await proxy(new NextRequest("http://localhost:3005/api/orders", { method: "POST" }))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost:3005/api/orders"))).status).toBe(401);
  });
});

describe("support view", () => {
  it("enters read-only; the proxy refuses any change", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3005/sso/support?code=abc"));
    expect(res.status).toBe(307);
    const value = cookieOf(res, kit.SUPPORT_COOKIE)!;
    expect(await kit.openSupportCookie(value)).toMatchObject({ tenant_id: TENANT, read_only: true });
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3005${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    expect((await proxy(req("GET", "/"))).status).toBe(200);
    for (const [m, path] of [["POST", "/api/orders"], ["PATCH", "/api/customers/x"], ["PUT", "/api/rates/x"], ["DELETE", "/api/orders/x"]]) {
      expect((await proxy(req(m!, path!))).status, `${m} ${path}`).toBe(403);
    }
  });

  it("every page support opens is logged for the owner; a plant user's pages are not", async () => {
    const tenantId = crypto.randomUUID();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: tenantId, super_admin_id: crypto.randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      expect(await requirePageUser("/")).toMatchObject({ isSupport: true, who: "support", isOwner: false });
      await requirePageUser("/o/abc");
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: tenantId, user_id: USER, display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["order_capture"], login_at: Date.now(), checked_at: Date.now() } } as never);
      expect(await requirePageUser("/rates")).toMatchObject({ who: "owner", isOwner: true });
      const { rows } = await asOwner<{ path: string }>("select path from order_capture.support_views where tenant_id = $1 order by path", [tenantId]);
      expect(rows.map((r) => r.path)).toEqual(["/", "/o/abc"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tile numbers and health", () => {
  const ask = (token: string | null) => summary(new Request("http://localhost:3005/api/plantops/summary", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("the platform's ticket gets the tile numbers (a plant without orders: no pending orders)", async () => {
    const res = await ask(await platform.summaryToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ badges: [{ text: "No pending orders", tone: "ok" }] });
  });

  it("no ticket, another module's ticket or a login token: 401", async () => {
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await platform.summaryToken("floor_stock"))).status).toBe(401);
    expect((await ask(await platform.loginToken(["tenant_admin"]))).status).toBe(401);
  });

  it("health: up, with the database reachable", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, module: "order_capture", database: "ok", warnings: [] });
  });

  it("health: broken WhatsApp or bot settings are listed as warnings, still 200", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TWILIO_WHATSAPP_SENDERS = `"reminder_content_sid": "HX${"b".repeat(32)}"`;
    process.env.ORDER_BOT_KEYS = "[{";
    try {
      const res = await health();
      expect(res.status).toBe(200);
      const { warnings } = (await res.json()) as { warnings: string[] };
      expect(warnings).toEqual([expect.stringMatching(/TWILIO_WHATSAPP_SENDERS is not valid JSON/), "ORDER_BOT_KEYS is not valid, so the WhatsApp bot API is off"]);
    } finally {
      delete process.env.TWILIO_WHATSAPP_SENDERS;
      delete process.env.ORDER_BOT_KEYS;
      spy.mockRestore();
    }
  });
});

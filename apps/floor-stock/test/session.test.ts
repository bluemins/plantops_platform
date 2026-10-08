// Floor Stock login, session and support view through the shared module kit (same rules as the other
// modules), plus who may open this module: the owner and store keepers only.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/sso/callback/route";
import { GET as supportEntry } from "@/app/sso/support/route";
import { GET as summary } from "@/app/api/plantops/summary/route";
import { GET as health } from "@/app/health/route";
import { proxy } from "@/proxy";
import { kit } from "@/server/kit";
import { requirePageUser, toStockUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { startFakePlatform, TENANT, USER, type FakePlatform } from "./fake-platform";
import { asOwner, plant, refused, stockUser } from "./helpers";

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

describe("login", () => {
  const cb = (q: string) => callback(new NextRequest(`http://localhost:3002/sso/callback${q}`));

  it("a store keeper gets a session; the redirect stays on this site", async () => {
    platform.nextToken = await platform.loginToken(["store_keeper"]);
    const res = await cb("?code=abc&next=%2Fsetup");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/setup");
    expect(await kit.openCookie(cookieOf(res, kit.SESSION_COOKIE))).toMatchObject({ tenant_id: TENANT, user_id: USER, roles: ["store_keeper"] });
    platform.nextToken = await platform.loginToken(["store_keeper"]);
    expect((await cb("?code=abc&next=%2F%2Fevil.example")).headers.get("location")).toBe("/");
  });

  it("the owner gets a session too", async () => {
    platform.nextToken = await platform.loginToken(["tenant_admin"]);
    expect((await cb("?code=abc")).status).toBe(307);
  });

  it("a lab technician or document keeper (no Floor Stock role) is refused", async () => {
    for (const role of ["lab_technician", "document_keeper"] as const) {
      platform.nextToken = await platform.loginToken([role]);
      expect((await cb("?code=abc")).status).toBe(403);
    }
  });

  it("a token for another module is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["floor_stock", "lab_records"] }, "lab_records");
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("no session: pages go to the platform login, APIs get 401", async () => {
    const page = await proxy(new NextRequest("http://localhost:3002/setup"));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.searchParams.get("module")).toBe("floor_stock");
    expect(to.searchParams.get("next")).toBe("/setup");
    expect((await proxy(new NextRequest("http://localhost:3002/api/items", { method: "POST" }))).status).toBe(401);
  });

  it("plant staff get a session", async () => {
    platform.nextToken = await platform.loginToken(["plant_staff"]);
    expect((await callback(new NextRequest("http://localhost:3002/sso/callback?code=abc"))).status).toBe(307);
  });

  it("roles: owner, store keeper and plant staff count, only the owner is owner", () => {
    const s = (roles: string[]) => ({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["floor_stock"], login_at: Date.now(), checked_at: Date.now() }) as never;
    expect(toStockUser(s(["store_keeper"]))).toMatchObject({ canCount: true, isOwner: false, isSupport: false });
    expect(toStockUser(s(["plant_staff"]))).toMatchObject({ canCount: true, isOwner: false, isSupport: false });
    expect(toStockUser(s(["tenant_admin"]))).toMatchObject({ canCount: true, isOwner: true });
  });
});

describe("support view", () => {
  it("enters read-only; the proxy refuses any change", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3002/sso/support?code=abc"));
    expect(res.status).toBe(307);
    const value = cookieOf(res, kit.SUPPORT_COOKIE)!;
    expect(await kit.openSupportCookie(value)).toMatchObject({ tenant_id: TENANT, read_only: true });
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3002${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    expect((await proxy(req("GET", "/setup"))).status).toBe(200);
    for (const [m, p] of [["POST", "/api/sections"], ["PATCH", "/api/items/x"], ["POST", "/api/setup/template"]]) {
      expect((await proxy(req(m!, p!))).status).toBe(403);
    }
  });

  it("every page support opens is logged for the owner; a plant user's pages are not", async () => {
    const tenantId = crypto.randomUUID();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: tenantId, super_admin_id: crypto.randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      expect(await requirePageUser("/day/2026-10-08")).toMatchObject({ isSupport: true, canCount: false, isOwner: false });
      await requirePageUser("/history");
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: tenantId, user_id: USER, display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["floor_stock"], login_at: Date.now(), checked_at: Date.now() } } as never);
      await requirePageUser("/setup");
      expect((await listSupportViews(stockUser(tenantId, ["tenant_admin"]))).map((v) => v.path).sort()).toEqual(["/day/2026-10-08", "/history"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("the owner (only) sees the support views", async () => {
    const tenantId = crypto.randomUUID();
    await asOwner("insert into floor_stock.support_views (tenant_id, super_admin_id, super_admin_name, path) values ($1, $2, 'PlantOps support', '/setup')", [tenantId, crypto.randomUUID()]);
    expect((await listSupportViews(stockUser(tenantId, ["tenant_admin"]))).map((v) => v.path)).toEqual(["/setup"]);
    expect((await refused(() => listSupportViews(stockUser(tenantId, ["store_keeper"])))).status).toBe(403);
  });
});

describe("tile numbers and health", () => {
  const ask = async (tenantId: string) =>
    summary(new Request("http://x/api/plantops/summary", { headers: { authorization: `Bearer ${await platform.summaryToken("floor_stock", tenantId)}` } }));

  it("answers the platform's ticket (the badges themselves: summary.test.ts)", async () => {
    const p = plant();
    expect((await (await ask(p.tenantId)).json()).badges).toEqual([{ text: "Sections not set up yet", tone: "warn" }]);
  });

  it("refuses a login token or another module's ticket", async () => {
    const bad = (token: string) => summary(new Request("http://x/api/plantops/summary", { headers: { authorization: `Bearer ${token}` } }));
    expect((await bad(await platform.loginToken())).status).toBe(401);
    expect((await bad(await platform.summaryToken("lab_records"))).status).toBe(401);
  });

  it("reaches the database with the stock_app login", async () => {
    expect(await (await health()).json()).toEqual({ ok: true, module: "floor_stock", database: "ok" });
  });
});

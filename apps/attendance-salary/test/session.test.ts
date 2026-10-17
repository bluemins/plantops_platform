// Attendance login, session and support view through the shared module kit (same rules as the other modules): who
// may open the module (owner, Plant staff, owner + Plant staff; nobody else), the empty tile answer and the health
// check.
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
const cb = (q: string) => callback(new NextRequest(`http://localhost:3006/sso/callback${q}`));

describe("login", () => {
  it("a Plant staff worker gets a session; the redirect stays on this site", async () => {
    platform.nextToken = await platform.loginToken(["plant_staff"]);
    const res = await cb("?code=abc&next=%2Fscan%3Fk%3Dxyz");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/scan?k=xyz");
    expect(await kit.openCookie(cookieOf(res, kit.SESSION_COOKIE))).toMatchObject({ tenant_id: TENANT, user_id: USER, roles: ["plant_staff"] });
    platform.nextToken = await platform.loginToken(["plant_staff"]);
    expect((await cb("?code=abc&next=%2F%2Fevil.example")).headers.get("location")).toBe("/");
  });

  it("the owner, and an owner who is also Plant staff, get a session", async () => {
    for (const roles of [["tenant_admin"], ["tenant_admin", "plant_staff"]] as const) {
      platform.nextToken = await platform.loginToken([...roles]);
      expect((await cb("?code=abc")).status, roles.join("+")).toBe(307);
    }
  });

  it("a store keeper, an Order desk or a lab technician (no Attendance role) are refused", async () => {
    for (const role of ["store_keeper", "order_desk", "lab_technician"] as const) {
      platform.nextToken = await platform.loginToken([role]);
      expect((await cb("?code=abc")).status, role).toBe(403);
    }
  });

  it("a token for another module is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["attendance_salary", "floor_stock"] }, "floor_stock");
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("a plant without Attendance in its plan is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["plant_staff"], enabled_modules: ["floor_stock"] });
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("no session: pages go to the platform login (back to the same page), APIs get 401", async () => {
    const page = await proxy(new NextRequest("http://localhost:3006/scan?k=abc"));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${platform.url}/sso/start`);
    expect(to.searchParams.get("module")).toBe("attendance_salary");
    expect(to.searchParams.get("next")).toBe("/scan?k=abc");
    expect((await proxy(new NextRequest("http://localhost:3006/api/punch", { method: "POST" }))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost:3006/api/export"))).status).toBe(401);
  });
});

describe("support view", () => {
  it("enters read-only; the proxy refuses any change", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3006/sso/support?code=abc"));
    expect(res.status).toBe(307);
    const value = cookieOf(res, kit.SUPPORT_COOKIE)!;
    expect(await kit.openSupportCookie(value)).toMatchObject({ tenant_id: TENANT, read_only: true });
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3006${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    expect((await proxy(req("GET", "/"))).status).toBe(200);
    for (const [m, path] of [["POST", "/api/punch"], ["POST", "/api/fix/add"], ["PUT", "/api/settings"], ["DELETE", "/api/x"]]) {
      expect((await proxy(req(m!, path!))).status, `${m} ${path}`).toBe(403);
    }
  });

  it("every page support opens is logged for the owner; a plant user's pages are not", async () => {
    const tenantId = crypto.randomUUID();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: tenantId, super_admin_id: crypto.randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      expect(await requirePageUser("/")).toMatchObject({ isSupport: true, who: ["support"], isOwner: false });
      await requirePageUser("/settings");
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: tenantId, user_id: USER, display_name: "Sujata", roles: ["tenant_admin"], enabled_modules: ["attendance_salary"], login_at: Date.now(), checked_at: Date.now() } } as never);
      expect(await requirePageUser("/changes")).toMatchObject({ who: ["owner"], isOwner: true });
      const { rows } = await asOwner<{ path: string }>("select path from attendance_salary.support_views where tenant_id = $1 order by path", [tenantId]);
      expect(rows.map((r) => r.path)).toEqual(["/", "/settings"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tile numbers and health", () => {
  const ask = (token: string | null) => summary(new Request("http://localhost:3006/api/plantops/summary", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("the platform's ticket gets an answer (a plant not set up yet: 'Set location & QR')", async () => {
    const res = await ask(await platform.summaryToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ badges: [{ text: "Set location & QR", tone: "warn" }] });
  });

  it("no ticket, another module's ticket or a login token: 401", async () => {
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await platform.summaryToken("floor_stock"))).status).toBe(401);
    expect((await ask(await platform.loginToken(["tenant_admin"]))).status).toBe(401);
  });

  it("health: up, with the database reachable", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, module: "attendance_salary", database: "ok" });
  });
});

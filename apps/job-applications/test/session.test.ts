// Job applications login, session and support view through the shared module kit, with the module's own home page
// (/applications: its "/" is the public job page), who may open it (owner, HR desk), which paths the proxy guards,
// the empty tile answer and the health check.
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
const cb = (q: string) => callback(new NextRequest(`http://localhost:3007/sso/callback${q}`));

describe("login", () => {
  it("lands on /applications without a next path (never the public page); a next path inside the module is kept", async () => {
    platform.nextToken = await platform.loginToken(["hr_desk"]);
    const res = await cb("?code=abc");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/applications");
    expect(await kit.openCookie(cookieOf(res, kit.SESSION_COOKIE))).toMatchObject({ tenant_id: TENANT, user_id: USER, roles: ["hr_desk"] });
    platform.nextToken = await platform.loginToken(["hr_desk"]);
    expect((await cb("?code=abc&next=%2Fapplications%2Fx")).headers.get("location")).toBe("/applications/x");
    platform.nextToken = await platform.loginToken(["hr_desk"]);
    expect((await cb("?code=abc&next=%2F%2Fevil.example")).headers.get("location")).toBe("/applications");
  });

  it("the owner gets a session too", async () => {
    platform.nextToken = await platform.loginToken(["tenant_admin"]);
    expect((await cb("?code=abc")).status).toBe(307);
  });

  it("plant staff alone, a store keeper or lab technician (no Job applications role) is refused", async () => {
    for (const role of ["plant_staff", "store_keeper", "lab_technician"] as const) {
      platform.nextToken = await platform.loginToken([role]);
      expect((await cb("?code=abc")).status, role).toBe(403);
    }
  });

  it("a token for another module, or a plant without Job applications in its plan, is refused", async () => {
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["job_applications", "floor_stock"] }, "floor_stock");
    expect((await cb("?code=abc")).status).toBe(403);
    platform.nextToken = await platform.sign({ tenant_id: TENANT, user_id: USER, roles: ["tenant_admin"], enabled_modules: ["floor_stock"] });
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("no session: protected pages go to the platform login, protected APIs get 401", async () => {
    const page = await proxy(new NextRequest("http://localhost:3007/applications"));
    expect(page.status).toBe(307);
    const to = new URL(page.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${platform.url}/sso/start`);
    expect(to.searchParams.get("module")).toBe("job_applications");
    expect(to.searchParams.get("next")).toBe("/applications");
    expect((await proxy(new NextRequest("http://localhost:3007/api/app/applications/x/status", { method: "POST" }))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost:3007/api/app/files/x"))).status).toBe(401);
  });
});

describe("support view", () => {
  it("enters read-only on /applications; the proxy refuses any change", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3007/sso/support?code=abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/applications");
    const value = cookieOf(res, kit.SUPPORT_COOKIE)!;
    expect(await kit.openSupportCookie(value)).toMatchObject({ tenant_id: TENANT, read_only: true });
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3007${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    expect((await proxy(req("GET", "/applications"))).status).toBe(200);
    for (const [m, path] of [["POST", "/api/app/applications/x/notes"], ["PATCH", "/api/app/openings/x"], ["PUT", "/api/app/page"], ["DELETE", "/api/app/applications/x"]]) {
      expect((await proxy(req(m!, path!))).status, `${m} ${path}`).toBe(403);
    }
  });

  it("every page support opens is logged for the owner; a plant user's pages are not", async () => {
    const tenantId = crypto.randomUUID();
    const spy = vi.spyOn(kit, "currentSession");
    try {
      spy.mockResolvedValue({ kind: "support", support: { tenant_id: tenantId, super_admin_id: crypto.randomUUID(), read_only: true, expires_at: Date.now() + 60_000 } } as never);
      expect(await requirePageUser("/applications")).toMatchObject({ isSupport: true, who: "support", isOwner: false });
      await requirePageUser("/openings");
      spy.mockResolvedValue({ kind: "user", session: { tenant_id: tenantId, user_id: USER, display_name: "Meera", roles: ["hr_desk"], enabled_modules: ["job_applications"], login_at: Date.now(), checked_at: Date.now() } } as never);
      expect(await requirePageUser("/applications")).toMatchObject({ who: "hr", isOwner: false });
      const { rows } = await asOwner<{ path: string }>("select path from job_applications.support_views where tenant_id = $1 order by path", [tenantId]);
      expect(rows.map((r) => r.path)).toEqual(["/applications", "/openings"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("tile numbers and health", () => {
  const ask = (token: string | null) => summary(new Request("http://localhost:3007/api/plantops/summary", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  it("the platform's ticket gets the tile numbers (an empty plant: nothing new, no openings on the public page)", async () => {
    const res = await ask(await platform.summaryToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ badges: [{ text: "No new applications", tone: "ok" }, { text: "Public page has no openings", tone: "info" }] });
  });

  it("no ticket, another module's ticket or a login token: 401", async () => {
    expect((await ask(null)).status).toBe(401);
    expect((await ask(await platform.summaryToken("floor_stock"))).status).toBe(401);
    expect((await ask(await platform.loginToken(["tenant_admin"]))).status).toBe(401);
  });

  it("health: up, with the database reachable", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, module: "job_applications", database: "ok" });
  });
});

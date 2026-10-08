// Lab Records login and session (CLAUDE.md "Every module app must"): one-time-code callback, 12 h session
// with the 5-minute platform re-check in proxy.ts, platform login for anyone without a session, the
// launcher's tile-number call, and who may do what.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleSession } from "@plantops/auth";
import { GET as callback } from "@/app/sso/callback/route";
import { GET as summary } from "@/app/api/plantops/summary/route";
import { GET as health } from "@/app/health/route";
import { proxy } from "@/proxy";
import { openCookie, readSession, sealCookie, SESSION_COOKIE } from "@/server/session-cookie";
import { toLabUser } from "@/server/session";
import { startFakePlatform, TENANT, USER, type FakePlatform } from "./fake-platform";

const MIN = 60_000;
let platform: FakePlatform;

beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const session = (over: Partial<ModuleSession> = {}): ModuleSession => ({
  tenant_id: TENANT,
  user_id: USER,
  display_name: "Atharv",
  roles: ["lab_technician"],
  enabled_modules: ["lab_records"],
  login_at: Date.now(),
  checked_at: Date.now(),
  ...over,
});

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3001${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` } : {} });

/** The session cookie value a response sets, if any. */
const setCookieValue = (res: Response) => {
  const header = res.headers.get("set-cookie") ?? "";
  const m = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(header);
  return m ? decodeURIComponent(m[1]!) : undefined;
};

describe("proxy: no session -> platform login", () => {
  it("a page sends the user to the platform, which brings them back to the same page", async () => {
    const res = await proxy(request("/batches?status=on_hold"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe(platform.url);
    expect(to.pathname).toBe("/sso/start");
    expect(to.searchParams.get("module")).toBe("lab_records");
    expect(to.searchParams.get("next")).toBe("/batches?status=on_hold");
  });

  it("an API call gets 401 instead of a redirect", async () => {
    const res = await proxy(request("/api/batches"));
    expect(res.status).toBe(401);
  });

  it("a tampered or other-secret cookie counts as no session and is cleared", async () => {
    const good = await sealCookie(session());
    const res = await proxy(request("/", good.slice(0, -3) + "abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
  });

  it("after 12 hours the shift is over", async () => {
    const old = await sealCookie(session({ login_at: Date.now() - 12 * 60 * MIN - 1000, checked_at: Date.now() }));
    expect((await proxy(request("/", old))).status).toBe(307);
  });
});

describe("proxy: 5-minute re-check with the platform", () => {
  it("a fresh session passes without asking the platform", async () => {
    const calls = platform.statusCalls;
    const res = await proxy(request("/", await sealCookie(session())));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(platform.statusCalls).toBe(calls);
  });

  it("after 5 minutes it re-checks, picks up new roles/name and renews the cookie", async () => {
    platform.status = { active: true, display_name: "Atharv S.", roles: ["lab_lead"], enabled_modules: ["lab_records"] };
    const res = await proxy(request("/", await sealCookie(session({ checked_at: Date.now() - 6 * MIN }))));
    expect(res.status).toBe(200);
    const renewed = await openCookie(setCookieValue(res));
    expect(renewed).toMatchObject({ roles: ["lab_lead"], display_name: "Atharv S." });
    expect(Date.now() - renewed!.checked_at).toBeLessThan(MIN);
  });

  it.each<[string, FakePlatform["status"]]>([
    ["user disabled", { active: false, roles: ["lab_technician"], enabled_modules: ["lab_records"] }],
    ["lab role removed", { active: true, roles: ["store_keeper"], enabled_modules: ["lab_records", "floor_stock"] }],
    ["Lab Records removed from the plan", { active: true, roles: ["lab_technician"], enabled_modules: [] }],
    ["platform refuses (module switched off)", 401],
  ])("logs out at the re-check: %s", async (_name, status) => {
    platform.status = status;
    const res = await proxy(request("/", await sealCookie(session({ checked_at: Date.now() - 6 * MIN }))));
    expect(res.status).toBe(307);
  });
});

describe("pages and APIs check the session themselves too", () => {
  it("a session the proxy never re-checked (older than the 15-minute grace) is refused", async () => {
    expect(await readSession(await sealCookie(session({ checked_at: Date.now() - 16 * MIN })))).toBeNull();
    expect(await readSession(await sealCookie(session({ checked_at: Date.now() - 4 * MIN })))).not.toBeNull();
  });
});

describe("login callback (one-time code -> session)", () => {
  const cb = (query: string) => callback(new NextRequest(`http://localhost:3001/sso/callback${query}`));

  it("swaps the code, starts a 12-hour session with the user's name, and goes to the page they wanted", async () => {
    platform.status = { active: true, display_name: "Atharv", roles: ["lab_technician"], enabled_modules: ["lab_records"] };
    platform.nextToken = await platform.loginToken();
    const res = await cb("?code=abc&next=%2Fbatches");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/batches"); // relative: never the server's own 0.0.0.0 address
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=43200/);
    expect(await openCookie(setCookieValue(res))).toMatchObject({ tenant_id: TENANT, user_id: USER, display_name: "Atharv" });
  });

  it("never redirects to another site", async () => {
    platform.nextToken = await platform.loginToken();
    for (const next of ["//evil.example", "https://evil.example", "/\\evil"]) {
      const res = await cb(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("refuses: missing code, used/expired code, a user without a lab role, a summary ticket", async () => {
    expect((await cb("")).status).toBe(400);
    platform.nextToken = "";
    expect((await cb("?code=used")).status).toBe(403);
    platform.nextToken = await platform.loginToken(["store_keeper"]);
    expect((await cb("?code=x")).status).toBe(403);
    platform.nextToken = await platform.loginToken(["plant_staff"]); // plant staff never open Lab Records
    expect((await cb("?code=x")).status).toBe(403);
    platform.nextToken = await platform.summaryToken();
    expect((await cb("?code=x")).status).toBe(403);
  });
});

describe("tile numbers for the launcher", () => {
  const ask = (authorization?: string) =>
    summary(new Request("http://localhost:3001/api/plantops/summary", { headers: authorization ? { authorization } : {} }));

  it("answers the platform's signed ticket", async () => {
    const res = await ask(`Bearer ${await platform.summaryToken()}`);
    expect(res.status).toBe(200);
    expect((await res.json()).badges).toEqual([
      { text: "Form 1 due this month", tone: "warn" },
      { text: "0 tests today", tone: "info" },
    ]);
  });

  it("refuses no ticket, a login token, and a ticket for another module", async () => {
    expect((await ask()).status).toBe(401);
    expect((await ask(`Bearer ${await platform.loginToken()}`)).status).toBe(401);
    expect((await ask(`Bearer ${await platform.summaryToken("floor_stock")}`)).status).toBe(401);
  });
});

describe("who may do what (server/session.ts)", () => {
  it.each<[string, ModuleSession["roles"], { canEnter: boolean; canApprove: boolean }]>([
    ["lab technician: enters, can't approve", ["lab_technician"], { canEnter: true, canApprove: false }],
    ["lab lead: enters and approves", ["lab_lead"], { canEnter: true, canApprove: true }],
    ["owner: approves, doesn't enter", ["tenant_admin"], { canEnter: false, canApprove: true }],
    ["owner who is also a technician: both", ["lab_technician", "tenant_admin"], { canEnter: true, canApprove: true }],
  ])("%s", (_name, roles, expected) => {
    expect(toLabUser(session({ roles }))).toMatchObject(expected);
  });
});

describe("health check", () => {
  it("reaches the database with the lab_app login", async () => {
    const res = await health();
    expect(await res.json()).toEqual({ ok: true, module: "lab_records", database: "ok" });
  });
});

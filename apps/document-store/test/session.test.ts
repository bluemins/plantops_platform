// Document Store login, session and support view through the shared module kit: the same rules as Lab Records
// (one-time code, 12 h session, 5-minute re-check, read-only support), plus who may open this module.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as callback } from "@/app/sso/callback/route";
import { GET as supportEntry } from "@/app/sso/support/route";
import { GET as summary } from "@/app/api/plantops/summary/route";
import { GET as health } from "@/app/health/route";
import { POST as uploadRoute } from "@/app/api/files/route";
import { proxy } from "@/proxy";
import { kit } from "@/server/kit";
import { toDocUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { startFakePlatform, TENANT, USER, type FakePlatform } from "./fake-platform";
import { asOwner, docUser, PDF, refused } from "./helpers";

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
  const cb = (q: string) => callback(new NextRequest(`http://localhost:3003/sso/callback${q}`));

  it("a document keeper gets a session; the redirect stays on this site", async () => {
    platform.nextToken = await platform.loginToken(["document_keeper"]);
    const res = await cb("?code=abc&next=%2Fdocuments%2Fnew");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/documents/new");
    expect(await kit.openCookie(cookieOf(res, kit.SESSION_COOKIE))).toMatchObject({ tenant_id: TENANT, user_id: USER, roles: ["document_keeper"] });
    platform.nextToken = await platform.loginToken(["document_keeper"]);
    expect((await cb("?code=abc&next=%2F%2Fevil.example")).headers.get("location")).toBe("/");
  });

  it("a lab technician (no Document Store role) is refused", async () => {
    platform.nextToken = await platform.loginToken(["lab_technician"]);
    expect((await cb("?code=abc")).status).toBe(403);
  });

  it("no session: pages go to the platform login, APIs get 401", async () => {
    const page = await proxy(new NextRequest("http://localhost:3003/documents/new"));
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).searchParams.get("module")).toBe("document_store");
    expect((await proxy(new NextRequest("http://localhost:3003/api/documents", { method: "POST" }))).status).toBe(401);
  });

  it("roles: owner and keeper manage, only the owner is owner", () => {
    const s = (roles: string[]) => ({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["document_store"], login_at: Date.now(), checked_at: Date.now() }) as never;
    expect(toDocUser(s(["document_keeper"]))).toMatchObject({ canManage: true, isOwner: false });
    expect(toDocUser(s(["tenant_admin"]))).toMatchObject({ canManage: true, isOwner: true });
  });
});

describe("support view", () => {
  it("enters read-only; the proxy refuses any change (uploads included)", async () => {
    platform.nextToken = await platform.supportToken();
    const res = await supportEntry(new NextRequest("http://localhost:3003/sso/support?code=abc"));
    expect(res.status).toBe(307);
    const value = cookieOf(res, kit.SUPPORT_COOKIE)!;
    expect(await kit.openSupportCookie(value)).toMatchObject({ tenant_id: TENANT, read_only: true });
    const req = (method: string, path: string) =>
      new NextRequest(`http://localhost:3003${path}`, { method, headers: { cookie: `${kit.SUPPORT_COOKIE}=${encodeURIComponent(value)}` } });
    expect((await proxy(req("GET", "/"))).status).toBe(200);
    for (const [m, p] of [["POST", "/api/files"], ["POST", "/api/documents"], ["POST", "/api/documents/x/renew"]]) {
      expect((await proxy(req(m!, p!))).status).toBe(403);
    }
  });

  it("the owner (only) sees the support views", async () => {
    const tenantId = crypto.randomUUID();
    await asOwner("insert into document_store.support_views (tenant_id, super_admin_id, super_admin_name, path) values ($1, $2, 'PlantOps support', '/files/x')", [tenantId, crypto.randomUUID()]);
    expect((await listSupportViews(docUser(tenantId, ["tenant_admin"]))).map((v) => v.path)).toEqual(["/files/x"]);
    expect((await refused(() => listSupportViews(docUser(tenantId, ["document_keeper"])))).status).toBe(403);
  });
});

describe("upload route: the file itself, never a form", () => {
  const post = (type: string, body: BodyInit, extra: Record<string, string> = {}) =>
    uploadRoute(new Request("http://localhost:3003/api/files", { method: "POST", headers: { "content-type": type, ...extra }, body }), undefined as never);

  it("refuses form posts and plain text (what another website could send)", async () => {
    expect((await post("multipart/form-data; boundary=x", "--x--")).status).toBe(415);
    expect((await post("application/x-www-form-urlencoded", "a=b")).status).toBe(415);
    expect((await post("text/plain", "hello")).status).toBe(415);
  });

  it("refuses a declared size over 10 MB before reading it", async () => {
    expect((await post("application/pdf", PDF, { "content-length": String(11 * 1024 * 1024) })).status).toBe(413);
  });

});

describe("tile numbers and health", () => {
  it("answers the platform's ticket; refuses anything else", async () => {
    const ok = await summary(new Request("http://x/api/plantops/summary", { headers: { authorization: `Bearer ${await platform.summaryToken()}` } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).badges.at(-1).text).toMatch(/documents?$/);
    expect((await summary(new Request("http://x/api/plantops/summary", { headers: { authorization: `Bearer ${await platform.loginToken()}` } }))).status).toBe(401);
  });

  it("reaches the database with the doc_app login", async () => {
    expect(await (await health()).json()).toEqual({ ok: true, module: "document_store", database: "ok" });
  });
});

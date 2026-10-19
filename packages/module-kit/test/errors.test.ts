// Error log (STABILITY_PLAN B-09): a module's server errors reach the platform with its credentials and the plant
// read from its own cookie; reporting never throws and never changes the answer the user gets.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cookieFrom, kindOf, reportError, reportErrorsTo } from "../src/errors";
import { handle } from "../src/http";
import { createModule } from "../src/module";

let server: Server;
let url = "";
let answer = 201;
const received: { path: string; auth: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", body: JSON.parse(raw || "{}") });
      res.writeHead(answer, { "content-type": "application/json" });
      res.end(JSON.stringify({ kept: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  reportErrorsTo(null);
  return new Promise<void>((r) => server.close(() => r()));
});

const kitFor = (platformUrl: () => string) =>
  createModule({
    moduleId: "complaint_box",
    label: "Complaint Box",
    env: { platformUrl, clientSecret: () => "secret", sessionSecret: () => "x".repeat(32), secureCookies: () => false },
  });

/** Waits for the fire-and-forget send handle() starts. */
async function nextReceived(before: number) {
  for (let i = 0; i < 100 && received.length === before; i++) await new Promise((r) => setTimeout(r, 10));
  return received.at(-1);
}

describe("errors from handle()", () => {
  it("a 500 is sent to the platform with the module's credentials and the plant / user from the session cookie", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const kit = kitFor(() => url);
    const tenant = randomUUID();
    const user = randomUUID();
    const cookie = await kit.sealCookie({ tenant_id: tenant, user_id: user, roles: ["complaint_desk"], enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() });
    const route = handle(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'id')");
    });
    const before = received.length;
    const res = await route(new Request("http://localhost/api/complaints/C-1?mobile=9876543210", { method: "GET", headers: { cookie: `other=1; ${kit.SESSION_COOKIE}=${encodeURIComponent(cookie)}` } }), {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong" });
    const sent = await nextReceived(before);
    expect(sent).toMatchObject({
      path: "/api/m/errors",
      auth: "Basic " + btoa("complaint_box:secret"),
      body: { method: "GET", path: "/api/complaints/C-1", kind: "api", message: "TypeError: Cannot read properties of undefined (reading 'id')", tenant_id: tenant, user_id: user },
    });
    expect(String(sent!.body.stack)).not.toContain("9876543210");
    log.mockRestore();
  });

  it("a refusal (HttpError) is not an error: nothing is sent", async () => {
    kitFor(() => url);
    const { badRequest } = await import("../src/http");
    const before = received.length;
    const res = await handle(async () => {
      throw badRequest("Please enter a name");
    })(new Request("http://localhost/api/x", { method: "GET" }), {});
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 50));
    expect(received.length).toBe(before);
  });

  it("no cookie, a forged cookie: sent without a plant", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const kit = kitFor(() => url);
    const before = received.length;
    await handle(async () => {
      throw new Error("boom");
    })(new Request("http://localhost/api/y", { method: "GET", headers: { cookie: `${kit.SESSION_COOKIE}=forged` } }), {});
    expect((await nextReceived(before))!.body).toMatchObject({ path: "/api/y", tenant_id: null, user_id: null });
    log.mockRestore();
  });

  it("platform down or refusing: the user still gets the normal 500, nothing throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    kitFor(() => "http://127.0.0.1:9");
    const res = await handle(async () => {
      throw new Error("boom");
    })(new Request("http://localhost/api/z", { method: "GET" }), {});
    expect(res.status).toBe(500);
    answer = 503;
    kitFor(() => url);
    await expect(reportError(new Error("x"), { method: "GET", path: "/api/z", kind: "api" })).resolves.toBeUndefined();
    answer = 201;
    log.mockRestore();
  });
});

describe("onRequestError (screens, actions, the proxy)", () => {
  it("Next's request info: path without query, kind from the route type, cookie header as a list", async () => {
    const kit = kitFor(() => url);
    const tenant = randomUUID();
    const support = await kit.sealSupportCookie({ tenant_id: tenant, super_admin_id: randomUUID(), read_only: true, expires_at: Date.now() + 60_000 });
    const before = received.length;
    await kit.onRequestError(new Error("render failed"), { path: "/complaints?status=open", method: "GET", headers: { cookie: [`${kit.SUPPORT_COOKIE}=${encodeURIComponent(support)}`] } }, { routeType: "render" });
    // a support view: the plant is kept, super_admin is never recorded as a user
    expect((await nextReceived(before))!.body).toMatchObject({ path: "/complaints", kind: "page", message: "render failed", tenant_id: tenant, user_id: null });
  });

  it("helpers", () => {
    expect(cookieFrom("a=1; plantops_x=v%3D1; b=2", "plantops_x")).toBe("v=1");
    expect(cookieFrom(null, "a")).toBeUndefined();
    expect([kindOf("render"), kindOf("action"), kindOf("proxy"), kindOf("route"), kindOf(undefined)]).toEqual(["page", "action", "proxy", "api", "api"]);
  });
});

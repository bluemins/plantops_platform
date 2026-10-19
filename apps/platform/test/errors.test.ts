// Error log (STABILITY_PLAN B-09): modules send their server errors with their credentials, the platform keeps its
// own, at most 20 per app per minute, super_admin reads them, plants never can, and the daily job removes old ones.
import { beforeAll, describe, expect, it } from "vitest";
import { buildErrorReport } from "@plantops/types";
import * as moduleErrorsRoute from "@/app/api/m/errors/route";
import * as superErrorsRoute from "@/app/api/super/errors/route";
import { sha256 } from "@/server/crypto";
import { appDb, withTenant } from "@/server/db";
import { listErrors, purgeOldErrors } from "@/server/errors";
import { handle } from "@/server/http";
import { sql } from "drizzle-orm";
import { asOwner, call, makePlant, makeSuperAdmin, type Handler } from "./helpers";

const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const SECRET = "complaint-module-test-secret";
const DOC_SECRET = "doc-module-test-secret";
const COMPLAINT = basic("complaint_box", SECRET);
const DOC = basic("document_store", DOC_SECRET);
const send = (body: unknown, headers = COMPLAINT) => call(moduleErrorsRoute.POST as Handler, { body, headers });
const rows = (app: string) =>
  asOwner<{ app: string; method: string; path: string; kind: string; message: string; stack: string | null; tenant_id: string | null; user_id: string | null }>(
    "select app, method, path, kind, message, stack, tenant_id, user_id from platform.error_log where app = $1 order by id",
    [app],
  ).then((r) => r.rows);

let A: Awaited<ReturnType<typeof makePlant>>;
beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://complaints.example.test', client_secret_hash = $1 where id = 'complaint_box'", [sha256(SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://docs.example.test', client_secret_hash = $1 where id = 'document_store'", [sha256(DOC_SECRET)]);
  A = await makePlant({ modules: ["complaint_box"] });
});

const report = (over: Record<string, unknown> = {}) => ({ method: "POST", path: "/api/complaints", kind: "api", message: "TypeError: x is undefined", stack: "at save (complaints.ts:10)", ...over });

describe("a module sends its errors", () => {
  it("kept under the module's own name, with the plant; a module can't claim another app's name", async () => {
    const r = await send(report({ tenant_id: A.tenantId, app: "platform" }));
    expect(r).toMatchObject({ status: 201, body: { kept: true } });
    expect(await rows("complaint_box")).toEqual([
      { app: "complaint_box", method: "POST", path: "/api/complaints", kind: "api", message: "TypeError: x is undefined", stack: "at save (complaints.ts:10)", tenant_id: A.tenantId, user_id: null },
    ]);
  });

  it("wrong or missing credentials: 401, nothing kept", async () => {
    const before = (await rows("complaint_box")).length;
    expect((await send(report(), basic("complaint_box", "wrong"))).status).toBe(401);
    expect((await send(report(), {} as never)).status).toBe(401);
    expect((await rows("complaint_box")).length).toBe(before);
  });

  it("invalid reports are refused: a query string in the path, an unknown kind, an over-long message", async () => {
    expect((await send(report({ path: "/api/x?phone=9876543210" }))).status).toBe(400);
    expect((await send(report({ kind: "cron" }))).status).toBe(400);
    expect((await send(report({ message: "x".repeat(501) }))).status).toBe(400);
  });

  it("an unknown plant id is kept without the plant", async () => {
    await send(report({ path: "/api/unknown-plant", tenant_id: "00000000-0000-4000-8000-000000000000" }));
    expect((await rows("complaint_box")).find((r) => r.path === "/api/unknown-plant")?.tenant_id).toBeNull();
  });

  it("at most 20 per app per minute: an error in a loop can't fill the database", async () => {
    const kept: boolean[] = [];
    for (let i = 0; i < 23; i++) kept.push((await send(report({ path: `/api/loop/${i}` }), DOC)).body.kept);
    expect(kept.filter(Boolean)).toHaveLength(20);
    expect(kept.slice(20)).toEqual([false, false, false]);
    expect(await rows("document_store")).toHaveLength(20);
  });
});

describe("who can read it", () => {
  it("plant logins can neither read nor write the table directly", async () => {
    await expect(withTenant(A.tenantId, (tx) => tx.execute(sql`select count(*) from platform.error_log`))).rejects.toThrow();
    await expect(appDb().execute(sql`insert into platform.error_log (app, method, path, kind, message) values ('x', 'GET', '/', 'api', 'm')`)).rejects.toThrow();
  });

  it("super_admin sees the groups with the plant code and the counts; without login 401", async () => {
    expect((await call(superErrorsRoute.GET as Handler)).status).toBe(401);
    const sa = await makeSuperAdmin();
    await send(report({ path: "/api/twice", tenant_id: A.tenantId }));
    await send(report({ path: "/api/twice", tenant_id: A.tenantId }));
    const r = await call(superErrorsRoute.GET as Handler, { cookie: sa.cookie });
    expect(r.status).toBe(200);
    const twice = r.body.groups.find((g: { path: string }) => g.path === "/api/twice");
    expect(twice).toMatchObject({ app: "complaint_box", count: 2, plants: [A.code], message: "TypeError: x is undefined" });
    expect(r.body.today).toBeGreaterThanOrEqual(2);
  });
});

describe("the platform's own errors", () => {
  it("an unexpected error in a platform route answers 500 and is kept (no query string, digits blanked)", async () => {
    const boom = handle(async () => {
      throw new Error("could not reach 9876543210");
    });
    const res = await boom(new Request("http://localhost/api/boom/route?phone=9876543210", { method: "GET" }), {} as never);
    expect(res.status).toBe(500);
    let kept: Awaited<ReturnType<typeof rows>> = [];
    for (let i = 0; i < 50 && !kept.length; i++) {
      await new Promise((r) => setTimeout(r, 20));
      kept = (await rows("platform")).filter((r) => r.path === "/api/boom/route");
    }
    expect(kept[0]).toMatchObject({ method: "GET", kind: "api", message: "could not reach #######", tenant_id: null });
  });

  it("buildErrorReport: path only, message and trace cut, error class kept, bad ids dropped", () => {
    class DbError extends Error {
      override name = "DbError";
    }
    const r = buildErrorReport(new DbError("x".repeat(600)), { method: "post", path: "/a/b?c=1#d", kind: "page", tenant_id: "not-a-uuid" });
    expect(r).toMatchObject({ method: "POST", path: "/a/b", kind: "page", tenant_id: null, user_id: null });
    expect(r.message).toHaveLength(500);
    expect(r.message.startsWith("DbError: x")).toBe(true);
    expect(buildErrorReport("plain text", { method: "GET", path: "", kind: "api" })).toMatchObject({ path: "/", message: "plain text", stack: null });
  });
});

describe("cleanup", () => {
  it("the daily job removes rows older than 30 days, keeps newer ones", async () => {
    await asOwner("insert into platform.error_log (at, app, method, path, kind, message) values (now() - interval '31 days', 'lab_records', 'GET', '/old', 'page', 'old'), (now() - interval '29 days', 'lab_records', 'GET', '/recent', 'page', 'recent')");
    expect(await purgeOldErrors()).toBeGreaterThanOrEqual(1);
    expect((await rows("lab_records")).map((r) => r.path)).toEqual(["/recent"]);
    expect((await listErrors(7)).groups.some((g) => g.path === "/recent")).toBe(false); // older than 7 days: not on the screen
  });
});

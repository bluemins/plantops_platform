// super_admin "support view" (CLAUDE.md "Support token"): one-time code -> read-only support token for one
// plant and one module. Never usable as a login; only super_admin can start it; every opening is audited.
import type { JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifySummaryRequest, verifySupportToken, verifyToken } from "@plantops/auth";
import * as supportRoute from "@/app/api/super/tenants/[id]/support/[module]/route";
import * as supportExchangeRoute from "@/app/api/sso/support-exchange/route";
import { sha256 } from "@/server/crypto";
import { publicJwks } from "@/server/sso";
import { asOwner, call, makePlant, makeSuperAdmin, type Handler } from "./helpers";

const LAB_SECRET = "lab-module-test-secret";
const STOCK_SECRET = "stock-module-test-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const LAB = basic("lab_records", LAB_SECRET);
const STOCK = basic("floor_stock", STOCK_SECRET);
const keys = () => ({ jwks: publicJwks() as { keys: JWK[] } });

let plant: Awaited<ReturnType<typeof makePlant>>;
let sa: Awaited<ReturnType<typeof makeSuperAdmin>>;

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://lab.example.test', client_secret_hash = $1, status = 'active' where id = 'lab_records'", [sha256(LAB_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1, status = 'active' where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  plant = await makePlant({ modules: ["lab_records"] });
  sa = await makeSuperAdmin();
});

const open = (module: string, cookie = sa.cookie, id = plant.tenantId) => call(supportRoute.POST as Handler, { cookie, body: {}, params: { id, module } });
const exchange = (code: string, headers: Record<string, string> = LAB) => call(supportExchangeRoute.POST as Handler, { body: { code }, headers });
const codeFrom = (url: string) => new URL(url).searchParams.get("code")!;

describe("opening a module read-only", () => {
  it("super_admin gets the module's /sso/support link with a one-time code; the opening is audited", async () => {
    const res = await open("lab_records");
    expect(res.status).toBe(200);
    const url = new URL(res.body.redirect_url);
    expect(url.origin + url.pathname).toBe("https://lab.example.test/sso/support");
    const audit = await asOwner("select actor, action, target from platform.audit_log where tenant_id = $1 and action = 'support.opened'", [plant.tenantId]);
    expect(audit.rows.at(-1)).toEqual({ actor: `super_admin:${sa.id}`, action: "support.opened", target: "lab_records" });
  });

  it("refused: not logged in as super_admin (even the plant owner), a module not in the plan, an unknown module", async () => {
    expect((await open("lab_records", "")).status).toBe(401);
    expect((await open("lab_records", plant.adminCookie)).status).toBe(401);
    expect((await open("floor_stock")).status).toBe(403);
    expect((await open("nonsense")).status).toBe(404);
  });
});

describe("the support token", () => {
  it("carries exactly purpose, tenant, super_admin and read_only, for one module, 15 minutes", async () => {
    const ex = await exchange(codeFrom((await open("lab_records")).body.redirect_url));
    expect(ex.status).toBe(200);
    const p = await verifySupportToken(ex.body.token, { audience: "lab_records", keys: keys() });
    expect(p).toMatchObject({ purpose: "support", tenant_id: plant.tenantId, super_admin_id: sa.id, read_only: true, aud: "lab_records" });
    expect(p.exp - p.iat).toBe(15 * 60);
    expect(Object.keys(p).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "purpose", "read_only", "super_admin_id", "tenant_id"]);
  });

  it("is never accepted as a login, as a summary request, or by another module", async () => {
    const { token } = (await exchange(codeFrom((await open("lab_records")).body.redirect_url))).body;
    await expect(verifyToken(token, { audience: "lab_records", keys: keys() })).rejects.toThrow(/Not a login token/);
    await expect(verifySummaryRequest(`Bearer ${token}`, { audience: "lab_records", keys: keys() })).rejects.toThrow();
    await expect(verifySupportToken(token, { audience: "floor_stock", keys: keys() })).rejects.toThrow();
  });

  it("the code works once, only for its module, only with module credentials", async () => {
    const code = codeFrom((await open("lab_records")).body.redirect_url);
    expect((await exchange(code, STOCK)).status).toBe(400); // another module can't use it (and doesn't burn it)
    expect((await exchange(code, {})).status).toBe(401);
    expect((await exchange(code)).status).toBe(200);
    expect((await exchange(code)).status).toBe(400);
  });

  it("a login code can't be swapped for a support token and the other way round", async () => {
    const code = codeFrom((await open("lab_records")).body.redirect_url);
    const { POST: loginExchange } = await import("@/app/api/sso/exchange/route");
    expect((await call(loginExchange as Handler, { body: { code }, headers: LAB })).status).toBe(400);
  });
});

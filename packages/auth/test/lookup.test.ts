// Module-to-module lookup ticket (docs/FIELD_DAY_PHASE_PLAN.md): verifyLookupRequest against locally signed tickets, and
// fetchLookupTicket against a fake platform.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleId } from "@plantops/types";
import { fetchLookupTicket, InvalidTokenError, PlatformRequestError, verifyLookupRequest, verifySummaryRequest, verifySupportToken, verifyToken, type ModuleCredentials } from "../src";

const tenant = randomUUID();
let key: CryptoKey;
let foreignKey: CryptoKey;
let jwks: { keys: JWK[] };
let server: Server;
let creds: ModuleCredentials;
let answer: { status: number; body: unknown } = { status: 200, body: {} };
const seen: { path: string; auth: string; body: string }[] = [];

async function sign(claims: Record<string, unknown>, aud: ModuleId = "order_capture", opts: { ttl?: string; iat?: number; with?: CryptoKey } = {}) {
  const t = new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setIssuer("plantops-platform").setAudience(aud).setJti(randomUUID());
  if (opts.iat) t.setIssuedAt(opts.iat);
  else t.setIssuedAt();
  return t.setExpirationTime(opts.ttl ?? "60s").sign(opts.with ?? key);
}
const ticket = (over: Record<string, unknown> = {}, aud: ModuleId = "order_capture", o?: Parameters<typeof sign>[2]) =>
  sign({ purpose: "lookup", tenant_id: tenant, from: "attendance_salary", scope: "customers", ...over }, aud, o);

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  key = pair.privateKey;
  foreignKey = (await generateKeyPair("EdDSA", { crv: "Ed25519" })).privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA" }] };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", body });
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  creds = { platformUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, moduleId: "attendance_salary", clientSecret: "att-secret" };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("verifyLookupRequest", () => {
  // a getter: the keys exist only after beforeAll
  const o = () => ({ audience: "order_capture" as const, keys: { jwks }, scope: "customers" as const });

  it("accepts a fresh ticket for this module and this scope", async () => {
    expect(await verifyLookupRequest(`Bearer ${await ticket()}`, o())).toMatchObject({ purpose: "lookup", tenant_id: tenant, from: "attendance_salary", scope: "customers" });
  });

  it("refuses another scope, another module, a missing header, an old or foreign-signed ticket", async () => {
    await expect(verifyLookupRequest(`Bearer ${await ticket({ scope: "customer_location" })}`, o())).rejects.toThrow(/another purpose/);
    await expect(verifyLookupRequest(`Bearer ${await ticket()}`, { ...o(), scope: "customer_location" })).rejects.toThrow(/another purpose/);
    await expect(verifyLookupRequest(`Bearer ${await ticket({}, "lab_records")}`, o())).rejects.toThrow(InvalidTokenError);
    await expect(verifyLookupRequest(undefined, o())).rejects.toThrow(/Missing/);
    await expect(verifyLookupRequest("Basic abc", o())).rejects.toThrow(/Missing/);
    await expect(verifyLookupRequest(`Bearer ${await ticket({}, "order_capture", { iat: Math.floor(Date.now() / 1000) - 120, ttl: "1h" })}`, o())).rejects.toThrow(InvalidTokenError);
    await expect(verifyLookupRequest(`Bearer ${await ticket({}, "order_capture", { with: foreignKey })}`, o())).rejects.toThrow(InvalidTokenError);
    await expect(verifyLookupRequest(`Bearer ${await ticket({ from: "nobody" })}`, o())).rejects.toThrow(/Not a lookup ticket/);
  });

  it("refuses login, summary and support tokens as a lookup ticket", async () => {
    const login = await sign({ tenant_id: tenant, user_id: randomUUID(), roles: ["tenant_admin"], enabled_modules: ["order_capture"] });
    const summary = await sign({ purpose: "summary", tenant_id: tenant, view: "owner" });
    const support = await sign({ purpose: "support", tenant_id: tenant, super_admin_id: randomUUID(), read_only: true });
    for (const t of [login, summary, support]) await expect(verifyLookupRequest(`Bearer ${t}`, o())).rejects.toThrow(/Not a lookup ticket/);
  });

  it("a lookup ticket is never a login, a summary request or a support token", async () => {
    const t = await ticket();
    const o = { audience: "order_capture" as const, keys: { jwks } };
    await expect(verifyToken(t, o)).rejects.toThrow(/Not a login token/);
    await expect(verifySummaryRequest(`Bearer ${t}`, o)).rejects.toThrow(/Not a summary request token/);
    await expect(verifySupportToken(t, o)).rejects.toThrow(/Not a support token/);
  });
});

describe("fetchLookupTicket", () => {
  it("asks with the module's own credentials and returns the ticket and the module's address", async () => {
    answer = { status: 200, body: { ticket: "t.t.t", url: "https://orders.example" } };
    expect(await fetchLookupTicket(creds, tenant, "order_capture", "customers")).toEqual({ ticket: "t.t.t", url: "https://orders.example" });
    expect(seen.at(-1)).toEqual({ path: `/api/m/tenants/${tenant}/lookup-ticket`, auth: `Basic ${btoa("attendance_salary:att-secret")}`, body: JSON.stringify({ to: "order_capture", scope: "customers" }) });
  });

  it("403 (pair not allowed, module off) is null; other failures throw", async () => {
    answer = { status: 403, body: { error: "off" } };
    expect(await fetchLookupTicket(creds, tenant, "order_capture", "customers")).toBeNull();
    answer = { status: 503, body: { error: "down" } };
    await expect(fetchLookupTicket(creds, tenant, "order_capture", "customers")).rejects.toBeInstanceOf(PlatformRequestError);
  });
});

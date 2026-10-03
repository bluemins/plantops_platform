// Module session helper + summary-request verification, against a fake platform (no database needed).
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModuleId, RoleId, UserStatus } from "@plantops/types";
import {
  InvalidTokenError,
  openSession,
  refreshModuleSession,
  sealSession,
  startModuleSession,
  verifySummaryRequest,
  verifyToken,
  type ModuleCredentials,
  type ModuleSession,
} from "../src";

const MIN = 60_000;
const SECRET = "module-session-secret-at-least-32-characters";
const tenant = randomUUID();
const user = randomUUID();

let key: CryptoKey;
let jwks: { keys: JWK[] };
let server: Server;
let creds: ModuleCredentials;
// What the fake platform answers; tests change these.
let status: UserStatus | number = { active: true, roles: ["lab_technician"], enabled_modules: ["lab_records"] };
let nextToken = "";

async function sign(claims: Record<string, unknown>, aud: ModuleId = "lab_records", ttl = "15m") {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuer("plantops-platform")
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .setJti(randomUUID())
    .sign(key);
}
const loginToken = (roles: RoleId[] = ["lab_technician"], enabled: ModuleId[] = ["lab_records"]) =>
  sign({ tenant_id: tenant, user_id: user, roles, enabled_modules: enabled });
const summaryToken = (aud: ModuleId = "lab_records", ttl = "60s") => sign({ purpose: "summary", tenant_id: tenant, view: "owner" }, aud, ttl);

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  key = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA" }] };
  server = createServer((req, res) => {
    if (req.url === "/api/sso/exchange") {
      res.writeHead(nextToken ? 200 : 400, { "content-type": "application/json" });
      return res.end(JSON.stringify(nextToken ? { token: nextToken } : { error: "bad code" }));
    }
    if (req.url?.startsWith("/api/m/tenants/")) {
      if (typeof status === "number") {
        res.writeHead(status);
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(status));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  creds = { platformUrl: `http://127.0.0.1:${port}`, moduleId: "lab_records", clientSecret: "x" };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const fresh = (now: number): ModuleSession => ({
  tenant_id: tenant,
  user_id: user,
  roles: ["lab_technician"],
  enabled_modules: ["lab_records"],
  login_at: now,
  checked_at: now,
});

describe("startModuleSession", () => {
  it("swaps the code for a verified token and starts a session", async () => {
    nextToken = await loginToken();
    const s = await startModuleSession(creds, "code", { jwks }, 1000);
    expect(s).toEqual({ tenant_id: tenant, user_id: user, roles: ["lab_technician"], enabled_modules: ["lab_records"], login_at: 1000, checked_at: 1000 });
  });

  it("refuses a user whose roles don't give this module, and a bad code", async () => {
    nextToken = await loginToken(["store_keeper"], ["lab_records", "floor_stock"]);
    await expect(startModuleSession(creds, "code", { jwks })).rejects.toThrow(/No access/);
    nextToken = "";
    await expect(startModuleSession(creds, "code", { jwks })).rejects.toThrow(/400/);
  });

  it("refuses a summary token presented as a login", async () => {
    nextToken = await summaryToken();
    await expect(startModuleSession(creds, "code", { jwks })).rejects.toThrow(InvalidTokenError);
  });
});

describe("session cookie", () => {
  it("round-trips, and rejects tampering, another module, another secret and an ended shift", async () => {
    const now = Date.now();
    const sealed = await sealSession(fresh(now), { secret: SECRET, moduleId: "lab_records" });
    expect(await openSession(sealed, { secret: SECRET, moduleId: "lab_records" })).toEqual(fresh(now));
    expect(await openSession(sealed.slice(0, -2) + "xx", { secret: SECRET, moduleId: "lab_records" })).toBeNull();
    expect(await openSession(sealed, { secret: SECRET, moduleId: "floor_stock" })).toBeNull();
    expect(await openSession(sealed, { secret: SECRET + "-other", moduleId: "lab_records" })).toBeNull();
    const old = await sealSession(fresh(now - 13 * 60 * MIN), { secret: SECRET, moduleId: "lab_records" });
    expect(await openSession(old, { secret: SECRET, moduleId: "lab_records" })).toBeNull();
    expect(await openSession(undefined, { secret: SECRET, moduleId: "lab_records" })).toBeNull();
  });

  it("refuses a short session secret", async () => {
    await expect(sealSession(fresh(Date.now()), { secret: "short", moduleId: "lab_records" })).rejects.toThrow(/32/);
  });
});

describe("refreshModuleSession (5-minute re-check, 12-hour shift)", () => {
  const t0 = 1_000_000_000_000;

  it("does not call the platform within 5 minutes", async () => {
    status = 500; // would fail if called
    expect(await refreshModuleSession(creds, fresh(t0), t0 + 4 * MIN)).toEqual({ session: fresh(t0), changed: false });
  });

  it("re-checks after 5 minutes and picks up new roles", async () => {
    status = { active: true, roles: ["lab_technician", "store_keeper"], enabled_modules: ["lab_records", "floor_stock"] };
    const r = await refreshModuleSession(creds, fresh(t0), t0 + 6 * MIN);
    expect(r?.changed).toBe(true);
    expect(r?.session).toMatchObject({ roles: ["lab_technician", "store_keeper"], checked_at: t0 + 6 * MIN, login_at: t0 });
  });

  it.each<[string, UserStatus | number]>([
    ["user disabled", { active: false, roles: ["lab_technician"], enabled_modules: ["lab_records"] }],
    ["role removed", { active: true, roles: ["store_keeper"], enabled_modules: ["lab_records", "floor_stock"] }],
    ["module removed from plan", { active: true, roles: ["lab_technician"], enabled_modules: [] }],
    ["module switched off / unknown user (platform says 401/404)", 401],
  ])("ends the session: %s", async (_n, s) => {
    status = s;
    expect(await refreshModuleSession(creds, fresh(t0), t0 + 6 * MIN)).toBeNull();
  });

  it("platform unreachable: keeps going up to 15 minutes, then logs out", async () => {
    status = 503;
    expect(await refreshModuleSession(creds, fresh(t0), t0 + 10 * MIN)).toEqual({ session: fresh(t0), changed: false });
    expect(await refreshModuleSession(creds, fresh(t0), t0 + 16 * MIN)).toBeNull();
  });

  it("ends after 12 hours even if everything else is fine", async () => {
    status = { active: true, roles: ["lab_technician"], enabled_modules: ["lab_records"] };
    expect(await refreshModuleSession(creds, { ...fresh(t0), checked_at: t0 + 719 * MIN }, t0 + 720 * MIN)).toBeNull();
  });
});

describe("summary request vs login token", () => {
  it("accepts a fresh summary token for this module", async () => {
    const p = await verifySummaryRequest(`Bearer ${await summaryToken()}`, { audience: "lab_records", keys: { jwks } });
    expect(p).toMatchObject({ purpose: "summary", tenant_id: tenant, view: "owner" });
  });

  it("rejects: login token, other module, missing header, too long-lived", async () => {
    const opts = { audience: "lab_records" as const, keys: { jwks } };
    await expect(verifySummaryRequest(`Bearer ${await loginToken()}`, opts)).rejects.toThrow(InvalidTokenError);
    await expect(verifySummaryRequest(`Bearer ${await summaryToken("floor_stock")}`, opts)).rejects.toThrow(InvalidTokenError);
    await expect(verifySummaryRequest(undefined, opts)).rejects.toThrow(/Missing/);
    // a token claiming a 1-hour life is still refused after 70 s (maxTokenAge)
    const old = await new SignJWT({ purpose: "summary", tenant_id: tenant, view: "owner" })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer("plantops-platform")
      .setAudience("lab_records")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime("1h")
      .setJti(randomUUID())
      .sign(key);
    await expect(verifySummaryRequest(`Bearer ${old}`, opts)).rejects.toThrow(InvalidTokenError);
  });

  it("verifyToken refuses a summary token as a login", async () => {
    await expect(verifyToken(await summaryToken(), { audience: "lab_records", keys: { jwks } })).rejects.toThrow(/Not a login token/);
  });
});

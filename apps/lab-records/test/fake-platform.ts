// A stand-in for the PlantOps platform: publishes a throwaway public key, answers the code exchange, the
// 5-minute user re-check and branding. Tests change its answers; it signs tokens like the real platform.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { ModuleId, RoleId, UserStatus } from "@plantops/types";

export const TENANT = randomUUID();
export const USER = randomUUID();

/** The plant's products as the platform lists them (one active, one switched off). */
export const SKUS = [
  { id: randomUUID(), name: "Bisleri-style 500", sku_code: "P500", volume_ml: 500, units_per_pack: 24, pack_type: "case", status: "active" },
  { id: randomUUID(), name: "Old 1L", sku_code: null, volume_ml: 1000, units_per_pack: 1, pack_type: "bottle", status: "inactive" },
];

export interface FakePlatform {
  url: string;
  /** what POST /api/sso/exchange returns (empty = 400) */
  nextToken: string;
  /** what the status re-check returns (a number = that HTTP error) */
  status: UserStatus | number;
  statusCalls: number;
  sign(claims: Record<string, unknown>, aud?: ModuleId, ttl?: string): Promise<string>;
  loginToken(roles?: RoleId[]): Promise<string>;
  summaryToken(aud?: ModuleId): Promise<string>;
  close(): Promise<void>;
}

export async function startFakePlatform(): Promise<FakePlatform> {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const kid = randomUUID();
  const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA" } as JWK] };
  const fake = {
    nextToken: "",
    status: { active: true, display_name: "Atharv", roles: ["lab_technician"], enabled_modules: ["lab_records"] } as UserStatus | number,
    statusCalls: 0,
  };
  const send = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/.well-known/jwks.json") return send(res, 200, jwks);
    if (url === "/api/sso/exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (/^\/api\/m\/tenants\/[^/]+\/users\/[^/]+\/status$/.test(url)) {
      fake.statusCalls++;
      return typeof fake.status === "number" ? send(res, fake.status, {}) : send(res, 200, fake.status);
    }
    if (/^\/api\/m\/tenants\/[^/]+\/skus$/.test(url)) return send(res, 200, SKUS);
    if (/^\/api\/m\/tenants\/[^/]+\/branding$/.test(url)) {
      return send(res, 200, { tenant_id: TENANT, name: "Sample Aqua", brand_color: "#0e7490", logo_url: null });
    }
    send(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const sign = (claims: Record<string, unknown>, aud: ModuleId = "lab_records", ttl = "15m") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid })
      .setIssuer("plantops-platform")
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .setJti(randomUUID())
      .sign(pair.privateKey);

  return Object.assign(fake, {
    url,
    sign,
    loginToken: (roles: RoleId[] = ["lab_technician"]) => sign({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["lab_records"] }),
    summaryToken: (aud: ModuleId = "lab_records") => sign({ purpose: "summary", tenant_id: TENANT, view: "owner" }, aud, "60s"),
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

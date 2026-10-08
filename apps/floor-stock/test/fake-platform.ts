// A stand-in for the PlantOps platform: publishes a throwaway public key, answers the code exchange, the
// 5-minute user re-check, branding and products. Tests change its answers; it signs tokens like the real platform.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { AlertContact, ModuleId, RoleId, TenantSku, UserStatus } from "@plantops/types";

export const TENANT = randomUUID();
export const USER = randomUUID();
/** The people the platform lists for Floor Stock: two owners (one without email) and a store keeper. */
export const OWNER_ID = randomUUID();
export const NOMAIL_OWNER_ID = randomUUID();
export const KEEPER_ID = randomUUID();
export const CONTACTS: AlertContact[] = [
  { user_id: OWNER_ID, display_name: "Sujata", phone: null, email: "sujata@plant.example", roles: ["tenant_admin"] },
  { user_id: NOMAIL_OWNER_ID, display_name: "Ravi", phone: null, email: null, roles: ["store_keeper", "tenant_admin"] },
  { user_id: KEEPER_ID, display_name: "Atharv", phone: null, email: "atharv@plant.example", roles: ["store_keeper"] },
];

/** The plant's products: two bottles in cases, a 20 L jar and an inactive one. */
export const SKUS: TenantSku[] = [
  { id: randomUUID(), name: "Bluemins", sku_code: "B1L", volume_ml: 1000, units_per_pack: 12, pack_type: "case", status: "active" },
  { id: randomUUID(), name: "Bluemins", sku_code: "B500", volume_ml: 500, units_per_pack: 24, pack_type: "case", status: "active" },
  { id: randomUUID(), name: "Jar", sku_code: null, volume_ml: 20000, units_per_pack: 1, pack_type: "jar", status: "active" },
  { id: randomUUID(), name: "Old 2L", sku_code: null, volume_ml: 2000, units_per_pack: 1, pack_type: "bottle", status: "inactive" },
] as TenantSku[];

export interface FakePlatform {
  url: string;
  /** what POST /api/sso/exchange returns (empty = 400) */
  nextToken: string;
  /** what the status re-check returns (a number = that HTTP error) */
  status: UserStatus | number;
  /** what GET skus returns (null = platform error) */
  skus: TenantSku[] | null;
  /** what GET alert-contacts returns (null = platform error) */
  contacts: AlertContact[] | null;
  sign(claims: Record<string, unknown>, aud?: ModuleId, ttl?: string): Promise<string>;
  loginToken(roles?: RoleId[]): Promise<string>;
  summaryToken(aud?: ModuleId, tenantId?: string): Promise<string>;
  supportToken(superAdminId?: string): Promise<string>;
  close(): Promise<void>;
}

export async function startFakePlatform(): Promise<FakePlatform> {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const kid = randomUUID();
  const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA" } as JWK] };
  const fake = {
    nextToken: "",
    status: { active: true, display_name: "Atharv", roles: ["store_keeper"], enabled_modules: ["floor_stock"] } as UserStatus | number,
    skus: SKUS as TenantSku[] | null,
    contacts: CONTACTS as AlertContact[] | null,
  };
  const send = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/.well-known/jwks.json") return send(res, 200, jwks);
    if (url === "/api/sso/support-exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (url === "/api/sso/exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (/^\/api\/m\/tenants\/[^/]+\/users\/[^/]+\/status$/.test(url)) return typeof fake.status === "number" ? send(res, fake.status, {}) : send(res, 200, fake.status);
    if (/^\/api\/m\/tenants\/[^/]+\/skus$/.test(url)) return fake.skus ? send(res, 200, fake.skus) : send(res, 503, {});
    if (/^\/api\/m\/tenants\/[^/]+\/alert-contacts$/.test(url)) return fake.contacts ? send(res, 200, fake.contacts) : send(res, 503, {});
    if (/^\/api\/m\/tenants\/[^/]+\/branding$/.test(url)) return send(res, 200, { tenant_id: TENANT, name: "Sample Aqua", brand_color: "#0e7490", logo_url: null });
    send(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const sign = (claims: Record<string, unknown>, aud: ModuleId = "floor_stock", ttl = "15m") =>
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
    loginToken: (roles: RoleId[] = ["store_keeper"]) => sign({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["floor_stock"] }),
    supportToken: (superAdminId = randomUUID()) => sign({ purpose: "support", tenant_id: TENANT, super_admin_id: superAdminId, read_only: true }),
    summaryToken: (aud: ModuleId = "floor_stock", tenantId = TENANT) => sign({ purpose: "summary", tenant_id: tenantId, view: "owner" }, aud, "60s"),
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

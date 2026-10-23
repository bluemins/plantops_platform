// A stand-in for the PlantOps platform: publishes a throwaway public key, answers the code exchange, the
// 5-minute user re-check, branding and products. Tests change its answers; it signs tokens like the real platform.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { AlertContact, ModuleId, RoleId, TenantSku, UserStatus } from "@plantops/types";

export const TENANT = randomUUID();
export const USER = randomUUID();
/** The people the platform lists for Order Capture: two owners (one without email) and an Order desk. */
export const OWNER_ID = randomUUID();
export const NOMAIL_OWNER_ID = randomUUID();
export const KEEPER_ID = randomUUID();
export const CONTACTS: AlertContact[] = [
  { user_id: OWNER_ID, display_name: "Sujata", phone: null, email: "sujata@plant.example", roles: ["tenant_admin"] },
  { user_id: NOMAIL_OWNER_ID, display_name: "Ravi", phone: null, email: null, roles: ["order_desk", "tenant_admin"] },
  { user_id: KEEPER_ID, display_name: "Atharv", phone: null, email: "atharv@plant.example", roles: ["order_desk"] },
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
  /** every notification the module sent (POST /api/m/tenants/:tid/notifications) */
  notifications: { tenantId: string; body: Record<string, unknown> }[];
  /** HTTP status for notifications (201 = taken) */
  notifyStatus: number;
  /** enabled modules per plant for GET /api/tenants/:id/plan (unknown plant = Order Capture on) */
  enabled: Map<string, string[]>;
  /** module limits per plant for GET /api/tenants/:id/plan */
  limits: Map<string, Record<string, Record<string, number>>>;
  /** extra fields of the branding answer per plant (support_phone / support_hours) */
  branding: Map<string, Record<string, unknown>>;
  /** plants whose plan the platform can't answer (503) */
  planDown: Set<string>;
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
    status: { active: true, display_name: "Atharv", roles: ["order_desk"], enabled_modules: ["order_capture"] } as UserStatus | number,
    skus: SKUS as TenantSku[] | null,
    contacts: CONTACTS as AlertContact[] | null,
    notifications: [] as { tenantId: string; body: Record<string, unknown> }[],
    notifyStatus: 201,
    enabled: new Map<string, string[]>(),
    limits: new Map<string, Record<string, Record<string, number>>>(),
    branding: new Map<string, Record<string, unknown>>(),
    planDown: new Set<string>(),
  };
  const send = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? "";
    const notify = /^\/api\/m\/tenants\/([^/]+)\/notifications$/.exec(url);
    if (notify && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      if (fake.notifyStatus === 201) fake.notifications.push({ tenantId: notify[1]!, body: JSON.parse(raw) });
      return send(res, fake.notifyStatus, fake.notifyStatus === 201 ? { recipients: 2, created: 2 } : { error: "no" });
    }
    const plan = /^\/api\/tenants\/([^/]+)\/plan$/.exec(url);
    if (plan) {
      const tenantId = plan[1]!;
      if (fake.planDown.has(tenantId)) return send(res, 503, {});
      return send(res, 200, { tenant_id: tenantId, plan_name: "Growth", enabled_modules: fake.enabled.get(tenantId) ?? ["order_capture"], limits: { platform: {}, modules: fake.limits.get(tenantId) ?? {} }, renews_on: null });
    }
    if (url === "/.well-known/jwks.json") return send(res, 200, jwks);
    if (url === "/api/sso/support-exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (url === "/api/sso/exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (/^\/api\/m\/tenants\/[^/]+\/users\/[^/]+\/status$/.test(url)) return typeof fake.status === "number" ? send(res, fake.status, {}) : send(res, 200, fake.status);
    if (/^\/api\/m\/tenants\/[^/]+\/skus$/.test(url)) return fake.skus ? send(res, 200, fake.skus) : send(res, 503, {});
    if (/^\/api\/m\/tenants\/[^/]+\/alert-contacts$/.test(url)) return fake.contacts ? send(res, 200, fake.contacts) : send(res, 503, {});
    const brand = /^\/api\/m\/tenants\/([^/]+)\/branding$/.exec(url);
    if (brand) return send(res, 200, { tenant_id: TENANT, name: "Sample Aqua", brand_color: "#0e7490", logo_url: null, ...fake.branding.get(brand[1]!) });
    send(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const sign = (claims: Record<string, unknown>, aud: ModuleId = "order_capture", ttl = "15m") =>
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
    loginToken: (roles: RoleId[] = ["order_desk"]) => sign({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["order_capture"] }),
    supportToken: (superAdminId = randomUUID()) => sign({ purpose: "support", tenant_id: TENANT, super_admin_id: superAdminId, read_only: true }),
    summaryToken: (aud: ModuleId = "order_capture", tenantId = TENANT) => sign({ purpose: "summary", tenant_id: tenantId, view: "owner" }, aud, "60s"),
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

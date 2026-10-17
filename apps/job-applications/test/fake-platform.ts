// A stand-in for the PlantOps platform: publishes a throwaway public key, answers the code exchange, the
// 5-minute user re-check, branding and alert contacts. Tests change its answers; it signs tokens like the real platform.
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { AlertContact, ModuleId, RoleId, UserStatus } from "@plantops/types";

export const TENANT = randomUUID();
export const USER = randomUUID();
/** The people the platform lists for Job applications: two owners (one without email) and an HR desk. */
export const OWNER_ID = randomUUID();
export const NOMAIL_OWNER_ID = randomUUID();
export const KEEPER_ID = randomUUID();
export const CONTACTS: AlertContact[] = [
  { user_id: OWNER_ID, display_name: "Sujata", phone: null, email: "sujata@plant.example", roles: ["tenant_admin"] },
  { user_id: NOMAIL_OWNER_ID, display_name: "Ravi", phone: null, email: null, roles: ["hr_desk", "tenant_admin"] },
  { user_id: KEEPER_ID, display_name: "Atharv", phone: null, email: "atharv@plant.example", roles: ["hr_desk"] },
];


export interface FakePlatform {
  url: string;
  /** what POST /api/sso/exchange returns (empty = 400) */
  nextToken: string;
  /** what the status re-check returns (a number = that HTTP error) */
  status: UserStatus | number;
  /** what GET alert-contacts returns (null = platform error) */
  contacts: AlertContact[] | null;
  /** every notification the module sent (POST /api/m/tenants/:tid/notifications) */
  notifications: { tenantId: string; body: Record<string, unknown> }[];
  /** HTTP status for notifications (201 = taken) */
  notifyStatus: number;
  /** enabled modules per plant for GET /api/tenants/:id/plan (unknown plant = Job applications on) */
  enabled: Map<string, string[]>;
  /** module limits per plant for GET /api/tenants/:id/plan (e.g. { job_applications: { storage_mb: 1 } }) */
  limits: Map<string, Record<string, Record<string, number>>>;
  /** GET /api/m/plants/by-code/:code: code (upper case) -> plant; a code not listed = 404 (unknown / suspended / off) */
  plants: Map<string, { tenant_id: string; name: string }>;
  /** every plant code the module asked about */
  plantLookups: string[];
  /** the platform failing (5xx) for the plant lookup */
  plantLookupDown: boolean;
  /** branding per plant (the default: Sample Aqua, no logo) */
  branding: Map<string, { name: string; brand_color: string | null; logo: boolean; code: string }>;
  sign(claims: Record<string, unknown>, aud?: ModuleId, ttl?: string): Promise<string>;
  loginToken(roles?: RoleId[]): Promise<string>;
  summaryToken(aud?: ModuleId, tenantId?: string, view?: "owner" | "staff"): Promise<string>;
  supportToken(superAdminId?: string): Promise<string>;
  close(): Promise<void>;
}

export async function startFakePlatform(): Promise<FakePlatform> {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const kid = randomUUID();
  const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA" } as JWK] };
  const fake = {
    nextToken: "",
    status: { active: true, display_name: "Atharv", roles: ["hr_desk"], enabled_modules: ["job_applications"] } as UserStatus | number,
    contacts: CONTACTS as AlertContact[] | null,
    notifications: [] as { tenantId: string; body: Record<string, unknown> }[],
    notifyStatus: 201,
    enabled: new Map<string, string[]>(),
    limits: new Map<string, Record<string, Record<string, number>>>(),
    plants: new Map<string, { tenant_id: string; name: string }>(),
    plantLookups: [] as string[],
    plantLookupDown: false,
    branding: new Map<string, { name: string; brand_color: string | null; logo: boolean; code: string }>(),
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
      return send(res, 200, { tenant_id: tenantId, plan_name: "Growth", enabled_modules: fake.enabled.get(tenantId) ?? ["job_applications"], limits: { platform: {}, modules: fake.limits.get(tenantId) ?? {} }, renews_on: null });
    }
    if (url === "/.well-known/jwks.json") return send(res, 200, jwks);
    if (url === "/api/sso/support-exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (url === "/api/sso/exchange") return fake.nextToken ? send(res, 200, { token: fake.nextToken }) : send(res, 400, { error: "bad code" });
    if (/^\/api\/m\/tenants\/[^/]+\/users\/[^/]+\/status$/.test(url)) return typeof fake.status === "number" ? send(res, fake.status, {}) : send(res, 200, fake.status);
    if (/^\/api\/m\/tenants\/[^/]+\/alert-contacts$/.test(url)) return fake.contacts ? send(res, 200, fake.contacts) : send(res, 503, {});
    const byCode = /^\/api\/m\/plants\/by-code\/([^/]+)$/.exec(url);
    if (byCode) {
      const code = decodeURIComponent(byCode[1]!);
      fake.plantLookups.push(code);
      if (fake.plantLookupDown) return send(res, 503, {});
      const plant = fake.plants.get(code);
      return plant ? send(res, 200, plant) : send(res, 404, { error: "This page is not available" });
    }
    const branding = /^\/api\/m\/tenants\/([^/]+)\/branding$/.exec(url);
    if (branding) {
      const tenantId = branding[1]!;
      const b = fake.branding.get(tenantId) ?? { name: "Sample Aqua", brand_color: "#0e7490", logo: false, code: "002" };
      return send(res, 200, { tenant_id: tenantId, name: b.name, brand_color: b.brand_color, logo_url: b.logo ? `/api/m/tenants/${tenantId}/logo?v=1` : null, code: b.code });
    }
    if (/^\/api\/m\/tenants\/[^/]+\/logo/.test(url)) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.from("89504e470d0a1a0a", "hex"));
    }
    send(res, 404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const sign = (claims: Record<string, unknown>, aud: ModuleId = "job_applications", ttl = "15m") =>
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
    loginToken: (roles: RoleId[] = ["hr_desk"]) => sign({ tenant_id: TENANT, user_id: USER, roles, enabled_modules: ["job_applications"] }),
    supportToken: (superAdminId = randomUUID()) => sign({ purpose: "support", tenant_id: TENANT, super_admin_id: superAdminId, read_only: true }),
    summaryToken: (aud: ModuleId = "job_applications", tenantId = TENANT, view: "owner" | "staff" = "owner") => sign({ purpose: "summary", tenant_id: tenantId, view }, aud, "60s"),
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

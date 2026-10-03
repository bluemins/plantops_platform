import { AlertContact, TenantBranding, TenantPlan, TenantSku, UserStatus, type ModuleId } from "@plantops/types";

/** How a module app identifies itself to the platform (server-to-server only, never from the browser). */
export interface ModuleCredentials {
  platformUrl: string;
  moduleId: ModuleId;
  clientSecret: string;
}

function authHeader(c: ModuleCredentials) {
  return "Basic " + btoa(`${c.moduleId}:${c.clientSecret}`);
}

/** The platform answered with an error status (as opposed to being unreachable). */
export class PlatformRequestError extends Error {
  constructor(
    public status: number,
    path: string,
  ) {
    super(`Platform ${path} failed: ${status}`);
    this.name = "PlatformRequestError";
  }
}

async function call(c: ModuleCredentials, path: string, init?: RequestInit) {
  const res = await fetch(new URL(path, c.platformUrl), {
    ...init,
    headers: { authorization: authHeader(c), "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new PlatformRequestError(res.status, path);
  return res.json();
}

/** Step 2 of the handoff: swap the one-time code from the callback URL for a signed SSO token. */
export async function exchangeCode(c: ModuleCredentials, code: string): Promise<string> {
  const body = await call(c, "/api/sso/exchange", { method: "POST", body: JSON.stringify({ code }) });
  return body.token as string;
}

/** Support view: swap super_admin's one-time code for a read-only support token. */
export async function exchangeSupportCode(c: ModuleCredentials, code: string): Promise<string> {
  const body = await call(c, "/api/sso/support-exchange", { method: "POST", body: JSON.stringify({ code }) });
  return body.token as string;
}

/** Re-check (every few minutes) that the user is still active and still has the same roles. */
export async function fetchUserStatus(c: ModuleCredentials, tenantId: string, userId: string) {
  return UserStatus.parse(await call(c, `/api/m/tenants/${tenantId}/users/${userId}/status`));
}

/** The tenant's plan (enabled modules + limits). Cache briefly in the module. */
export async function fetchTenantPlan(c: ModuleCredentials, tenantId: string) {
  return TenantPlan.parse(await call(c, `/api/tenants/${tenantId}/plan`));
}

/** Plant name, brand colour and logo path, so the module looks like the plant's other screens. Cache briefly. */
export async function fetchBranding(c: ModuleCredentials, tenantId: string) {
  return TenantBranding.parse(await call(c, `/api/m/tenants/${tenantId}/branding`));
}

/** Owners + this module's staff with phone numbers, for alerts (e.g. WhatsApp on a failed test). */
export async function fetchAlertContacts(c: ModuleCredentials, tenantId: string) {
  return AlertContact.array().parse(await call(c, `/api/m/tenants/${tenantId}/alert-contacts`));
}

/** The plant's products (active and inactive). Store sku_id as a plain reference; cache briefly. */
export async function fetchSkus(c: ModuleCredentials, tenantId: string) {
  return TenantSku.array().parse(await call(c, `/api/m/tenants/${tenantId}/skus`));
}

/** The plant's logo image (logo_url from fetchBranding). Returns null if the plant has none. */
export async function fetchLogo(c: ModuleCredentials, logoUrl: string): Promise<{ type: string; data: ArrayBuffer } | null> {
  const res = await fetch(new URL(logoUrl, c.platformUrl), { headers: { authorization: authHeader(c) } });
  if (res.status === 404) return null;
  if (!res.ok) throw new PlatformRequestError(res.status, logoUrl);
  return { type: res.headers.get("content-type") ?? "application/octet-stream", data: await res.arrayBuffer() };
}

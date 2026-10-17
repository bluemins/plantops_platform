import { AlertContact, NotificationInput, NotificationResult, PublicPlant, TenantBranding, TenantPlan, TenantSku, UserStatus, type ModuleId } from "@plantops/types";

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

/**
 * Job applications' public page: the plant behind a plant code (only an active plant with the module switched on).
 * null = no such plant for this page (the platform gives one 404 for every reason). Throws if the platform can't say.
 */
export async function fetchPlantByCode(c: ModuleCredentials, code: string): Promise<PublicPlant | null> {
  try {
    return PublicPlant.parse(await call(c, `/api/m/plants/by-code/${encodeURIComponent(code)}`));
  } catch (err) {
    if (err instanceof PlatformRequestError && err.status === 404) return null;
    throw err;
  }
}

/** Owners + this module's staff with phone numbers, for alerts (e.g. WhatsApp on a failed test). */
export async function fetchAlertContacts(c: ModuleCredentials, tenantId: string) {
  return AlertContact.array().parse(await call(c, `/api/m/tenants/${tenantId}/alert-contacts`));
}

/**
 * Reports an event to the platform's notification inbox (CLAUDE.md "Notifications"). The platform decides who
 * receives it; the same dedupe_key is stored once per person, so retrying is safe.
 */
export async function sendNotification(c: ModuleCredentials, tenantId: string, input: NotificationInput) {
  const body = NotificationInput.parse(input);
  return NotificationResult.parse(
    await call(c, `/api/m/tenants/${tenantId}/notifications`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) }),
  );
}

/** How many unread notifications this person has (for the bell in a module's header). */
export async function fetchUnread(c: ModuleCredentials, tenantId: string, userId: string): Promise<number> {
  const body = (await call(c, `/api/m/tenants/${tenantId}/users/${userId}/notifications/unread`)) as { unread?: unknown };
  return typeof body.unread === "number" ? body.unread : 0;
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

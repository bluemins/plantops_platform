import { TenantPlan, UserStatus, type ModuleId } from "@plantops/types";

/** How a module app identifies itself to the platform (server-to-server only, never from the browser). */
export interface ModuleCredentials {
  platformUrl: string;
  moduleId: ModuleId;
  clientSecret: string;
}

function authHeader(c: ModuleCredentials) {
  return "Basic " + btoa(`${c.moduleId}:${c.clientSecret}`);
}

async function call(c: ModuleCredentials, path: string, init?: RequestInit) {
  const res = await fetch(new URL(path, c.platformUrl), {
    ...init,
    headers: { authorization: authHeader(c), "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Platform ${path} failed: ${res.status}`);
  return res.json();
}

/** Step 2 of the handoff: swap the one-time code from the callback URL for a signed SSO token. */
export async function exchangeCode(c: ModuleCredentials, code: string): Promise<string> {
  const body = await call(c, "/api/sso/exchange", { method: "POST", body: JSON.stringify({ code }) });
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

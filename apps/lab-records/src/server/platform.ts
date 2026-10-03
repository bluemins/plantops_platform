// How this module talks to the platform: its credentials, the platform's public keys, and a short cache for
// the plant's branding (name, colour, logo). Nothing here can mint tokens.
import { fetchBranding, fetchSkus, type KeySource, type ModuleCredentials } from "@plantops/auth";
import type { TenantBranding, TenantSku } from "@plantops/types";
import { env } from "./env";

export const MODULE_ID = "lab_records" as const;
export const MODULE_LABEL = "Lab Records";

export const creds = (): ModuleCredentials => ({ platformUrl: env.platformUrl, moduleId: MODULE_ID, clientSecret: env.clientSecret });
export const keys = (): KeySource => ({ jwksUrl: new URL("/.well-known/jwks.json", env.platformUrl).toString() });

/** The platform's "Account / PlantOps home" screen (launcher), always reachable from the module. */
export const accountUrl = () => new URL("/home?launcher=1", env.platformUrl).toString();

/** Platform login that returns the user here with a one-time code (CLAUDE.md flow step 6). */
export const platformLoginUrl = (next: string) =>
  new URL(`/sso/start?module=${MODULE_ID}&next=${encodeURIComponent(next)}`, env.platformUrl).toString();

const g = globalThis as unknown as {
  __labBranding?: Map<string, { at: number; value: TenantBranding }>;
  __labSkus?: Map<string, { at: number; value: TenantSku[] }>;
};
const BRANDING_TTL_MS = 60_000;

/** The plant's look, cached for a minute. Never breaks a page: null means default PlantOps colours. */
export async function branding(tenantId: string): Promise<TenantBranding | null> {
  const cache = (g.__labBranding ??= new Map());
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < BRANDING_TTL_MS) return hit.value;
  const value = await fetchBranding(creds(), tenantId).catch(() => null);
  if (value) cache.set(tenantId, { at: Date.now(), value });
  return value ?? hit?.value ?? null;
}

/** The plant's products (platform Business details), cached for a minute. Empty if the platform is unreachable. */
export async function products(tenantId: string): Promise<TenantSku[]> {
  const cache = (g.__labSkus ??= new Map());
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < BRANDING_TTL_MS) return hit.value;
  const value = await fetchSkus(creds(), tenantId).catch(() => null);
  if (value) cache.set(tenantId, { at: Date.now(), value });
  return value ?? hit?.value ?? [];
}

/** "500 ml × 24 (case)" - how a product is named on screens and records. */
export function productLabel(s: TenantSku) {
  const size = s.volume_ml >= 1000 ? `${s.volume_ml / 1000} L` : `${s.volume_ml} ml`;
  return s.units_per_pack > 1 ? `${s.name} (${size} × ${s.units_per_pack})` : `${s.name} (${size})`;
}

// Live tile numbers ("3 held today"): the platform asks the module directly each time a launcher opens.
// Never stored (CLAUDE.md: owner tiles show the same data staff enter, never a copy).
import { eq } from "drizzle-orm";
import { canAccessModule } from "@plantops/auth";
import { MODULE_SUMMARY_PATH, ModuleSummary, SUMMARY_TOKEN_SECONDS, type ModuleId, type SummaryView } from "@plantops/types";
import type { CurrentUser } from "./auth";
import { appDb, schema, superDb, withTenant } from "./db";
import { forbidden } from "./http";
import { enabledModules, signPlatformToken } from "./sso";

export const SUMMARY_TIMEOUT_MS = 3000;

export type TileSummary = ({ state: "ok" } & ModuleSummary) | { state: "unavailable" };
const unavailable: TileSummary = { state: "unavailable" };

/**
 * Asks one module for one plant's numbers. The request carries a 60-second platform-signed ticket
 * (purpose "summary", no user), so the module knows it is really the platform and for which plant.
 * Any problem (module off, down, slow, error, wrong answer) -> "unavailable"; the launcher keeps working.
 */
export async function fetchModuleSummary(moduleId: ModuleId, tenantId: string, view: SummaryView): Promise<TileSummary> {
  const [mod] = await appDb().select().from(schema.modules).where(eq(schema.modules.id, moduleId));
  if (!mod || mod.status !== "active" || !mod.baseUrl) return unavailable;
  try {
    const token = await signPlatformToken({ purpose: "summary", tenant_id: tenantId, view }, moduleId, SUMMARY_TOKEN_SECONDS);
    const res = await fetch(new URL(MODULE_SUMMARY_PATH, mod.baseUrl), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
    if (!res.ok) return unavailable;
    const parsed = ModuleSummary.safeParse(await res.json());
    return parsed.success ? { state: "ok", ...parsed.data } : unavailable;
  } catch {
    return unavailable;
  }
}

/** GET /api/launcher/summary/:module - only for a module this user may open. */
export async function summaryForUser(user: CurrentUser, moduleId: ModuleId) {
  const enabled = await withTenant(user.tenantId, (tx) => enabledModules(tx, user.tenantId));
  if (!canAccessModule(user.roles, enabled, moduleId)) throw forbidden("This module is not available for you");
  return fetchModuleSummary(moduleId, user.tenantId, user.roles.includes("tenant_admin") ? "owner" : "staff");
}

/** super_admin dashboard: the owner's numbers for any plant, for modules in that plant's plan. */
export async function summaryForSuper(tenantId: string, moduleId: ModuleId) {
  const enabled = await superDb().transaction((tx) => enabledModules(tx, tenantId));
  if (!enabled.includes(moduleId)) throw forbidden("This module is not in the plant's plan");
  return fetchModuleSummary(moduleId, tenantId, "owner");
}

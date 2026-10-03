// The launcher (tile screen): which module tiles a user sees, in which state, plus the owner's plan card.
// Tile hiding is only convenience - every module still checks access itself (CLAUDE.md flow step 5).
import { and, eq, sql } from "drizzle-orm";
import { canAccessModule } from "@plantops/auth";
import { MODULE_IDS, PlanLimits, type ModuleId, type RoleId } from "@plantops/types";
import type { CurrentUser } from "./auth";
import { appDb, schema, superDb, withTenant, type PlatformDb, type PlatformTx } from "./db";
import { enabledModules } from "./sso";
import { notFound } from "./http";

const { modules, tenants, tenantPlans, tenantProfiles, users } = schema;

/** Modules sold as an add-on service: their locked tile says so instead of "Not enabled". */
const ADDON_MODULES: readonly ModuleId[] = ["amc"];

export type TileState = "open" | "off" | "locked";
export interface Tile {
  module: ModuleId;
  /** open = can be opened; off = switched off by PlantOps or not set up yet; locked = not in the plant's plan */
  state: TileState;
  /** owner = read-only summary; staff = working module */
  view: "owner" | "staff";
  locked_reason?: "not_enabled" | "addon";
}

/** Module is usable when PlantOps has it switched on and it has a URL and a secret. */
export interface ModuleAvailability {
  id: string;
  status: string;
  baseUrl: string | null;
  clientSecretHash: string | null;
}
const isAvailable = (m: ModuleAvailability | undefined) => !!m && m.status === "active" && !!m.baseUrl && !!m.clientSecretHash;

/**
 * The tile rules (pure, so tests can cover every case):
 * - owner: every enabled module (open, or off if unavailable) + locked tiles for the rest
 * - staff: only modules their roles give them; never locked tiles
 */
export function decideTiles(roles: readonly RoleId[], enabled: readonly ModuleId[], available: readonly ModuleAvailability[]): Tile[] {
  const owner = roles.includes("tenant_admin");
  const view = owner ? "owner" : "staff";
  const tiles: Tile[] = [];
  for (const id of MODULE_IDS) {
    const usable = isAvailable(available.find((m) => m.id === id));
    if (canAccessModule(roles, enabled, id)) {
      tiles.push({ module: id, state: usable ? "open" : "off", view });
    } else if (owner) {
      tiles.push({ module: id, state: "locked", view, locked_reason: ADDON_MODULES.includes(id) ? "addon" : "not_enabled" });
    }
  }
  // open first, then off, then locked (mockup order: working tiles before locked ones)
  const rank: Record<TileState, number> = { open: 0, off: 1, locked: 2 };
  return tiles.sort((a, b) => rank[a.state] - rank[b.state]);
}

/** Staff who can open exactly one module skip the tile screen. Owners and multi-module staff see tiles. */
export function landingFor(roles: readonly RoleId[], tiles: readonly Tile[]): ModuleId | "launcher" {
  if (roles.includes("tenant_admin")) return "launcher";
  const open = tiles.filter((t) => t.state === "open");
  return open.length === 1 && tiles.length === 1 ? open[0]!.module : "launcher";
}

async function moduleAvailability(db: PlatformDb | PlatformTx): Promise<ModuleAvailability[]> {
  return db.select({ id: modules.id, status: modules.status, baseUrl: modules.baseUrl, clientSecretHash: modules.clientSecretHash }).from(modules);
}

/** Plant header + plan card, read inside one tenant (RLS on the app login, or the super login). */
async function plantInfo(tx: PlatformTx, tenantId: string, logoPath: string) {
  const [row] = await tx
    .select({
      name: tenants.name,
      code: tenants.code,
      brandColor: tenantProfiles.brandColor,
      logoUpdatedAt: tenantProfiles.logoUpdatedAt,
      planName: tenantPlans.planName,
      limits: tenantPlans.limits,
      renewsOn: tenantPlans.renewsOn,
    })
    .from(tenants)
    .leftJoin(tenantProfiles, eq(tenantProfiles.tenantId, tenants.id))
    .leftJoin(tenantPlans, eq(tenantPlans.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId));
  if (!row) throw notFound("Plant not found");
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active")));
  const enabled = await enabledModules(tx, tenantId);
  return {
    plant: {
      name: row.name,
      code: row.code,
      brand_color: row.brandColor,
      logo_url: row.logoUpdatedAt ? `${logoPath}?v=${row.logoUpdatedAt.getTime()}` : null,
    },
    enabled,
    plan_summary: {
      plan_name: row.planName,
      modules_enabled: enabled.length,
      modules_total: MODULE_IDS.length,
      users_active: count,
      max_users: PlanLimits.safeParse(row.limits ?? {}).data?.platform.max_users ?? null,
      renews_on: row.renewsOn,
    },
  };
}

/** GET /api/launcher: what the logged-in plant user sees. */
export async function buildLauncher(user: CurrentUser) {
  const available = await moduleAvailability(appDb());
  return withTenant(user.tenantId, async (tx) => {
    const info = await plantInfo(tx, user.tenantId, "/api/business/logo");
    const tiles = decideTiles(user.roles, info.enabled, available);
    const owner = user.roles.includes("tenant_admin");
    return {
      user: { display_name: user.displayName, roles: user.roles },
      plant: info.plant,
      tiles,
      plan_summary: owner ? info.plan_summary : null, // staff never see plan details
      landing: landingFor(user.roles, tiles),
    };
  });
}

/** super_admin dashboard: a plant's launcher exactly as its owner sees it (read-only for super_admin). */
export async function superLauncher(tenantId: string) {
  const db = superDb();
  const available = await moduleAvailability(db);
  return db.transaction(async (tx) => {
    const info = await plantInfo(tx, tenantId, `/api/super/tenants/${tenantId}/logo`);
    return { plant: info.plant, tiles: decideTiles(["tenant_admin"], info.enabled, available), plan_summary: info.plan_summary };
  });
}

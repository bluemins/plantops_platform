import { roleWorksIn, type ModuleId, type RoleId } from "@plantops/types";

export class AccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

/**
 * The single rule for "may this user open this module": the module is enabled for the tenant AND the user
 * is a tenant_admin or holds a staff role that works there (roleWorksIn). The platform checks it before handoff; every module
 * checks it again on its own server.
 */
export function canAccessModule(roles: readonly RoleId[], enabledModules: readonly ModuleId[], moduleId: ModuleId) {
  if (!enabledModules.includes(moduleId)) return false;
  if (roles.includes("tenant_admin")) return true;
  return roles.some((role) => roleWorksIn(role, moduleId));
}

export function requireModuleAccess(
  user: { roles: readonly RoleId[]; enabled_modules: readonly ModuleId[] },
  moduleId: ModuleId,
) {
  if (!canAccessModule(user.roles, user.enabled_modules, moduleId)) {
    throw new AccessDeniedError(`No access to module ${moduleId}`);
  }
}

/** Throws unless the user holds at least one of the given roles. */
export function requireRole(user: { roles: readonly RoleId[] }, ...allowed: RoleId[]) {
  if (!user.roles.some((role) => allowed.includes(role))) {
    throw new AccessDeniedError(`Requires one of: ${allowed.join(", ")}`);
  }
}

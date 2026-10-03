import { z } from "zod";

/** Every PlantOps module. Adding a module = add it here + a row in platform.modules (seed). */
export const MODULE_IDS = [
  "lab_records",
  "floor_stock",
  "preventive_mgmt",
  "amc",
  "attendance_salary",
  "marketing_contacts",
] as const;
export const ModuleId = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleId>;

/** Roles a plant user can hold. A user may hold several. */
export const ROLE_IDS = ["tenant_admin", "lab_technician", "store_keeper", "maintenance_technician"] as const;
export const RoleId = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleId>;

/** The working module each staff role operates. tenant_admin is not tied to one module. */
export const ROLE_MODULE: Record<Exclude<RoleId, "tenant_admin">, ModuleId> = {
  lab_technician: "lab_records",
  store_keeper: "floor_stock",
  maintenance_technician: "preventive_mgmt",
};

/** Plan limits JSON stored in tenant_plans.limits. A missing limit means "no limit". */
const LimitValues = z.record(z.string(), z.number().int().nonnegative());
export const PlanLimits = z.object({
  platform: z.object({ max_users: z.number().int().positive().optional() }).catchall(z.number()).default({}),
  modules: z.partialRecord(ModuleId, LimitValues).default({}),
});
export type PlanLimits = z.infer<typeof PlanLimits>;

export const TenantPlan = z.object({
  tenant_id: z.uuid(),
  plan_name: z.string().min(1),
  enabled_modules: z.array(ModuleId),
  limits: PlanLimits,
  renews_on: z.string().nullable(),
});
export type TenantPlan = z.infer<typeof TenantPlan>;

export const TOKEN_ISSUER = "plantops-platform";

/** SSO token payload. Contents are fixed by CLAUDE.md - ask before changing. Never put limits in here. */
export const TokenPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  tenant_id: z.uuid(),
  user_id: z.uuid(),
  roles: z.array(RoleId),
  enabled_modules: z.array(ModuleId),
});
export type TokenPayload = z.infer<typeof TokenPayload>;

/** Response of GET /api/m/tenants/:tid/users/:uid/status (module re-check every few minutes). */
export const UserStatus = z.object({
  active: z.boolean(),
  roles: z.array(RoleId),
  enabled_modules: z.array(ModuleId),
});
export type UserStatus = z.infer<typeof UserStatus>;

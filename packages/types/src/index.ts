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
export const ROLE_IDS = ["tenant_admin", "lab_technician", "lab_lead", "store_keeper", "maintenance_technician"] as const;
export const RoleId = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleId>;

/** The working module each staff role operates. tenant_admin is not tied to one module. */
export const ROLE_MODULE: Record<Exclude<RoleId, "tenant_admin">, ModuleId> = {
  lab_technician: "lab_records",
  /** a lab technician who can also approve batches, release holds, verify entries and set limits */
  lab_lead: "lab_records",
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
  /** shown as "Sign" / "Verified By" in module records; optional so a module keeps working with an older platform */
  display_name: z.string().optional(),
  roles: z.array(RoleId),
  enabled_modules: z.array(ModuleId),
});
export type UserStatus = z.infer<typeof UserStatus>;

// ---------- launcher tile numbers (CLAUDE.md "Launcher tiles") ----------

/**
 * Summary request token: the platform asks a module for a plant's tile numbers. Signed with the same key as
 * the SSO token but a different purpose and no user - it can never be used as a login.
 */
export const SUMMARY_TOKEN_SECONDS = 60;
export const SummaryView = z.enum(["owner", "staff"]);
export type SummaryView = z.infer<typeof SummaryView>;
export const SummaryRequestPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  purpose: z.literal("summary"),
  tenant_id: z.uuid(),
  view: SummaryView,
});
export type SummaryRequestPayload = z.infer<typeof SummaryRequestPayload>;

/** What a module answers at GET <base_url>/api/plantops/summary. */
export const BadgeTone = z.enum(["ok", "info", "warn", "danger"]);
export const ModuleSummary = z.object({
  badges: z.array(z.object({ text: z.string().trim().min(1).max(40), tone: BadgeTone })).max(3),
});
export type ModuleSummary = z.infer<typeof ModuleSummary>;
export const MODULE_SUMMARY_PATH = "/api/plantops/summary";

/** GET /api/m/tenants/:tid/branding - what a module needs to show the plant's look. */
export const TenantBranding = z.object({
  tenant_id: z.uuid(),
  name: z.string(),
  brand_color: z.string().nullable(),
  /** platform path; fetch it with module credentials */
  logo_url: z.string().nullable(),
});
export type TenantBranding = z.infer<typeof TenantBranding>;

/**
 * GET /api/m/tenants/:tid/alert-contacts - active owners plus users holding one of the calling module's
 * roles, for alerts (e.g. WhatsApp on a failed lab test). The module picks whom to alert.
 */
export const AlertContact = z.object({
  user_id: z.uuid(),
  display_name: z.string(),
  phone: z.string().nullable(),
  roles: z.array(RoleId),
});
export type AlertContact = z.infer<typeof AlertContact>;

/** GET /api/m/tenants/:tid/skus - the plant's products. Modules store sku_id as a plain reference. */
export const TenantSku = z.object({
  id: z.uuid(),
  name: z.string(),
  sku_code: z.string().nullable(),
  /** size of ONE bottle/jar */
  volume_ml: z.number().int(),
  /** 1 = single unit; e.g. 24 for a case of 24 */
  units_per_pack: z.number().int(),
  pack_type: z.string(),
  status: z.enum(["active", "inactive"]),
});
export type TenantSku = z.infer<typeof TenantSku>;

// ---------- support view (CLAUDE.md "Support token") ----------

/**
 * super_admin opens one plant's module data READ-ONLY. Same signing key as the SSO token, but a `purpose`
 * and no user/roles, so it can never be used as a login. Modules accept it only via verifySupportToken,
 * refuse every write with it and log each view where the plant owner can see it.
 */
export const SUPPORT_TOKEN_SECONDS = 15 * 60;
export const SupportTokenPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  purpose: z.literal("support"),
  tenant_id: z.uuid(),
  super_admin_id: z.uuid(),
  read_only: z.literal(true),
});
export type SupportTokenPayload = z.infer<typeof SupportTokenPayload>;

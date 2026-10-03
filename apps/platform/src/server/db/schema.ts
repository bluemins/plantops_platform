// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { sql } from "drizzle-orm";
import { bigint, boolean, customType, date, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const platform = pgSchema("platform");
const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const modules = platform.table("modules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  clientSecretHash: text("client_secret_hash"),
  status: text("status").notNull(),
});

export const roles = platform.table("roles", {
  id: text("id").primaryKey(),
  moduleId: text("module_id"),
  label: text("label").notNull(),
});

export const superAdmins = platform.table("super_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  disabledAt: ts("disabled_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const superAdminSessions = platform.table("super_admin_sessions", {
  idHash: text("id_hash").primaryKey(),
  superAdminId: uuid("super_admin_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tenants = platform.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  hosting: text("hosting").notNull().default("shared"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const tenantPlans = platform.table("tenant_plans", {
  tenantId: uuid("tenant_id").primaryKey(),
  planName: text("plan_name").notNull(),
  enabledModules: text("enabled_modules").array().notNull().default(sql`'{}'`),
  limits: jsonb("limits").notNull().default({}),
  renewsOn: date("renews_on"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});

export const tenantProfiles = platform.table("tenant_profiles", {
  tenantId: uuid("tenant_id").primaryKey(),
  logo: bytea("logo"),
  logoType: text("logo_type"),
  logoUpdatedAt: ts("logo_updated_at"),
  brandColor: text("brand_color"),
  description: text("description"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  pincode: text("pincode"),
  phone: text("phone"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});

export const tenantSkus = platform.table("tenant_skus", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  skuCode: text("sku_code"),
  volumeMl: integer("volume_ml").notNull(),
  unitsPerPack: integer("units_per_pack").notNull().default(1),
  packType: text("pack_type").notNull(),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = platform.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  secretHash: text("secret_hash").notNull(),
  secretKind: text("secret_kind").$type<"pin" | "password">().notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  mustChangeSecret: boolean("must_change_secret").notNull().default(true),
  status: text("status").$type<"active" | "disabled">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
});

export const userRoles = platform.table(
  "user_roles",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    roleId: text("role_id").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    grantedBy: text("granted_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = platform.table("sessions", {
  idHash: text("id_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const ssoHandoffCodes = platform.table("sso_handoff_codes", {
  codeHash: text("code_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  moduleId: text("module_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLog = platform.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

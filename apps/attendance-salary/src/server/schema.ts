// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
// Plant coordinates are numeric in the database and strings here ("20.296100"). A scan has no coordinates at all.
import { bigint, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const at = pgSchema("attendance_salary");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type PunchKind = "in" | "out";
export type PunchSource = "scan" | "owner";

export const plantSettings = at.table("plant_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  radiusM: integer("radius_m").notNull().default(200),
  qrKeyHash: text("qr_key_hash"),
  qrMadeAt: ts("qr_made_at"),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const punches = at.table("punches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  kind: text("kind").$type<PunchKind>().notNull(),
  at: ts("at").notNull(),
  source: text("source").$type<PunchSource>().notNull(),
  distanceM: integer("distance_m"),
  accuracyM: integer("accuracy_m"),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const punchCancels = at.table("punch_cancels", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  punchId: uuid("punch_id").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const supportViews = at.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = at.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

export const notificationOutbox = at.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  givenUpAt: ts("given_up_at"),
});

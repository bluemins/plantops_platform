// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Measure } from "@/lib/recipe";

export const stock = pgSchema("floor_stock");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type SectionKind = "finished" | "stock";
export type OnOff = "active" | "off";
export type LineKind = "production" | "stock";
export type AlertStatus = "pending" | "sent" | "failed" | "skipped";

export const sections = stock.table("sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<SectionKind>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").$type<OnOff>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const items = stock.table("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sectionId: uuid("section_id").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  secondUnit: text("second_unit"),
  skuId: uuid("sku_id"),
  minLevel: numeric("min_level", { precision: 12, scale: 2 }),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").$type<OnOff>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const counts = stock.table("counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  countDate: date("count_date").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const countVersions = stock.table("count_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  countId: uuid("count_id").notNull(),
  version: integer("version").notNull(),
  reason: text("reason"),
  enteredBy: uuid("entered_by").notNull(),
  enteredByName: text("entered_by_name").notNull(),
  enteredAt: ts("entered_at").notNull().defaultNow(),
});

export const countLines = stock.table("count_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  itemId: uuid("item_id").notNull(),
  kind: text("kind").$type<LineKind>().notNull(),
  lineNo: smallint("line_no").notNull(),
  itemName: text("item_name").notNull(),
  unit: text("unit").notNull(),
  secondUnit: text("second_unit"),
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  secondQty: numeric("second_qty", { precision: 12, scale: 2 }),
  remark: text("remark"),
});

export const lowStockAlerts = stock.table("low_stock_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  countDate: date("count_date").notNull(),
  itemId: uuid("item_id").notNull(),
  itemName: text("item_name").notNull(),
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  minLevel: numeric("min_level", { precision: 12, scale: 2 }).notNull(),
  recipientUserId: uuid("recipient_user_id").notNull(),
  recipientName: text("recipient_name").notNull(),
  email: text("email"),
  status: text("status").$type<AlertStatus>().notNull().default("pending"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

export const supportViews = stock.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = stock.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

/** App notifications that couldn't reach the platform, waiting to be sent again (N4; no DELETE grant). */
export const notificationOutbox = stock.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  givenUpAt: ts("given_up_at"),
});

/** The owner's choice of the evening "count not done" reminder hour ('17:00'..'23:00' or 'off'; no row = 20:00). */
export const plantSettings = stock.table("plant_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  countReminder: text("count_reminder").notNull().default("20:00"),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------- "Can make" (migration 0004): what 1 unit of a material holds, and what 1 bottle of a product needs ----------
/** One row per stock item that has its contents set (no row = its unit is single pieces). */
export const materialContents = stock.table("material_contents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  contentQty: numeric("content_qty", { precision: 12, scale: 2 }).notNull(),
  contentMeasure: text("content_measure").$type<Measure>().notNull(),
  secondIsPieces: boolean("second_is_pieces").notNull().default(false),
  damagePct: numeric("damage_pct", { precision: 6, scale: 4 }).notNull().default("0"),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** One recipe per finished product. case_size only for an item without a linked product. */
export const recipes = stock.table("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productItemId: uuid("product_item_id").notNull(),
  caseSize: integer("case_size"),
  status: text("status").$type<OnOff>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** What 1 bottle needs of one material (switched off, never deleted). */
export const recipeLines = stock.table("recipe_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  recipeId: uuid("recipe_id").notNull(),
  materialItemId: uuid("material_item_id").notNull(),
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  measure: text("measure").$type<Measure>().notNull(),
  status: text("status").$type<OnOff>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

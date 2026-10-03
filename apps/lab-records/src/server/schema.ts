// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const lab = pgSchema("lab_records");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type ParameterKind = "daily" | "form1";
export type BatchStatus = "pending" | "on_hold" | "approved" | "rejected";
export type EntryForm = "daily" | "form1" | "form2" | "form3" | "form4";
import type { Verdict } from "@/lib/verdict";
export type { Verdict };

export const parameters = lab.table("parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").$type<ParameterKind>().notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  unit: text("unit"),
  limitMin: numeric("limit_min"),
  limitMax: numeric("limit_max"),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});

export const batches = lab.table("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  batchNo: text("batch_no").notNull(),
  productionDate: date("production_date").notNull(),
  skuId: uuid("sku_id"),
  productName: text("product_name"),
  status: text("status").$type<BatchStatus>().notNull().default("pending"),
  heldSince: ts("held_since"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const batchEvents = lab.table("batch_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  event: text("event").$type<"created" | "held" | "released" | "approved" | "rejected">().notNull(),
  byUser: uuid("by_user"),
  byName: text("by_name").notNull(),
  note: text("note"),
  entryId: uuid("entry_id"),
  at: ts("at").notNull().defaultNow(),
});

export const entries = lab.table("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  form: text("form").$type<EntryForm>().notNull(),
  batchId: uuid("batch_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const entryVersions = lab.table("entry_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  version: integer("version").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  reason: text("reason"),
  verdict: text("verdict").$type<Verdict>().notNull(),
  testedAt: ts("tested_at").notNull(),
  enteredBy: uuid("entered_by").notNull(),
  enteredByName: text("entered_by_name").notNull(),
  enteredAt: ts("entered_at").notNull().defaultNow(),
});

export const entryResults = lab.table("entry_results", {
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  parameterId: uuid("parameter_id").notNull(),
  parameterName: text("parameter_name").notNull(),
  unit: text("unit"),
  value: numeric("value").notNull(),
  limitMin: numeric("limit_min"),
  limitMax: numeric("limit_max"),
  verdict: text("verdict").$type<Verdict>().notNull(),
});

export const verifications = lab.table("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  versionId: uuid("version_id").notNull(),
  verifiedBy: uuid("verified_by").notNull(),
  verifiedByName: text("verified_by_name").notNull(),
  verifiedAt: ts("verified_at").notNull().defaultNow(),
});

export const correctiveActions = lab.table("corrective_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  entryId: uuid("entry_id"),
  note: text("note").notNull(),
  byUser: uuid("by_user").notNull(),
  byName: text("by_name").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const alerts = lab.table("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").notNull(),
  batchId: uuid("batch_id"),
  recipientName: text("recipient_name").notNull(),
  phone: text("phone"),
  message: text("message").notNull(),
  status: text("status").$type<"pending" | "sent" | "failed" | "skipped">().notNull().default("pending"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

export const supportViews = lab.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = lab.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

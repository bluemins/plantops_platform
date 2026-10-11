// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const cb = pgSchema("complaint_box");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type OnOff = "active" | "off";
export type ComplaintStatus = "open" | "in_progress" | "resolved";
export type EventKind = "in_progress" | "resolved" | "reopened" | "note";
export type FileKind = "photo" | "video";

export const items = cb.table("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  skuId: uuid("sku_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").$type<OnOff>().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const complaints = cb.table("complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  refNo: integer("ref_no").notNull(),
  customerName: text("customer_name").notNull(),
  phoneTyped: text("phone_typed").notNull(),
  phone: text("phone").notNull(),
  place: text("place").notNull(),
  itemId: uuid("item_id").notNull(),
  itemName: text("item_name").notNull(),
  batchText: text("batch_text"),
  description: text("description").notNull(),
  reportedBy: uuid("reported_by").notNull(),
  reportedByName: text("reported_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  status: text("status").$type<ComplaintStatus>().notNull().default("open"),
  statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
});

export const complaintEvents = cb.table("complaint_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id").notNull(),
  kind: text("kind").$type<EventKind>().notNull(),
  text: text("text"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const files = cb.table("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  complaintId: uuid("complaint_id").notNull(),
  eventId: uuid("event_id"),
  kind: text("kind").$type<FileKind>().notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
});

export const supportViews = cb.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = cb.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

export const notificationOutbox = cb.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  givenUpAt: ts("given_up_at"),
});

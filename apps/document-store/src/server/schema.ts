// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { bigint, date, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const docs = pgSchema("document_store");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type FileType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
export type VersionKind = "initial" | "renewal" | "correction";
export type ReminderStatus = "pending" | "sent" | "failed" | "skipped";

export const files = docs.table("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  storageKey: text("storage_key").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").$type<FileType>().notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
});

export const documents = docs.table("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  responsibleUserId: uuid("responsible_user_id").notNull(),
  responsibleName: text("responsible_name").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const documentVersions = docs.table("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  version: integer("version").notNull(),
  kind: text("kind").$type<VersionKind>().notNull(),
  name: text("name").notNull(),
  certificateNo: text("certificate_no"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),
  authority: text("authority"),
  supportContact: text("support_contact"),
  fileId: uuid("file_id").notNull(),
  remark: text("remark"),
  reason: text("reason"),
  enteredBy: uuid("entered_by").notNull(),
  enteredByName: text("entered_by_name").notNull(),
  enteredAt: ts("entered_at").notNull().defaultNow(),
});

export const reminders = docs.table("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  versionId: uuid("version_id").notNull(),
  stage: text("stage").notNull(),
  recipientUserId: uuid("recipient_user_id").notNull(),
  recipientName: text("recipient_name").notNull(),
  email: text("email"),
  status: text("status").$type<ReminderStatus>().notNull().default("pending"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

export const supportViews = docs.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = docs.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

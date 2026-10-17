// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const ja = pgSchema("job_applications");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type OnOff = "active" | "off";
/** The public page's groups, in page order. */
export type OpeningGroup = "production" | "lab_quality" | "office_sales" | "delivery_security" | "other";
export type ApplicationStatus = "new" | "called" | "shortlisted" | "hired" | "not_suitable";
export type EventKind = "status" | "note" | "seen";
export type ResumeType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export const openings = ja.table("openings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title").notNull(),
  grp: text("grp").$type<OpeningGroup>().notNull(),
  tag: text("tag"),
  description: text("description").notNull(),
  minQualification: text("min_qualification").notNull(),
  goodToHave: text("good_to_have"),
  status: text("status").$type<OnOff>().notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const pageSettings = ja.table("page_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  message: text("message").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const applications = ja.table("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  refNo: integer("ref_no").notNull(),
  openingId: uuid("opening_id"),
  openingTitle: text("opening_title"),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  place: text("place").notNull(),
  consentVersion: text("consent_version").notNull(),
  consentAt: ts("consent_at").notNull(),
  requestKey: text("request_key").notNull(),
  status: text("status").$type<ApplicationStatus>().notNull().default("new"),
  statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
  seenAt: ts("seen_at"),
  seenBy: uuid("seen_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const applicationEvents = ja.table("application_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  kind: text("kind").$type<EventKind>().notNull(),
  fromStatus: text("from_status").$type<ApplicationStatus>(),
  toStatus: text("to_status").$type<ApplicationStatus>(),
  text: text("text"),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const applicationFiles = ja.table("application_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  pageNo: integer("page_no").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").$type<ResumeType>().notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Read-only for the app: filled and cleared by the database functions (removal of applications). */
export const fileRemovals = ja.table("file_removals", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  storageKey: text("storage_key").notNull(),
  queuedAt: ts("queued_at").notNull().defaultNow(),
});

export const supportViews = ja.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = ja.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

export const notificationOutbox = ja.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  givenUpAt: ts("given_up_at"),
});

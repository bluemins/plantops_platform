// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
// Money and rates are numeric in the database and strings here ("140.00"), so no paisa is lost to rounding.
import { bigint, boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const oc = pgSchema("order_capture");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type OrderStatus = "pending" | "delivered" | "cancelled";
export type EventKind = "created" | "changed" | "delivered" | "undelivered" | "cancelled";

export const productRates = oc.table("product_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  unit: text("unit").notNull(),
  defaultRate: numeric("default_rate", { precision: 10, scale: 2 }),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const customers = oc.table("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  phoneTyped: text("phone_typed").notNull(),
  phone: text("phone").notNull(),
  place: text("place").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orders = oc.table("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  refNo: integer("ref_no").notNull(),
  requestKey: text("request_key").notNull(),
  customerId: uuid("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerPlace: text("customer_place").notNull(),
  orderNote: text("order_note"),
  status: text("status").$type<OrderStatus>().notNull().default("pending"),
  version: integer("version").notNull().default(1),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  enteredBy: uuid("entered_by").notNull(),
  enteredByName: text("entered_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
  deliveredBy: uuid("delivered_by"),
  deliveredByName: text("delivered_by_name"),
  deliveredAt: ts("delivered_at"),
  deliveryNote: text("delivery_note"),
  invoiceNo: text("invoice_no"),
});

export const orderLines = oc.table("order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  version: integer("version").notNull(),
  lineNo: integer("line_no").notNull(),
  skuId: uuid("sku_id").notNull(),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull(),
  quantity: integer("quantity").notNull(),
  rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

export const orderEvents = oc.table("order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  kind: text("kind").$type<EventKind>().notNull(),
  version: integer("version").notNull(),
  text: text("text"),
  invoiceNo: text("invoice_no"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const supportViews = oc.table("support_views", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  superAdminId: uuid("super_admin_id").notNull(),
  superAdminName: text("super_admin_name").notNull(),
  path: text("path").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const auditLog = oc.table("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  at: ts("at").notNull().defaultNow(),
});

export const notificationOutbox = oc.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  givenUpAt: ts("given_up_at"),
});

export type MessageStatus = "pending" | "sent" | "failed";

/** WhatsApp thank-you on "Delivered" (migration 0003): one per order, sent through Twilio. */
export const customerMessages = oc.table("customer_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  kind: text("kind").$type<"delivery_thanks">().notNull(),
  toPhone: text("to_phone").notNull(),
  status: text("status").$type<MessageStatus>().notNull().default("pending"),
  providerSid: text("provider_sid"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  requestedBy: uuid("requested_by").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
// Money and rates are numeric in the database and strings here ("140.00"), so no paisa is lost to rounding.
import type { BillTerms } from "@/lib/ledger";
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const oc = pgSchema("order_capture");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type OrderStatus = "pending" | "delivered" | "cancelled";
export type EventKind = "created" | "changed" | "delivered" | "undelivered" | "cancelled" | "note";

export const productRates = oc.table("product_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  unit: text("unit").notNull(),
  defaultRate: numeric("default_rate", { precision: 10, scale: 2 }),
  /** null = guessed from the product name; '' = no brand (0006) */
  brand: text("brand"),
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
  /** GSTIN and GST state code (migration 0009); saved with the first GST bill */
  gstin: text("gstin"),
  stateCode: text("state_code"),
  /** GST details (migration 0010): only GST bills and the Zoho file use them; the name above is the calling name */
  legalName: text("legal_name"),
  gstTreatment: text("gst_treatment").$type<GstTreatment>(),
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingPin: text("billing_pin"),
  email: text("email"),
  otherPhone: text("other_phone"),
  customerType: text("customer_type").$type<CustomerType>(),
  deliveryAddress: text("delivery_address"),
  deliveryLandmark: text("delivery_landmark"),
  paymentTerms: text("payment_terms").$type<BillTerms>(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const GST_TREATMENTS = ["registered", "unregistered", "consumer"] as const;
export type GstTreatment = (typeof GST_TREATMENTS)[number];
export const CUSTOMER_TYPES = ["shop", "household", "office", "institution", "individual"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Comments on a customer (migration 0010): owner writes, never changed. */
export const customerComments = oc.table("customer_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  body: text("body").notNull(),
  byUser: uuid("by_user").notNull(),
  byName: text("by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Contact persons (migration 0010): switched off, never deleted. */
export const customerPersons = oc.table("customer_persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  role: text("role"),
  active: boolean("active").notNull().default(true),
  byUser: uuid("by_user").notNull(),
  byName: text("by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Shop location (migration 0010): every save / clear is a row; the newest is the customer's location. */
export const customerLocations = oc.table("customer_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  kind: text("kind").$type<"set" | "clear">().notNull(),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  accuracyM: integer("accuracy_m"),
  source: text("source").$type<"phone" | "map_link" | "field_visit">(),
  reason: text("reason"),
  byUser: uuid("by_user").notNull(),
  byName: text("by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
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
  /** free boxes (scheme; migration 0011): line_total 0, rate = what they are worth */
  free: boolean("free").notNull().default(false),
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

export type MessageStatus = "pending" | "sent" | "failed" | "skipped";
export type MessageKind = "delivery_thanks" | "reorder_reminder";
export type SkipReason = "holdout" | "no_consent" | "newer_order" | "recent_reminder" | "customer_off" | "pilot_full" | "budget" | "pilot_ended";

/** WhatsApp thank-you on "Delivered" (migration 0003): one per order, sent through Twilio. */
export const customerMessages = oc.table("customer_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  kind: text("kind").$type<MessageKind>().notNull(),
  toPhone: text("to_phone").notNull(),
  status: text("status").$type<MessageStatus>().notNull().default("pending"),
  providerSid: text("provider_sid"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  requestedBy: uuid("requested_by").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  skipReason: text("skip_reason").$type<SkipReason>(),
});

export type ConsentStatus = "granted" | "declined" | "withdrawn";
export type ConsentSource = "bot_after_order" | "staff_phone" | "whatsapp_stop" | "whatsapp_start" | "reminder_button";

/** Consent to reorder reminders (migration 0005): append-only, a customer's consent = their newest row. */
export const customerConsents = oc.table("customer_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  scope: text("scope").$type<"reorder_reminder">().notNull(),
  status: text("status").$type<ConsentStatus>().notNull(),
  wording: text("wording").$type<"optin-v1">().notNull(),
  source: text("source").$type<ConsentSource>().notNull(),
  messageSid: text("message_sid"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The reminder pilot's groups (migration 0005): drawn once per customer, never changed. */
export const reminderGroups = oc.table("reminder_groups", {
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  grp: text("grp").$type<"remind" | "holdout">().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- phone calls (0007, docs/CALLS_PHASE_PLAN.md) ----------
export type CallEvent = "incoming" | "missed";

/** Every event the order phone sends; a ring = an incoming, or a missed without ring_id. */
export const callEvents = oc.table("call_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  keyId: uuid("key_id").notNull(),
  phone: text("phone").notNull(),
  event: text("event").$type<CallEvent>().notNull(),
  ringId: uuid("ring_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A number attended: covers its events with created_at <= upto. */
export const callAttended = oc.table("call_attended", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  phone: text("phone").notNull(),
  upto: ts("upto").notNull(),
  outcome: text("outcome").$type<"known" | "new_customer" | "wrong_number">().notNull(),
  customerId: uuid("customer_id"),
  attendedBy: uuid("attended_by").notNull(),
  attendedByName: text("attended_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** "Not an order number" list as a history: a number is listed when its newest row is 'add'. */
export const ignoredNumberChanges = oc.table("ignored_number_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  phone: text("phone").notNull(),
  action: text("action").$type<"add" | "remove">().notNull(),
  label: text("label"),
  changedBy: uuid("changed_by").notNull(),
  changedByName: text("changed_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- sales ledger (0008): bills, payments, allocations, adjustments, Zoho contacts + imports ----------
export type LedgerSource = "zoho" | "plantops";
/** a bill may also be an opening balance from another app's report (migration 0018: the 20 L pending report, OB20-…) */
export type BillSource = LedgerSource | "opening";
export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "other";
export type AdjustmentKind = "zoho_closed" | "write_off" | "discount";

export const zohoImports = oc.table("zoho_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  files: jsonb("files").notNull().default({}),
  counts: jsonb("counts").notNull().default({}),
  exportDate: date("export_date"),
  importedBy: uuid("imported_by").notNull(),
  importedByName: text("imported_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const zohoContacts = oc.table("zoho_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  zohoContactId: text("zoho_contact_id").notNull(),
  name: text("name").notNull(),
  company: text("company"),
  mobileTyped: text("mobile_typed"),
  mobile: text("mobile"),
  gstin: text("gstin"),
  zohoStatus: text("zoho_status"),
  customerId: uuid("customer_id"),
  importId: uuid("import_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

const cancelCols = {
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancelledByName: text("cancelled_by_name"),
  cancelReason: text("cancel_reason"),
};

export const bills = oc.table("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  source: text("source").$type<BillSource>().notNull(),
  number: text("number").notNull(),
  refNo: integer("ref_no"),
  zohoInvoiceId: text("zoho_invoice_id"),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date"),
  customerId: uuid("customer_id"),
  zohoContactId: uuid("zoho_contact_id"),
  customerName: text("customer_name").notNull(),
  orderId: uuid("order_id"),
  subTotal: numeric("sub_total", { precision: 18, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 18, scale: 2 }).notNull().default("0"),
  adjustment: numeric("adjustment", { precision: 18, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  notes: text("notes"),
  salesperson: text("salesperson"),
  zohoGstInvoiceNo: text("zoho_gst_invoice_no"),
  // migration 0009 (docs/BILL_FIELDS_PHASE_PLAN.md)
  terms: text("terms").$type<BillTerms>(),
  salespersonId: uuid("salesperson_id"),
  vehicle: text("vehicle"),
  referenceNo: text("reference_no"),
  privateNote: text("private_note"),
  needsGst: boolean("needs_gst").notNull().default(false),
  gstin: text("gstin"),
  placeOfSupply: text("place_of_supply"),
  /** GST bills only (migration 0010): who it was billed to on that day (legal name + address), never changed */
  billToName: text("bill_to_name"),
  billToAddress: text("bill_to_address"),
  gstTreatment: text("gst_treatment").$type<GstTreatment>(),
  taxInclusive: boolean("tax_inclusive"),
  cgst: numeric("cgst", { precision: 18, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 18, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 18, scale: 2 }).notNull().default("0"),
  sentToZohoAt: ts("sent_to_zoho_at"),
  sentToZohoBy: uuid("sent_to_zoho_by"),
  sentToZohoByName: text("sent_to_zoho_by_name"),
  zohoStatus: text("zoho_status"),
  zohoBalance: numeric("zoho_balance", { precision: 18, scale: 2 }),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ...cancelCols,
});

export const billLines = oc.table("bill_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  billId: uuid("bill_id").notNull(),
  lineNo: integer("line_no").notNull(),
  skuId: uuid("sku_id"),
  skuCode: text("sku_code"),
  itemName: text("item_name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unit: text("unit"),
  rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxName: text("tax_name"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  hsn: text("hsn"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
  /** the amount before GST (migration 0009); null on bills without GST */
  taxable: numeric("taxable", { precision: 18, scale: 2 }),
  /** a free line copied from the order (migration 0011): rate = worth, discount = the whole line, line_total 0 */
  free: boolean("free").notNull().default(false),
});

/** One row per plant (migration 0009); no row = rates include GST, due on receipt, no notes. */
export const billSettings = oc.table("bill_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  ratesIncludeGst: boolean("rates_include_gst").notNull().default(true),
  defaultTerms: text("default_terms").$type<BillTerms>().notNull().default("receipt"),
  defaultNotes: text("default_notes"),
  updatedBy: uuid("updated_by").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const payments = oc.table("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  source: text("source").$type<LedgerSource>().notNull(),
  number: text("number").notNull(),
  refNo: integer("ref_no"),
  zohoPaymentId: text("zoho_payment_id"),
  paymentDate: date("payment_date").notNull(),
  customerId: uuid("customer_id"),
  zohoContactId: uuid("zoho_contact_id"),
  customerName: text("customer_name").notNull(),
  mode: text("mode").$type<PaymentMode>().notNull(),
  reference: text("reference"),
  depositTo: text("deposit_to"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  note: text("note"),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ...cancelCols,
});

export const paymentAllocations = oc.table("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  billId: uuid("bill_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  allocatedOn: date("allocated_on").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const billAdjustments = oc.table("bill_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  billId: uuid("bill_id").notNull(),
  kind: text("kind").$type<AdjustmentKind>().notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  adjustedOn: date("adjusted_on").notNull(),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- Drop, the customer app (0012): switch + brands, extra phones, login codes, app sessions ----------
export type SessionEndReason = "logout" | "switched_off" | "phone_removed" | "customer_off";

export const appAccessChanges = oc.table("app_access_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  enabled: boolean("enabled").notNull(),
  brands: text("brands").array().notNull().default([]),
  changedBy: uuid("changed_by").notNull(),
  changedByName: text("changed_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appPhoneChanges = oc.table("app_phone_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  phone: text("phone").notNull(),
  action: text("action").$type<"add" | "remove">().notNull(),
  changedBy: uuid("changed_by").notNull(),
  changedByName: text("changed_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appLoginCodes = oc.table("app_login_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  phone: text("phone").notNull(),
  codeHmac: text("code_hmac").notNull(),
  expiresAt: ts("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appSessions = oc.table("app_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  phone: text("phone").notNull(),
  tokenSha256: text("token_sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  endReason: text("end_reason").$type<SessionEndReason>(),
});

// ---------- Drop points (0013): settings history, free boxes asked ----------
export type PointsReward = { sku_id: string; label: string; points: number };

export const pointsSettings = oc.table("points_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  startDate: date("start_date"),
  rupeesPerPoint: numeric("rupees_per_point", { precision: 8, scale: 2 }).notNull(),
  lateDays: integer("late_days").notNull(),
  pollPoints: integer("poll_points").notNull(),
  redeemMonths: integer("redeem_months").array().notNull(),
  rewards: jsonb("rewards").$type<PointsReward[]>().notNull(),
  changedBy: uuid("changed_by").notNull(),
  changedByName: text("changed_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const pointsRedemptions = oc.table("points_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  skuId: uuid("sku_id").notNull(),
  label: text("label").notNull(),
  points: integer("points").notNull(),
  yearEnd: date("year_end").notNull(),
  askedByPhone: text("asked_by_phone").notNull(),
  requestKey: text("request_key").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  orderId: uuid("order_id"),
  addedBy: uuid("added_by"),
  addedByName: text("added_by_name"),
  addedAt: ts("added_at"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancelledByName: text("cancelled_by_name"),
  cancelReason: text("cancel_reason"),
});

// ---------- Drop polls (0014): the owner's polls, the shops' answers ----------
export type PollReason = "counted" | "week_used" | "no_recent_order" | "points_off";

export const polls = oc.table("polls", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  question: text("question").notNull(),
  choices: text("choices").array().notNull(),
  otherAllowed: boolean("other_allowed").notNull(),
  brands: text("brands").array().notNull(),
  opensAt: ts("opens_at").notNull(),
  closesAt: ts("closes_at").notNull(),
  closedEarlyAt: ts("closed_early_at"),
  closedEarlyBy: uuid("closed_early_by"),
  closedEarlyByName: text("closed_early_by_name"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const pollAnswers = oc.table("poll_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pollId: uuid("poll_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  phone: text("phone").notNull(),
  choice: integer("choice").notNull(),
  otherText: text("other_text"),
  points: integer("points").notNull(),
  pointsReason: text("points_reason").$type<PollReason>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- Drop push (0015): shops' phones and the push outbox ----------
export type DeviceRemoveReason = "logout" | "session_ended" | "unregistered" | "replaced";
export type PushKind = "order_received" | "order_delivered" | "new_poll" | "free_box" | "points_ending";
export type PushTab = "home" | "points" | "polls";

export const appDevices = oc.table("app_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  fcmToken: text("fcm_token").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  removedAt: ts("removed_at"),
  removeReason: text("remove_reason").$type<DeviceRemoveReason>(),
});

export const appPushOutbox = oc.table("app_push_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  kind: text("kind").$type<PushKind>().notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tab: text("tab").$type<PushTab>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  tries: integer("tries").notNull().default(0),
  nextTryAt: ts("next_try_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  gaveUpAt: ts("gave_up_at"),
  lastError: text("last_error"),
});

// ---------- purchases (0016, docs/PURCHASES_PHASE_PLAN.md): vendors, items, purchase bills, payments made ----------
export type VendorGstTreatment = "registered" | "unregistered" | "overseas" | "other";

export const purchaseImports = oc.table("purchase_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  files: jsonb("files").notNull().default({}),
  counts: jsonb("counts").notNull().default({}),
  importedBy: uuid("imported_by").notNull(),
  importedByName: text("imported_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const vendors = oc.table("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  gstTreatment: text("gst_treatment").$type<VendorGstTreatment>(),
  state: text("state"),
  address: text("address"),
  terms: text("terms"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  zohoContactId: text("zoho_contact_id"),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const purchaseItems = oc.table("purchase_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  sku: text("sku"),
  hsn: text("hsn"),
  unit: text("unit"),
  rate: numeric("rate", { precision: 14, scale: 2 }),
  gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  stockItemId: uuid("stock_item_id"),
  zohoItemId: text("zoho_item_id"),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const purchaseBills = oc.table("purchase_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  source: text("source").$type<LedgerSource>().notNull(),
  number: text("number").notNull(),
  refNo: integer("ref_no"),
  zohoBillId: text("zoho_bill_id"),
  vendorId: uuid("vendor_id").notNull(),
  vendorName: text("vendor_name").notNull(),
  billDate: date("bill_date").notNull(),
  dueDate: date("due_date"),
  vendorInvoiceNo: text("vendor_invoice_no"),
  poNumber: text("po_number"),
  subTotal: numeric("sub_total", { precision: 18, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 18, scale: 2 }).notNull().default("0"),
  adjustment: numeric("adjustment", { precision: 18, scale: 2 }).notNull().default("0"),
  taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 18, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 18, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull(),
  notes: text("notes"),
  zohoStatus: text("zoho_status"),
  zohoBalance: numeric("zoho_balance", { precision: 18, scale: 2 }),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ...cancelCols,
});

export const purchaseBillLines = oc.table("purchase_bill_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  billId: uuid("bill_id").notNull(),
  lineNo: integer("line_no").notNull(),
  itemId: uuid("item_id"),
  itemName: text("item_name").notNull(),
  description: text("description"),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unit: text("unit"),
  rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxName: text("tax_name"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  hsn: text("hsn"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

export const vendorPayments = oc.table("vendor_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  source: text("source").$type<LedgerSource>().notNull(),
  number: text("number").notNull(),
  refNo: integer("ref_no"),
  zohoPaymentId: text("zoho_payment_id"),
  vendorId: uuid("vendor_id").notNull(),
  vendorName: text("vendor_name").notNull(),
  paymentDate: date("payment_date").notNull(),
  mode: text("mode").$type<PaymentMode>().notNull(),
  paidFrom: text("paid_from"),
  reference: text("reference"),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  note: text("note"),
  importId: uuid("import_id"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ...cancelCols,
});

export const vendorPaymentAllocations = oc.table("vendor_payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  billId: uuid("bill_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  allocatedOn: date("allocated_on").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- cash book (0017, docs/CASHBOOK_PHASE_PLAN.md step C1): categories, vehicles, cash entries, day closes ----------

export type CashKind = "expense" | "staff_out" | "staff_in" | "owner_in" | "owner_out" | "bank_deposit" | "other_in" | "other_out" | "collection";
export type StaffPurpose = "advance" | "plant" | "salary";

export const expenseCategories = oc.table("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cashVehicles = oc.table("cash_vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cashEntries = oc.table("cash_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  refNo: integer("ref_no").notNull(),
  cashDate: date("cash_date").notNull(),
  workDate: date("work_date").notNull(),
  kind: text("kind").$type<CashKind>().notNull(),
  direction: text("direction").$type<"in" | "out">().notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  categoryId: uuid("category_id"),
  vehicleId: uuid("vehicle_id"),
  personUserId: uuid("person_user_id"),
  personName: text("person_name"),
  staffPurpose: text("staff_purpose").$type<StaffPurpose>(),
  paidTo: text("paid_to"),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancelledByName: text("cancelled_by_name"),
  cancelReason: text("cancel_reason"),
});

export const cashCloses = oc.table("cash_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  cashDate: date("cash_date").notNull(),
  version: integer("version").notNull(),
  opening: boolean("opening").notNull().default(false),
  counted: numeric("counted", { precision: 14, scale: 2 }).notNull(),
  expected: numeric("expected", { precision: 14, scale: 2 }).notNull(),
  difference: numeric("difference", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------- 20 L customers and collections (migration 0018, cash book step C2) ----------

export const jarImports = oc.table("jar_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  fileName: text("file_name").notNull(),
  counts: jsonb("counts").$type<Record<string, number | string>>().notNull().default({}),
  totalDue: numeric("total_due", { precision: 18, scale: 2 }).notNull(),
  importedBy: uuid("imported_by").notNull(),
  importedByName: text("imported_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const jarCustomers = oc.table("jar_customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  sourceRef: text("source_ref").notNull(),
  sourceName: text("source_name").notNull(),
  groupName: text("group_name"),
  paymentPref: text("payment_pref"),
  openingBillId: uuid("opening_bill_id"),
  openingDue: numeric("opening_due", { precision: 18, scale: 2 }).notNull().default("0"),
  importId: uuid("import_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const collectionLines = oc.table("collection_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  lineNo: integer("line_no").notNull(),
  cashEntryId: uuid("cash_entry_id"),
  customerId: uuid("customer_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  mode: text("mode").$type<"cash" | "upi">().notNull(),
  workDate: date("work_date").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const collectionPosts = oc.table("collection_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  lineId: uuid("line_id").notNull(),
  outcome: text("outcome").$type<"posted" | "turned_down">().notNull(),
  paymentId: uuid("payment_id"),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

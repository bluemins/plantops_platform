// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
// Plant coordinates are numeric in the database and strings here ("20.296100"). A scan has no coordinates at all.
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PayBasis } from "@/lib/salary";

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

// ---------- salary (migration 0002): append-only, money in whole paise, dates as "YYYY-MM-DD" strings ----------
const money = (name: string) => bigint(name, { mode: "number" }); // ≤ ₹1 crore: far inside a JS number's exact range
const day = (name: string) => date(name, { mode: "string" });

export const salarySettings = at.table("salary_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  fromMonth: day("from_month").notNull(),
  payBasis: text("pay_basis").$type<PayBasis>().notNull().default("monthly"),
  monthlyPaise: money("monthly_paise"),
  dayRatePaise: integer("day_rate_paise"),
  shiftMinutes: integer("shift_minutes").notNull(),
  paidLeaveHalfdays: integer("paid_leave_halfdays").notNull().default(4),
  getsOvertime: boolean("gets_overtime").notNull(),
  otRatePaise: integer("ot_rate_paise"),
  joinedOn: day("joined_on"),
  leftOn: day("left_on"),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryAdvances = at.table("salary_advances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  onDate: day("on_date").notNull(),
  amountPaise: money("amount_paise").notNull(),
  note: text("note"),
  correctsId: uuid("corrects_id"),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryVisibility = at.table("salary_visibility", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  canSee: boolean("can_see").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryPayments = at.table("salary_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  month: day("month").notNull(),
  paidOn: day("paid_on").notNull(),
  paidPaise: money("paid_paise").notNull(),
  remainingPaise: money("remaining_paise").notNull(),
  figures: jsonb("figures").$type<Record<string, unknown>>().notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryPaymentUndos = at.table("salary_payment_undos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

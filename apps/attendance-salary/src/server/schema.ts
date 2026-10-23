// Drizzle table definitions mirroring db/migrations/*.sql (the SQL files are the source of truth).
// Plant coordinates are numeric in the database and strings here ("20.296100"). A scan has no coordinates at all.
import { bigint, boolean, date, integer, jsonb, numeric, pgSchema, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ClaimKind, PayBasis } from "@/lib/salary";

export const at = pgSchema("attendance_salary");
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type PunchKind = "in" | "out";
/** scan = the worker's QR; owner = a fix (by the owner or Office staff); desk = Office staff's "Mark for someone" */
/** Permanent / Temporary on a salary setting (migration 0006): for the manpower-cost split only */
export type StaffType = "permanent" | "temporary";

export type PunchSource = "scan" | "owner" | "desk";

export const plantSettings = at.table("plant_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  radiusM: integer("radius_m").notNull().default(200),
  qrKeyHash: text("qr_key_hash"),
  qrMadeAt: ts("qr_made_at"),
  /** hour (IST, 8-11) of the morning "not marked" alert; null = Off (migration 0006) */
  notMarkedHour: smallint("not_marked_hour").default(10),
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

/** The owner's whole-day mark (migration 0008): on = present, off = day off without pay (rule 22), clear = back to the IN / OUT marks */
export type DayMarkKind = "on" | "off" | "clear";

export const dayMarks = at.table("day_marks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  day: date("day").notNull(),
  mark: text("mark").$type<DayMarkKind>().notNull(),
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
  kmRatePaise: integer("km_rate_paise"),
  daDayPaise: integer("da_day_paise"),
  /** the owner's "Field staff" tick: may send own claims; a TA / DA rate needs it (migration 0005) */
  fieldStaff: boolean("field_staff").notNull().default(false),
  /** Permanent / Temporary, for the manpower-cost split; the salary rules never look at it (migration 0006) */
  staffType: text("staff_type").$type<StaffType>().notNull().default("permanent"),
  /** a full day's work, without the lunch break (rule 21) */
  shiftMinutes: integer("shift_minutes").notNull(),
  /** the lunch break taken off the time at the plant, 0-180 in 15-minute steps (migration 0009) */
  lunchMinutes: integer("lunch_minutes").notNull().default(0),
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

// ---------- claims (migration 0004): append-only; a claim's status is its newest decision (none = waiting) ----------
export type ClaimDecision = "approved" | "rejected" | "withdrawn" | "cancelled";

export const salaryClaims = at.table("salary_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  kind: text("kind").$type<ClaimKind>().notNull(),
  onDate: day("on_date").notNull(),
  kmTenths: integer("km_tenths"),
  /** field duty: "Ask for DA" (migration 0007); null on an expense */
  wantsDa: boolean("wants_da"),
  amountPaise: money("amount_paise"),
  note: text("note").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryClaimDecisions = at.table("salary_claim_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  claimId: uuid("claim_id").notNull(),
  decision: text("decision").$type<ClaimDecision>().notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const salaryClaimFiles = at.table("salary_claim_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  claimId: uuid("claim_id").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

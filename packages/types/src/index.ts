import { z } from "zod";

/** Every PlantOps module. Adding a module = add it here + a row in platform.modules (seed). */
export const MODULE_IDS = [
  "lab_records",
  "document_store",
  "floor_stock",
  "complaint_box",
  "order_capture",
  "preventive_mgmt",
  "amc",
  "attendance_salary",
  "job_applications",
  "marketing_contacts",
] as const;
export const ModuleId = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleId>;

/** Roles a plant user can hold. A user may hold several. */
export const ROLE_IDS = [
  "tenant_admin",
  "lab_technician",
  "lab_lead",
  "document_keeper",
  "store_keeper",
  "complaint_desk",
  "order_desk",
  "maintenance_technician",
  "plant_staff",
  "office_staff",
  "supervisor",
  "hr_desk",
  "stock_viewer",
  "document_viewer",
  "order_viewer",
] as const;
export const RoleId = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleId>;

/** The working module each staff role operates. tenant_admin and plant_staff are not tied to one module. */
export const ROLE_MODULE: Record<Exclude<RoleId, "tenant_admin" | "plant_staff" | ViewRole>, ModuleId> = {
  lab_technician: "lab_records",
  /** a lab technician who can also approve batches, release holds, verify entries and set limits */
  lab_lead: "lab_records",
  /** adds, renews and archives the plant's licences and certificates */
  document_keeper: "document_store",
  store_keeper: "floor_stock",
  /** logs customer complaints and follows them up (resolving and reopening are owner-only) */
  complaint_desk: "complaint_box",
  /** enters orders, marks them delivered or cancelled (rates, customer upload and undo delivered are owner-only) */
  order_desk: "order_capture",
  maintenance_technician: "preventive_mgmt",
  /** Attendance desk: marks IN / OUT for people without a phone, fixes times, gives advances; never sees salaries */
  office_staff: "attendance_salary",
  /** Attendance: the Today board (read-only) and IN / OUT alerts */
  supervisor: "attendance_salary",
  /** Job applications: sees and calls applicants, changes status, adds notes (openings, CSV and Remove now are owner-only) */
  hr_desk: "job_applications",
};

/**
 * View-only roles (owner, 2026-10-19; docs/VIEW_ROLES_PHASE_PLAN.md): the person opens that one module read-only and
 * never works in it (they are NOT in ROLE_MODULE, so roleWorksIn stays false: never staff, never responsible for a
 * document, never in a module's working-role lists). A Stock viewer sees only the sections the owner picks for them; an
 * Order viewer sees the orders without amounts (like Plant staff).
 */
export type ViewRole = "stock_viewer" | "document_viewer" | "order_viewer";
export const VIEW_ROLE_MODULE: Record<ViewRole, ModuleId> = {
  stock_viewer: "floor_stock",
  document_viewer: "document_store",
  order_viewer: "order_capture",
};
const isViewRole = (role: RoleId): role is ViewRole => role in VIEW_ROLE_MODULE;
/** Does this role give the read-only view of this module? */
export const viewRoleFor = (role: RoleId, moduleId: ModuleId) => isViewRole(role) && VIEW_ROLE_MODULE[role] === moduleId;

/**
 * Modules whose viewers can be ticked for alerts ("Gets alerts", owner 2026-10-19). Not Order Capture: its new-order
 * alert carries the amount, which viewers never see.
 */
export const VIEWER_ALERTS: readonly ModuleId[] = ["floor_stock", "document_store"];

/**
 * May someone with this role be ticked for (and receive) this module's alerts? A role that works there, or the module's
 * view role where VIEWER_ALERTS allows it. Owners always get alerts and are handled separately.
 */
export function getsAlertsIn(role: RoleId, moduleId: ModuleId): boolean {
  return roleWorksIn(role, moduleId) || (viewRoleFor(role, moduleId) && VIEWER_ALERTS.includes(moduleId));
}

/**
 * The only modules plant_staff WORKS in (owner, 2026-10-15): Plant staff marks "this person is an employee", so it
 * opens the employment module (own attendance and overtime; salary stays owner-only). Work in any other module needs
 * that module's own role (Store keeper, Document keeper, Complaint desk, ...). A new module is NOT added automatically.
 */
export const PLANT_STAFF_MODULES: readonly ModuleId[] = ["attendance_salary"];

/**
 * Modules whose alerts go to owners only (owner, 2026-10-15): nobody can be ticked for them ("Gets alerts"), and a
 * ticked row is ignored when sending. An event about one person still reaches that person (also_user_ids +
 * only_listed). Attendance: a worker must never see a colleague's attendance.
 */
export const OWNER_ONLY_ALERTS: readonly ModuleId[] = ["attendance_salary"];

/**
 * Modules plant_staff may OPEN but not work in (owner, 2026-10-14): Order Capture shows them the orders (customer,
 * phone, products, quantities) read-only and without amounts. They stay out of roleWorksIn for these modules, so they
 * are never that module's staff, never ticked for its alerts and never in its alert contacts.
 */
export const PLANT_STAFF_VIEW_ONLY: readonly ModuleId[] = ["order_capture"];

/**
 * Does this person have only the read-only view of this module: plant staff in a view-only module, or the module's view
 * role (Stock / Document / Order viewer), and no owner or working role there?
 */
export function viewOnlyIn(roles: readonly RoleId[], moduleId: ModuleId): boolean {
  const viewer = (roles.includes("plant_staff") && PLANT_STAFF_VIEW_ONLY.includes(moduleId)) || roles.some((r) => viewRoleFor(r, moduleId));
  return viewer && !roles.includes("tenant_admin") && !roles.some((r) => roleWorksIn(r, moduleId));
}

/**
 * Is this person an employee (tracked in Attendance, paid through Salary, marks their own attendance)? Only Plant
 * staff: Office staff and Supervisors work in Attendance but are tracked only when they also hold Plant staff.
 */
export function isEmployee(roles: readonly RoleId[]): boolean {
  return roles.includes("plant_staff");
}

/**
 * Roles whose launcher tile gets the "desk" view of a module's numbers (owner, 2026-10-17): Attendance's Office staff
 * and Supervisor see the attendance numbers (in now / not marked / no exit), never money.
 */
export const DESK_ROLES: Partial<Record<ModuleId, readonly RoleId[]>> = { attendance_salary: ["office_staff", "supervisor"] };

/**
 * Does this staff role work in this module? plant_staff works only in PLANT_STAFF_MODULES. tenant_admin is not a
 * working role (owners get the read-only view).
 */
export function roleWorksIn(role: RoleId, moduleId: ModuleId): boolean {
  if (role === "tenant_admin") return false;
  if (role === "plant_staff") return PLANT_STAFF_MODULES.includes(moduleId);
  if (isViewRole(role)) return false;
  return ROLE_MODULE[role] === moduleId;
}

/** Plan limits JSON stored in tenant_plans.limits. A missing limit means "no limit". */
const LimitValues = z.record(z.string(), z.number().int().nonnegative());
export const PlanLimits = z.object({
  platform: z.object({ max_users: z.number().int().positive().optional() }).catchall(z.number()).default({}),
  modules: z.partialRecord(ModuleId, LimitValues).default({}),
});
export type PlanLimits = z.infer<typeof PlanLimits>;

export const TenantPlan = z.object({
  tenant_id: z.uuid(),
  plan_name: z.string().min(1),
  enabled_modules: z.array(ModuleId),
  limits: PlanLimits,
  renews_on: z.string().nullable(),
});
export type TenantPlan = z.infer<typeof TenantPlan>;

export const TOKEN_ISSUER = "plantops-platform";

/** SSO token payload. Contents are fixed by CLAUDE.md - ask before changing. Never put limits in here. */
export const TokenPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  tenant_id: z.uuid(),
  user_id: z.uuid(),
  roles: z.array(RoleId),
  enabled_modules: z.array(ModuleId),
});
export type TokenPayload = z.infer<typeof TokenPayload>;

/** Response of GET /api/m/tenants/:tid/users/:uid/status (module re-check every few minutes). */
export const UserStatus = z.object({
  active: z.boolean(),
  /** shown as "Sign" / "Verified By" in module records; optional so a module keeps working with an older platform */
  display_name: z.string().optional(),
  roles: z.array(RoleId),
  enabled_modules: z.array(ModuleId),
});
export type UserStatus = z.infer<typeof UserStatus>;

// ---------- launcher tile numbers (CLAUDE.md "Launcher tiles") ----------

/**
 * Summary request token: the platform asks a module for a plant's tile numbers. Signed with the same key as
 * the SSO token but a different purpose and no user - it can never be used as a login.
 */
export const SUMMARY_TOKEN_SECONDS = 60;
/**
 * Whose tile asks for numbers: the owner's read-only summary, a working staff member's, or "desk" = a non-owner holding
 * one of DESK_ROLES for that module (docs/ATTENDANCE_ROLES_PHASE_PLAN.md Phase 0 finding 2). A module that doesn't know
 * "desk" treats it like "staff". "viewer" = a view-only person (viewOnlyIn, v0.27.0); a module that doesn't know it
 * treats it like "staff".
 */
export const SummaryView = z.enum(["owner", "staff", "desk", "viewer"]);
export type SummaryView = z.infer<typeof SummaryView>;
export const SummaryRequestPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  purpose: z.literal("summary"),
  tenant_id: z.uuid(),
  view: SummaryView,
});
export type SummaryRequestPayload = z.infer<typeof SummaryRequestPayload>;

/** What a module answers at GET <base_url>/api/plantops/summary. */
export const BadgeTone = z.enum(["ok", "info", "warn", "danger"]);
export const ModuleSummary = z.object({
  badges: z.array(z.object({ text: z.string().trim().min(1).max(40), tone: BadgeTone })).max(3),
});
export type ModuleSummary = z.infer<typeof ModuleSummary>;
export const MODULE_SUMMARY_PATH = "/api/plantops/summary";

/** GET /api/m/tenants/:tid/branding - what a module needs to show the plant's look. */
export const TenantBranding = z.object({
  tenant_id: z.uuid(),
  name: z.string(),
  brand_color: z.string().nullable(),
  /** platform path; fetch it with module credentials */
  logo_url: z.string().nullable(),
  /** the plant code (Job applications builds the plant's public link from it); optional for an older platform */
  code: z.string().optional(),
  /** Business details → customer support phone / hours (v0.28.1); null until filled, absent from an older platform */
  support_phone: z.string().nullable().optional(),
  support_hours: z.string().nullable().optional(),
});
export type TenantBranding = z.infer<typeof TenantBranding>;

/**
 * GET /api/m/plants/by-code/:code (Job applications only): which plant a public job page belongs to. Only an active
 * plant with Job applications switched on; nothing else about it.
 */
export const PublicPlant = z.object({ tenant_id: z.uuid(), name: z.string() });
export type PublicPlant = z.infer<typeof PublicPlant>;

/**
 * GET /api/m/tenants/:tid/alert-contacts - active owners plus users holding one of the calling module's
 * roles, for alerts (e.g. WhatsApp on a failed lab test). The module picks whom to alert.
 */
export const AlertContact = z.object({
  user_id: z.uuid(),
  display_name: z.string(),
  phone: z.string().nullable(),
  /** for email reminders (Document Store); optional so a module keeps working with an older platform */
  email: z.string().nullable().optional(),
  roles: z.array(RoleId),
});
export type AlertContact = z.infer<typeof AlertContact>;

/**
 * POST /api/m/tenants/:tid/notifications - a module reports an event; the PLATFORM decides who receives it: the
 * plant's active owners + the people the owner ticked for this module + also_user_ids, each checked (active, this
 * plant, works in the module), minus exclude_user_id. Shown in the bell and, at level "push", on installed phones.
 * The same module + dedupe_key is stored once per person, so a retry is safe. CLAUDE.md "Notifications".
 */
export const NotificationInput = z.object({
  /** e.g. "floor_stock.count_saved" */
  kind: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(300).default(""),
  /** a path inside the module ("/day/2026-10-11"); the platform opens it through /sso/start */
  link: z
    .string()
    .max(500)
    .regex(/^\/(?!\/)[^\s\\]*$/, "must be a path inside the module")
    .nullable()
    .default(null),
  /** "push": phone + bell; "bell": launcher list only */
  level: z.enum(["push", "bell"]).default("push"),
  dedupe_key: z.string().trim().min(1).max(200),
  /** whoever did it - they are not notified about their own action */
  exclude_user_id: z.uuid().nullable().optional(),
  /** people the event is about (e.g. the technician whose batch was approved); checked like everyone else */
  also_user_ids: z.array(z.uuid()).max(20).optional(),
  /** only also_user_ids, nobody else (e.g. "you are now responsible for …"); each is still checked */
  only_listed: z.boolean().optional(),
  /**
   * leave out people whose only link to the module is its view role (Floor Stock sends Stock viewers their own version,
   * limited to their sections)
   */
  no_viewers: z.boolean().optional(),
  /** each also_user_ids person must also be ticked for this module ("Gets alerts") and allowed its alerts (getsAlertsIn) */
  if_ticked: z.boolean().optional(),
});
export type NotificationInput = z.input<typeof NotificationInput>;
export const NotificationResult = z.object({ recipients: z.number().int(), created: z.number().int() });
export type NotificationResult = z.infer<typeof NotificationResult>;

/**
 * Every notification kind people can configure (N4): its module (null = PlantOps itself), a plain label for the
 * settings screen, `urgent` - always phone + bell and can't be changed (decided 2026-10-11) - and `bellOnly` - never
 * on phones anyway, so the only choice is bell or off. `aboutYou` - sent to the person it is about; in an
 * OWNER_ONLY_ALERTS module these are the only kinds a non-owner can receive.
 * A kind not listed here can't be configured and is always delivered as sent.
 */
export const NOTIFICATION_KINDS: Record<
  string,
  {
    module: ModuleId | null;
    label: string;
    urgent?: true;
    bellOnly?: true;
    aboutYou?: true;
    /** in an owner-only module: non-owners holding one of these roles receive it too (Attendance's Supervisor) */
    roles?: readonly RoleId[];
    /** owners never receive it (Attendance's every-scan bell goes to supervisors only) */
    noOwners?: true;
  }
> = {
  "floor_stock.count_saved": { module: "floor_stock", label: "Stock count saved" },
  "floor_stock.count_corrected": { module: "floor_stock", label: "Stock count corrected" },
  "floor_stock.low_stock": { module: "floor_stock", label: "Low stock" },
  "floor_stock.count_check": { module: "floor_stock", label: "Check the count" },
  "floor_stock.count_missing": { module: "floor_stock", label: "Today's count not done (evening)" },
  "floor_stock.setup_changed": { module: "floor_stock", label: "Sections & items changed by staff", bellOnly: true },
  "lab_records.batch_held": { module: "lab_records", label: "Batch ON HOLD (failed test)", urgent: true },
  "lab_records.form_failed": { module: "lab_records", label: "Form 3 / Form 4 FAIL", urgent: true },
  "lab_records.batch_ready": { module: "lab_records", label: "Batch ready for approval" },
  "lab_records.batch_approved": { module: "lab_records", label: "Batch approved" },
  "lab_records.batch_rejected": { module: "lab_records", label: "Batch rejected" },
  "lab_records.entry_corrected": { module: "lab_records", label: "Result corrected", bellOnly: true },
  "lab_records.daily_reminder": { module: "lab_records", label: "Morning reminder (holds, Form 1)" },
  "lab_records.no_tests_today": { module: "lab_records", label: "No lab tests today (evening)" },
  "document_store.expiry": { module: "document_store", label: "Document expiring / expired", urgent: true },
  "document_store.responsible": { module: "document_store", label: "You are made responsible for a document" },
  "document_store.added": { module: "document_store", label: "New document added", bellOnly: true },
  "document_store.renewed": { module: "document_store", label: "Document renewed", bellOnly: true },
  "document_store.storage": { module: "document_store", label: "Document storage nearly full" },
  "complaint_box.new": { module: "complaint_box", label: "New complaint" },
  "complaint_box.resolved": { module: "complaint_box", label: "Your complaint resolved" },
  "complaint_box.reopened": { module: "complaint_box", label: "Complaint reopened" },
  "complaint_box.still_open": { module: "complaint_box", label: "Complaint still open (reminder)" },
  "complaint_box.updated": { module: "complaint_box", label: "Note added / in progress", bellOnly: true },
  "complaint_box.storage": { module: "complaint_box", label: "Complaint Box storage nearly full" },
  "order_capture.new": { module: "order_capture", label: "New order" },
  "order_capture.delivered": { module: "order_capture", label: "Your order delivered", bellOnly: true },
  "order_capture.cancelled": { module: "order_capture", label: "Order cancelled", bellOnly: true },
  "order_capture.note": { module: "order_capture", label: "Note added to an order", bellOnly: true },
  "order_capture.feedback_low": { module: "order_capture", label: "Unhappy customer on WhatsApp" },
  "order_capture.handoff": { module: "order_capture", label: "WhatsApp customer asks for a person" },
  "order_capture.reminder_failed": { module: "order_capture", label: "WhatsApp reminders stopped (Twilio refused)" },
  "attendance_salary.corrected": { module: "attendance_salary", label: "Your attendance was changed", aboutYou: true },
  "attendance_salary.outside": { module: "attendance_salary", label: "Mark refused: outside the plant", bellOnly: true },
  "attendance_salary.no_exit": { module: "attendance_salary", label: "People who didn't mark OUT (morning)", bellOnly: true },
  "attendance_salary.salary_review": { module: "attendance_salary", label: "Month-end salary review" },
  "attendance_salary.salary_paid": { module: "attendance_salary", label: "Your salary is paid", aboutYou: true },
  "attendance_salary.claim_new": { module: "attendance_salary", label: "New claim (field duty / expense)" },
  "attendance_salary.claim_decided": { module: "attendance_salary", label: "Your claim approved / not approved", aboutYou: true },
  "attendance_salary.storage": { module: "attendance_salary", label: "Attendance storage nearly full" },
  "attendance_salary.advance_given": { module: "attendance_salary", label: "Advance given by Office staff" },
  "attendance_salary.desk_fix": { module: "attendance_salary", label: "Attendance changed by Office staff", bellOnly: true },
  "attendance_salary.scan": { module: "attendance_salary", label: "Someone marked IN / OUT", bellOnly: true, roles: ["supervisor"], noOwners: true },
  "attendance_salary.not_marked": { module: "attendance_salary", label: "People not marked (morning)", roles: ["supervisor"] },
  "job_applications.new": { module: "job_applications", label: "New job application", bellOnly: true },
  "job_applications.storage": { module: "job_applications", label: "Job applications storage nearly full" },
  "platform.user_locked": { module: null, label: "Someone locked out", urgent: true },
  "platform.support_opened": { module: null, label: "PlantOps support viewed your data", bellOnly: true },
  "platform.module_on": { module: null, label: "Module switched on" },
  "platform.module_off": { module: null, label: "Module switched off", bellOnly: true },
  "platform.plan_changed": { module: null, label: "Plan updated", bellOnly: true },
  "platform.plan_renewal": { module: null, label: "Plan renewal coming up" },
};
export const NotificationMode = z.enum(["push", "bell", "off"]);
export type NotificationMode = z.infer<typeof NotificationMode>;

/** GET /api/m/tenants/:tid/skus - the plant's products. Modules store sku_id as a plain reference. */
export const TenantSku = z.object({
  id: z.uuid(),
  name: z.string(),
  sku_code: z.string().nullable(),
  /** size of ONE bottle/jar */
  volume_ml: z.number().int(),
  /** 1 = single unit; e.g. 24 for a case of 24 */
  units_per_pack: z.number().int(),
  pack_type: z.string(),
  status: z.enum(["active", "inactive"]),
});
export type TenantSku = z.infer<typeof TenantSku>;

// ---------- support view (CLAUDE.md "Support token") ----------

/**
 * super_admin opens one plant's module data READ-ONLY. Same signing key as the SSO token, but a `purpose`
 * and no user/roles, so it can never be used as a login. Modules accept it only via verifySupportToken,
 * refuse every write with it and log each view where the plant owner can see it.
 */
export const SUPPORT_TOKEN_SECONDS = 15 * 60;
export const SupportTokenPayload = z.object({
  iss: z.literal(TOKEN_ISSUER),
  aud: ModuleId,
  iat: z.number(),
  exp: z.number(),
  jti: z.uuid(),
  purpose: z.literal("support"),
  tenant_id: z.uuid(),
  super_admin_id: z.uuid(),
  read_only: z.literal(true),
});
export type SupportTokenPayload = z.infer<typeof SupportTokenPayload>;

// ---------- error log (STABILITY_PLAN B-09) ----------

/**
 * One server error, as a module sends it to the platform (POST /api/m/errors) and as the platform records its own.
 * Only where and what went wrong: never form contents, query strings, cookies, phone numbers or money. The app is
 * never in it: the platform takes it from the module's credentials.
 */
export const ErrorReport = z.object({
  method: z.string().regex(/^[A-Z]{1,10}$/),
  /** path only, no query string */
  path: z.string().min(1).max(300).regex(/^\/[^?#\s]*$/),
  /** api = a JSON route, page = a screen, action = a server action, proxy = the module's proxy */
  kind: z.enum(["api", "page", "action", "proxy"]),
  message: z.string().min(1).max(500),
  stack: z.string().max(2000).nullable().default(null),
  tenant_id: z.uuid().nullable().default(null),
  user_id: z.uuid().nullable().default(null),
});
export type ErrorReport = z.infer<typeof ErrorReport>;

const longDigits = /\d{7,}/g; // phone numbers, account numbers: never kept, even inside an error message
const clean = (s: string, max: number) => s.replace(longDigits, "#######").slice(0, max);

/**
 * Turns a caught error into an ErrorReport: the path without its query string, the message cut to 500 characters,
 * the first 12 lines of the code trace, and long digit runs (phones) blanked out.
 */
export function buildErrorReport(
  err: unknown,
  where: { method: string; path: string; kind: ErrorReport["kind"]; tenant_id?: string | null; user_id?: string | null },
): ErrorReport {
  const e = err instanceof Error ? err : null;
  const message = clean((e ? `${e.name === "Error" ? "" : `${e.name}: `}${e.message}` : String(err)).trim() || "(no message)", 500);
  const stack = e?.stack ? clean(e.stack.split("\n").slice(1, 13).map((l) => l.trim()).join("\n"), 2000) || null : null;
  const path = (where.path.split(/[?#]/)[0] || "/").replace(/\s/g, "").slice(0, 300);
  const method = /^[A-Z]{1,10}$/.test(where.method.toUpperCase()) ? where.method.toUpperCase() : "GET";
  const uuid = (v: string | null | undefined) => (v && z.uuid().safeParse(v).success ? v : null);
  return {
    method,
    path: path.startsWith("/") ? path : `/${path}`,
    kind: where.kind,
    message,
    stack,
    tenant_id: uuid(where.tenant_id),
    user_id: uuid(where.user_id),
  };
}

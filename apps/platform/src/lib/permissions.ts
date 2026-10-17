// The owner's "Who can do what" screen (/admin/permissions): what each person is in each module switched on for the
// plant. Worked out from the SAME rules the servers enforce (roleWorksIn / viewOnlyIn in packages/types), so the
// screen can't say something different from what actually happens. Text only; nothing here grants access.
import { MODULE_IDS, NOTIFICATION_KINDS, OWNER_ONLY_ALERTS, ROLE_IDS, ROLE_MODULE, roleWorksIn, viewOnlyIn, type ModuleId, type RoleId } from "@plantops/types";
import { ROLE_LABELS } from "./api";
import { moduleLabel } from "./modules";

export type CellKind = "owner" | "lead" | "work" | "view";
export interface Cell {
  kind: CellKind;
  label: string;
  /** gets this module's app notifications (owners always do) */
  alerts: boolean;
}

/** What a read-only viewer sees, per view-only module (packages/types PLANT_STAFF_VIEW_ONLY). */
const VIEW_LABELS: Partial<Record<ModuleId, string>> = { order_capture: "View only, no amounts" };

/**
 * "Gets alerts" tick boxes: the modules (switched on for the plant) that someone with these roles works in. Owner-only
 * modules (Attendance) are never offered. The server applies the same rule (setAlertModules).
 */
export const alertChoices = (enabled: string[], roles: string[]) =>
  enabled.filter((m) => !OWNER_ONLY_ALERTS.includes(m as ModuleId) && roles.some((r) => roleWorksIn(r as RoleId, m as ModuleId)));

/** One cell of the grid: null = no access ("–"). */
export function cellFor(roles: readonly string[], alertModules: readonly string[], moduleId: ModuleId): Cell | null {
  const rs = roles as RoleId[];
  if (rs.includes("tenant_admin")) return { kind: "owner", label: "Owner", alerts: true };
  // owner-only modules: never a ticked 🔔 for staff, but a role that receives alerts by itself (a Supervisor) has one
  const byRole = Object.values(NOTIFICATION_KINDS).some((k) => k.module === moduleId && k.roles?.some((r) => rs.includes(r)));
  const alerts = (alertModules.includes(moduleId) && !OWNER_ONLY_ALERTS.includes(moduleId)) || byRole;
  let working = rs.filter((r) => roleWorksIn(r, moduleId));
  if (working.includes("lab_lead")) working = working.filter((r) => r !== "lab_technician"); // a lead is a technician too
  if (working.length > 1) working = working.filter((r) => r !== "plant_staff"); // the module's own role says more
  if (working.length) return { kind: working.includes("lab_lead") ? "lead" : "work", label: working.map((r) => ROLE_LABELS[r] ?? r).join(", "), alerts };
  if (viewOnlyIn(rs, moduleId)) return { kind: "view", label: VIEW_LABELS[moduleId] ?? "View only", alerts: false };
  return null;
}

/** The grid's columns: the plant's switched-on modules in the usual module order. */
export const gridModules = (enabled: readonly string[]) => MODULE_IDS.filter((m) => enabled.includes(m));

/** What a role does, when its module's name alone doesn't say it (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-ups). */
const ROLE_HINTS: Partial<Record<RoleId, string>> = {
  office_staff: "Attendance: marks for others, fixes times, advances (no salaries)",
  supervisor: "Attendance: Today board and IN / OUT alerts",
  hr_desk: "Job applications: see and call applicants",
};

/** A role button on Add / Edit user: what it opens, and whether its module is switched off for the plant. */
export interface RoleChoice {
  role: RoleId;
  label: string;
  hint: string;
  off: boolean;
}

/**
 * The roles to offer on Add / Edit user. A role whose module is not switched on is left out, unless the person
 * already holds it (shown as off, so it can still be removed). An empty `enabled` means the list did not load:
 * then every role is offered, so the form never hides roles by mistake.
 */
export function roleChoices(enabled: readonly string[], held: readonly string[]): RoleChoice[] {
  const known = enabled.length > 0;
  const choices: RoleChoice[] = [];
  for (const role of ROLE_IDS) {
    const label = ROLE_LABELS[role] ?? role;
    if (role === "tenant_admin") {
      choices.push({ role, label, hint: "Everything, in every module", off: false });
    } else if (role === "plant_staff") {
      choices.push({ role, label, hint: plantStaffHint(enabled), off: false });
    } else {
      const m = ROLE_MODULE[role];
      const off = known && !enabled.includes(m);
      if (off && !held.includes(role)) continue;
      choices.push({ role, label, hint: off ? `${moduleLabel(m)} · not switched on` : (ROLE_HINTS[role] ?? moduleLabel(m)), off });
    }
  }
  return choices;
}

/** What Plant staff opens in this plant, from the same rules the servers use. */
function plantStaffHint(enabled: readonly string[]): string {
  if (!enabled.length) return "Employee";
  const mods = gridModules(enabled);
  const parts = [
    ...mods.filter((m) => roleWorksIn("plant_staff", m)).map(moduleLabel),
    ...mods.filter((m) => viewOnlyIn(["plant_staff"], m)).map((m) => `${moduleLabel(m)} (${(VIEW_LABELS[m] ?? "view only").toLowerCase()})`),
  ];
  return ["Employee", ...(parts.length ? parts : ["opens no module here yet"])].join(" · ");
}

/** The key under the grid, in plain words. */
export const ROLE_MEANINGS: { kind: CellKind; label: string; text: string }[] = [
  { kind: "owner", label: "Owner", text: "Everything, in every module." },
  { kind: "lead", label: "Lab lead", text: "Lab tests, plus approve batches, release holds and set limits." },
  { kind: "work", label: "Lab technician", text: "Enters lab tests and forms." },
  { kind: "work", label: "Document keeper", text: "Adds and renews documents." },
  { kind: "work", label: "Store keeper", text: "Daily stock count, adds items." },
  { kind: "work", label: "Complaint desk", text: "Logs complaints and follows them up." },
  { kind: "work", label: "Order desk", text: "Takes orders, sees amounts, marks them delivered or cancelled." },
  { kind: "work", label: "Plant staff", text: "Employee: own attendance and overtime (Attendance & Salary)." },
  { kind: "work", label: "Office staff", text: "Attendance: marks for people without a phone, fixes times, gives advances. Never salaries." },
  { kind: "work", label: "Supervisor", text: "Attendance: the Today board (read-only) and an alert for every IN / OUT." },
  { kind: "work", label: "HR desk", text: "Job applications: sees applicants, calls them, changes status, adds notes." },
  { kind: "view", label: "View only, no amounts", text: "Plant staff in Order Capture: sees orders, never prices." },
];

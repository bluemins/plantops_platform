import type { ModuleId, RoleId } from "@plantops/types";

/**
 * How each module appears on tiles. Text only - access rules live on the server.
 * `setup`: an extra link on the owner's open tile to a setup screen inside the module (a path there).
 * `staffBy`: a different line under the label for staff holding one of these roles (first one held wins).
 */
export const MODULES: Record<ModuleId, { label: string; icon: string; staff: string; staffBy?: Partial<Record<RoleId, string>>; setup?: { label: string; path: string } }> = {
  lab_records: { label: "Lab Records", icon: "🧪", staff: "Enter & manage tests" },
  document_store: { label: "Document Store", icon: "📄", staff: "Licences & certificates" },
  floor_stock: { label: "Floor Stock", icon: "📦", staff: "Daily stock count", setup: { label: "⚙ Set up sections", path: "/setup" } },
  complaint_box: { label: "Complaint Box", icon: "📢", staff: "Log a complaint", setup: { label: "⚙ Item list", path: "/items" } },
  order_capture: { label: "Order Capture", icon: "🧾", staff: "Take an order", setup: { label: "⚙ Rates", path: "/rates" } },
  preventive_mgmt: { label: "Preventive Mgmt", icon: "🛠️", staff: "Manage PM tasks" },
  amc: { label: "AMC", icon: "📑", staff: "Contracts & visits" },
  attendance_salary: {
    label: "Attendance & Salary",
    icon: "🗓️",
    staff: "Mark attendance",
    // the tile's line for these roles (docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Platform screens"); the first one held wins
    staffBy: { office_staff: "Attendance desk", supervisor: "Today board" },
    setup: { label: "⚙ Location & QR", path: "/settings" },
  },
  job_applications: { label: "Job applications", icon: "📋", staff: "Applications", setup: { label: "⚙ Openings", path: "/openings" } },
  marketing_contacts: { label: "Marketing Contacts", icon: "📣", staff: "Contacts & follow-ups" },
};

export const moduleLabel = (id: string) => MODULES[id as ModuleId]?.label ?? id;

/** A staff tile's own line for someone with these roles ("Attendance desk" for Office staff); null = the usual `staff`. */
export function roleLine(moduleId: ModuleId, roles: readonly RoleId[]): string | null {
  const by = Object.entries(MODULES[moduleId].staffBy ?? {}).find(([r]) => roles.includes(r as RoleId));
  return by ? by[1] : null;
}

import type { ModuleId } from "@plantops/types";

/** How each module appears on tiles. Text only - access rules live on the server. */
export const MODULES: Record<ModuleId, { label: string; icon: string; staff: string }> = {
  lab_records: { label: "Lab Records", icon: "🧪", staff: "Enter & manage tests" },
  document_store: { label: "Document Store", icon: "📄", staff: "Licences & certificates" },
  floor_stock: { label: "Floor Stock", icon: "📦", staff: "Manage stock in/out" },
  preventive_mgmt: { label: "Preventive Mgmt", icon: "🛠️", staff: "Manage PM tasks" },
  amc: { label: "AMC", icon: "📑", staff: "Contracts & visits" },
  attendance_salary: { label: "Attendance & Salary", icon: "🗓️", staff: "Attendance & salary" },
  marketing_contacts: { label: "Marketing Contacts", icon: "📣", staff: "Contacts & follow-ups" },
};

export const moduleLabel = (id: string) => MODULES[id as ModuleId]?.label ?? id;

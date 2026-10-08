import type { ModuleId } from "@plantops/types";

/**
 * How each module appears on tiles. Text only - access rules live on the server.
 * `setup`: an extra link on the owner's open tile to a setup screen inside the module (a path there).
 */
export const MODULES: Record<ModuleId, { label: string; icon: string; staff: string; setup?: { label: string; path: string } }> = {
  lab_records: { label: "Lab Records", icon: "🧪", staff: "Enter & manage tests" },
  document_store: { label: "Document Store", icon: "📄", staff: "Licences & certificates" },
  floor_stock: { label: "Floor Stock", icon: "📦", staff: "Daily stock count", setup: { label: "⚙ Set up sections", path: "/setup" } },
  preventive_mgmt: { label: "Preventive Mgmt", icon: "🛠️", staff: "Manage PM tasks" },
  amc: { label: "AMC", icon: "📑", staff: "Contracts & visits" },
  attendance_salary: { label: "Attendance & Salary", icon: "🗓️", staff: "Attendance & salary" },
  marketing_contacts: { label: "Marketing Contacts", icon: "📣", staff: "Contacts & follow-ups" },
};

export const moduleLabel = (id: string) => MODULES[id as ModuleId]?.label ?? id;

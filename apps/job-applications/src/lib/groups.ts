// The public page's groups of jobs, in page order, with the mock-up's icons (docs/JOB_APPLICATIONS_PHASE_PLAN.md
// "Openings"). The database stores the id (job_applications.openings.grp).
import type { OpeningGroup } from "@/server/schema";

export const GROUPS: { id: OpeningGroup; label: string; icon: string }[] = [
  { id: "production", label: "Production", icon: "M2 20h20M4 20V10l5 3V10l5 3V6l6-3v17" },
  { id: "lab_quality", label: "Lab & quality", icon: "M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3" },
  { id: "office_sales", label: "Office & sales", icon: "M3 7h18v13H3zM8 7V4h8v3M3 12h18" },
  { id: "delivery_security", label: "Delivery & security", icon: "M1 4h13v12H1zM14 9h4l4 4v3h-8M5 19a2 2 0 1 0 0-.01M18 19a2 2 0 1 0 0-.01" },
  { id: "other", label: "Other", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 12h.01M12 12h.01M16 12h.01" },
];

export const GROUP_IDS = GROUPS.map((g) => g.id) as [OpeningGroup, ...OpeningGroup[]];
export const groupLabel = (id: string) => GROUPS.find((g) => g.id === id)?.label ?? id;

/** Field limits, shared by the form, the server and the database checks. */
export const LIMITS = { title: 80, tag: 40, description: 1000, minQualification: 500, goodToHave: 500, message: 300 } as const;

/** The page message until the owner writes one (the mock-up's hero text). */
export const DEFAULT_MESSAGE = "Steady work in a clean, safe plant near you. Pick a job, or just send your resume.";

export const jobsText = (n: number) => (n === 1 ? "1 job" : `${n} jobs`);

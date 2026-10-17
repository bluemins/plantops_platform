// Job applications' notifications (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Notifications", N5+). Built here as plain
// data; routes send them with kit.notify after the answer (never blocking it). Never the applicant's phone number.
//   * new application: bell; owners + people ticked for Job applications (HR desk)
//   * storage 80 % / 95 % / full: phone + bell; OWNERS ONLY (sent to the listed owners, not ticked people)
import type { NotificationInput } from "@plantops/types";
import { formatRef } from "@/lib/apply";
import { kit } from "./kit";

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function newApplicationNotification(a: { id: string; refNo: number; openingTitle: string | null; place: string }): NotificationInput {
  return {
    kind: "job_applications.new",
    title: clip(`New job application ${formatRef(a.refNo)}: ${a.openingTitle ?? "Any job"}, ${a.place}`, 80),
    body: "",
    link: `/applications/${a.id}`,
    level: "bell",
    dedupe_key: `new:${a.id}`,
  };
}

// ---------- storage ----------
export const STORAGE_STEPS = [80, 95] as const;

/** The threshold (80 / 95 %) this send crossed, or null. */
export function storageStepCrossed(before: number, after: number, limit: number | null): number | null {
  if (!limit) return null;
  const crossed = STORAGE_STEPS.filter((p) => before < (limit * p) / 100 && after >= (limit * p) / 100);
  return crossed.length ? crossed[crossed.length - 1]! : null;
}

/** "full" = an application was refused because the plan's storage is used up (the form is closed). */
export function storageNotification(step: number | "full", usedBytes: number, limitBytes: number, ownerIds: string[]): NotificationInput {
  const mb = (b: number) => Math.round(b / (1024 * 1024)).toLocaleString("en-IN");
  const limitMb = Math.round(limitBytes / (1024 * 1024));
  return {
    kind: "job_applications.storage",
    title: step === "full" ? "Job applications storage full: the form is closed" : `Job applications storage ${step} % full`,
    body:
      step === "full"
        ? `${mb(usedBytes)} MB of ${mb(limitBytes)} MB used. New applications are refused until PlantOps gives more space.`
        : `${mb(usedBytes)} MB of ${mb(limitBytes)} MB used. Ask PlantOps for more space before the form closes.`,
    link: "/openings",
    level: "push",
    dedupe_key: `storage:${limitMb}:${step}`,
    also_user_ids: ownerIds.slice(0, 20),
    only_listed: true,
  };
}

/** The plant's active owners (for owner-only events). Empty when PlantOps can't be reached (the event then reaches nobody). */
export async function ownerIds(tenantId: string): Promise<string[]> {
  return ((await kit.contacts(tenantId)) ?? []).filter((c) => c.roles.includes("tenant_admin")).map((c) => c.user_id);
}

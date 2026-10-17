// Application statuses: labels and the mock-ups' chip colours (screens 5 and 6).
import type { ApplicationStatus } from "@/server/schema";

export const STATUSES: { id: ApplicationStatus; label: string; chip: string }[] = [
  { id: "new", label: "New", chip: "bg-blue-100 text-blue-900" },
  { id: "called", label: "Called", chip: "bg-amber-100 text-amber-800" },
  { id: "shortlisted", label: "Shortlisted", chip: "bg-violet-100 text-violet-800" },
  { id: "hired", label: "Hired", chip: "bg-green-100 text-green-800" },
  { id: "not_suitable", label: "Not suitable", chip: "bg-slate-100 text-slate-600" },
];
export const STATUS_IDS = STATUSES.map((s) => s.id) as [ApplicationStatus, ...ApplicationStatus[]];
export const statusOf = (id: string) => STATUSES.find((s) => s.id === id) ?? STATUSES[0]!;

/** Personal data is kept 12 months from sending (the applicant's consent), then removed by the daily job. */
export function removalDate(sentAt: Date) {
  const d = new Date(sentAt);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}
export const NOTE_MAX = 300;

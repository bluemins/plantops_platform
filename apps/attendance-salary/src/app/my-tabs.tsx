import { can } from "@/server/access";
import { hasOwnClaims } from "@/server/claims";
import { hasFieldDay } from "@/server/field";
import { canSeeOwnSalary } from "@/server/salary-slip";
import type { AtUser } from "@/server/session";

type Current = "attendance" | "field" | "claims" | "salary";

/**
 * "My attendance · Field day · My claims · My salary" (docs/SALARY_EXTRAS_PHASE_PLAN.md mock-ups 2 and 7; Field day:
 * docs/FIELD_DAY_PHASE_PLAN.md, only with the Field staff tick). My claims only for
 * Field staff (or someone with a claim on record); My salary ONLY when the owner allowed them to see their own salary. With neither
 * there are no tabs at all, so nothing hints that those pages exist.
 */
export function MyTabs({ attendanceHref, current, field = false, claims, salary }: { attendanceHref: string; current: Current; field?: boolean; claims: boolean; salary: boolean }) {
  if (!field && !claims && !salary) return null;
  const tab = (href: string, label: string, on: boolean) => (
    <a
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ${on ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-200 bg-white text-slate-800"}`}
    >
      {label}
    </a>
  );
  return (
    <nav aria-label="Mine" className="flex flex-wrap gap-1.5">
      {tab(attendanceHref, "My attendance", current === "attendance")}
      {field && tab("/my/field", "Field day", current === "field")}
      {claims && tab("/my/claims", "My claims", current === "claims")}
      {salary && tab("/my/salary", "My salary", current === "salary")}
    </nav>
  );
}

/** Which tabs this person has, worked out on the server: `<MyTabs {...await myTabs(user)} current="…" />`. */
export async function myTabs(user: AtUser) {
  const [field, claims, salary] = await Promise.all([hasFieldDay(user), hasOwnClaims(user), canSeeOwnSalary(user)]);
  return { attendanceHref: can(user, "see_today") ? "/my" : "/", field, claims, salary };
}

import { can, type Action } from "@/server/access";
import type { AtUser } from "@/server/session";

/** Each tab and the access-table action that shows it (the server checks the same action again on the page). */
const TABS: readonly (readonly [string, string, string, Action])[] = [
  ["today", "/", "Today", "see_today"],
  ["desk", "/desk", "Mark for someone", "mark_for"],
  ["staff", "/staff", "Staff", "see_everyone"],
  ["salary", "/salary", "Salary", "salary_view"],
  ["claims", "/claims", "Claims", "claim_view"],
  ["changes", "/changes", "Recent changes", "view_changes"],
  ["settings", "/settings", "Settings", "view_settings"],
] as const;

type Tab = "today" | "desk" | "staff" | "salary" | "claims" | "changes" | "settings" | "mine";

/**
 * The tabs of everyone who sees more than their own attendance (mock-up "Owner · Today"; docs/ATTENDANCE_ROLES_PHASE_PLAN.md
 * mock-ups 1 and 5): the owner Today · Staff · Salary · Claims (N waiting) · Recent changes · Settings; Office staff
 * Today · Mark for someone · Staff; a Supervisor Today. "My attendance" is a tab for non-owners who are also Plant staff
 * (owners keep the button under the board). `claimsWaiting` comes from the page; the number only shows when something
 * waits.
 */
export function OwnerNav({ user, current, claimsWaiting = 0 }: { user: AtUser; current: Tab; claimsWaiting?: number }) {
  const shown: [string, string, string][] = TABS.filter(([, , , action]) => can(user, action)).map(([id, href, label]) => [id, href, label]);
  if (!user.isOwner && can(user, "see_own")) shown.push(["mine", "/my", "My attendance"]);
  return (
    <nav aria-label="Attendance" className="flex flex-wrap gap-1.5">
      {shown.map(([id, href, label]) => (
        <a
          key={id}
          href={href}
          aria-current={id === current ? "page" : undefined}
          className={`flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap ${id === current ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-200 bg-white text-slate-800"}`}
        >
          {id === "claims" && claimsWaiting > 0 ? `${label} (${claimsWaiting})` : label}
        </a>
      ))}
    </nav>
  );
}

import { can } from "@/server/access";
import type { AtUser } from "@/server/session";

const TABS = [
  ["today", "/", "Today"],
  ["staff", "/staff", "Staff"],
  ["salary", "/salary", "Salary"],
  ["changes", "/changes", "Recent changes"],
  ["settings", "/settings", "Settings"],
] as const;

/** The owner's tabs (mock-up "Owner · Today"): Today · Staff · Salary · Recent changes · Settings. */
export function OwnerNav({ user, current }: { user: AtUser; current: (typeof TABS)[number][0] }) {
  const shown = TABS.filter(([id]) => (id !== "settings" || can(user, "view_settings")) && (id !== "salary" || can(user, "salary_view")));
  return (
    <nav aria-label="Attendance" className="flex flex-wrap gap-1.5">
      {shown.map(([id, href, label]) => (
        <a
          key={id}
          href={href}
          aria-current={id === current ? "page" : undefined}
          className={`flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap ${id === current ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-200 bg-white text-slate-800"}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

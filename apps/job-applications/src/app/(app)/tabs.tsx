import { can } from "@/server/access";
import type { JaUser } from "@/server/session";

type Tab = "applications" | "openings" | "csv" | "changes";

/** The tabs under the header (mock-ups 5 and 7). HR desk only has Applications, so sees no tabs. CSV downloads the file. */
export function Tabs({ user, active }: { user: JaUser; active: Tab }) {
  const tabs: [Tab, string, string][] = [
    ["applications", "Applications", "/applications"],
    ...(can(user, "view_openings") ? [["openings", "Openings", "/openings"] as [Tab, string, string]] : []),
    ...(can(user, "export") ? [["csv", "CSV", "/api/app/export"] as [Tab, string, string]] : []),
    ...(can(user, "view_changes") ? [["changes", "Recent changes", "/changes"] as [Tab, string, string]] : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Sections" className="-mx-4 flex gap-5 overflow-x-auto border-b border-slate-200 bg-white px-4 text-sm font-semibold">
      {tabs.map(([id, label, href]) => (
        <a
          key={id}
          href={href}
          aria-current={id === active ? "page" : undefined}
          className={`shrink-0 border-b-[3px] py-3 ${id === active ? "border-(--brand) text-slate-900" : "border-transparent text-(--brand)"}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

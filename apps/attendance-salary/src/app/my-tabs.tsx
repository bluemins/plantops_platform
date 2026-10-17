/**
 * "My attendance · My salary" (mock-up 7), shown ONLY to someone the owner allowed to see their own salary. Without
 * that permission there are no tabs at all, so nothing hints that a salary page exists.
 */
export function MyTabs({ attendanceHref, current }: { attendanceHref: string; current: "attendance" | "salary" }) {
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
      {tab("/my/salary", "My salary", current === "salary")}
    </nav>
  );
}

// Accounts desk: the two tabs (owner, 2026-11-23).
export function DeskTabs({ current }: { current: "stages" | "dues" }) {
  const tabs = [
    ["stages", "/accounts", "Order stages"],
    ["dues", "/accounts/dues", "Customer dues"],
  ] as const;
  return (
    <nav aria-label="Accounts desk pages" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {tabs.map(([key, href, label]) => (
        <a
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold ${key === current ? "bg-(--brand) text-(--brand-contrast)" : "text-slate-600"}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

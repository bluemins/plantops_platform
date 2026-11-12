// Pieces shared by the cash book pages (docs/CASHBOOK_PHASE_PLAN.md, steps C1-C4).

export type CashTab = "day" | "book" | "staff" | "van" | "jar" | "post" | "settings";
export const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Day sheet | Cash book | With staff | Vans | 20 L | To post (N) | Settings (owner). */
export function CashNav({ current, owner, toPost }: { current: CashTab; owner: boolean; toPost?: number }) {
  const tabs: [CashTab, string, string][] = [
    ["day", "/cash", "Day sheet"],
    ["book", "/cash/book", "Cash book"],
    ["staff", "/cash/staff", "With staff"],
    ["van", "/cash/van", "Vans"],
    ["jar", "/cash/jar", "20 L"],
    ["post", "/cash/post", toPost ? `To post (${toPost})` : "To post"],
  ];
  if (owner) tabs.push(["settings", "/cash/settings", "Settings"]);
  return (
    <nav aria-label="Cash" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
      {tabs.map(([k, href, label]) =>
        k === current ? (
          <span key={k} className="border-b-2 border-(--brand) pb-1">{label}</span>
        ) : (
          <a key={k} href={href} className="pb-1 text-slate-600">{label}</a>
        ),
      )}
    </nav>
  );
}

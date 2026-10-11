// "Recent changes": audit rows in plain words for the owner ("Item Jar: renamed from 20L jar").

type Change = { from: unknown; to: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** One audit row as a sentence. */
export function describeChange(action: string, details: Record<string, unknown>): string {
  const name = show(details.name);
  const changes = (details.changes ?? {}) as Record<string, Change>;
  switch (action) {
    case "item.add":
      return `Added item ${name}${details.product ? ` (linked to ${show(details.product)})` : ""}`;
    case "item.update": {
      const parts: string[] = [];
      if (changes.name) parts.push(`renamed from ${show(changes.name.from)}`);
      if (changes.status) parts.push(changes.status.to === "off" ? "switched off" : "switched on");
      return `Item ${name}: ${parts.join(", ")}`;
    }
    case "item.reorder":
      return "Changed the order of the items";
    case "items.starter":
      return `Created the starter list (${show(details.items)} items)`;
    case "export.csv":
      return `Exported the complaints (CSV, ${show(details.complaints)} complaint${details.complaints === 1 ? "" : "s"})`;
    default:
      return action;
  }
}

// "Recent changes": audit rows in plain words for the owner ("Item Roll: limit — → 3").
import { fmtDate } from "@plantops/module-kit/format";

type Change = { from: unknown; to: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const FIELD: Record<string, string> = { name: "name", unit: "unit", second_unit: "second number", sku_id: "product", min_level: "limit" };

/** One audit row as a sentence. `sections` maps section ids to names (for "moved to"). */
export function describeChange(action: string, target: string | null, details: Record<string, unknown>, sections: Map<string, string>): string {
  const name = show(details.name);
  const changes = (details.changes ?? {}) as Record<string, Change>;
  switch (action) {
    case "section.add":
      return `Added section ${name} (${details.kind === "finished" ? "finished goods" : "stock"})`;
    case "section.update": {
      const parts: string[] = [];
      if (changes.name) parts.push(`renamed from ${show(changes.name.from)}`);
      if (changes.status) parts.push(changes.status.to === "off" ? "switched off" : "switched on");
      return `Section ${name}: ${parts.join(", ")}`;
    }
    case "section.reorder":
      return "Changed the order of the sections";
    case "item.add":
      return `Added item ${name} to ${show(details.section)}${details.min_level != null ? `, limit ${details.min_level}` : ""}`;
    case "item.update": {
      const parts: string[] = [];
      for (const [key, c] of Object.entries(changes)) {
        if (key === "status") parts.push(c.to === "off" ? "switched off" : "switched on");
        else if (key === "section_id") parts.push(`moved to ${show(details.to_section ?? sections.get(String(c.to)))}`);
        else if (key === "sku_id") parts.push(c.to ? "product link changed" : "product link removed");
        else parts.push(`${FIELD[key] ?? key} ${show(c.from)} → ${show(c.to)}`);
      }
      return `Item ${name}: ${parts.join(", ")}`;
    }
    case "item.reorder":
      return `Changed the order of the items in ${show(sections.get(String(target)))}`;
    case "setup.template":
      return `Created the starter list (${show(details.sections)} sections, ${show(details.items)} items)`;
    case "count.correct":
      return `Corrected the count of ${target ? fmtDate(target) : "—"} (version ${show(details.version)}): ${show(details.reason)}`;
    default:
      return action;
  }
}

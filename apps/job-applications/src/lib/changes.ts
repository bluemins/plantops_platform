// "Recent changes": audit rows in plain words for the owner ("Lab Assistant: tag … → …, switched off").
import { groupLabel } from "./groups";

type Change = { from: unknown; to: unknown };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const short = (v: unknown, n = 60) => {
  const s = show(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const FIELD: Record<string, string> = {
  title: "title",
  grp: "group",
  tag: "short tag",
  description: "job description",
  minQualification: "minimum qualification",
  goodToHave: "good to have",
};

/** One audit row as a sentence. */
export function describeChange(action: string, details: Record<string, unknown>): string {
  const changes = (details.changes ?? {}) as Record<string, Change>;
  switch (action) {
    case "opening.added":
      return `Added position ${show(details.title)} (${groupLabel(String(details.grp))})${details.status === "off" ? ", not shown yet" : ""}`;
    case "opening.changed": {
      const parts: string[] = [];
      // in the form's order (the database keeps the details as JSON, which doesn't keep key order)
      for (const k of [...Object.keys(FIELD), "status"]) {
        const c = changes[k];
        if (!c) continue;
        if (k === "status") parts.push(c.to === "active" ? "shown on the public page" : "switched off");
        else if (k === "grp") parts.push(`group ${groupLabel(String(c.from))} → ${groupLabel(String(c.to))}`);
        else if (k === "title" || k === "tag") parts.push(`${FIELD[k]} ${short(c.from)} → ${short(c.to)}`);
        else if (FIELD[k]) parts.push(`${FIELD[k]} changed`);
      }
      return `${show(details.title)}: ${parts.join(", ") || "saved, nothing changed"}`;
    }
    case "opening.moved":
      return `${show(details.title)} moved ${details.direction === "up" ? "up" : "down"} in ${groupLabel(String(details.grp))}`;
    case "page.message":
      return `Page message changed to "${short(details.to, 120)}"`;
    case "export.csv":
      return `Exported the applications (CSV, ${show(details.rows)} rows)`;
    case "application.removed":
      return `${show(details.ref)} removed: ${show(details.reason)}`;
    case "applications.purged":
      return `${show(details.count)} application${details.count === 1 ? "" : "s"} older than 12 months removed`;
    default:
      return action;
  }
}

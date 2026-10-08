// "Copy as WhatsApp message": the saved count as text in the familiar group-message layout, so staff can still
// post it during the switch-over. *bold* is WhatsApp's own formatting.
import { fmtDate } from "@plantops/module-kit/format";
import { qty } from "./compare";

interface Line {
  qty: number;
  second_qty: number | null;
  remark: string | null;
}
interface Row {
  name: string;
  unit: string;
  second_unit: string | null;
  production: Line[];
  stock: Line[];
}
interface Section {
  name: string;
  kind: "finished" | "stock";
  rows: Row[];
}

const lineText = (l: Line, unit: string, secondUnit: string | null) =>
  `${qty(l.qty)} ${unit}${l.second_qty !== null && secondUnit ? ` (${qty(l.second_qty)} ${secondUnit})` : ""}${l.remark ? ` (${l.remark})` : ""}`;

/** e.g. "Bluemins 1 L: 2 box (6 pcs) + 19 box (Hemex)". Several lines are joined with " + ". */
const rowText = (name: string, lines: Line[], unit: string, secondUnit: string | null) => `${name}: ${lines.map((l) => lineText(l, unit, secondUnit)).join(" + ")}`;

export function whatsappText(plant: string, date: string, sections: Section[]): string {
  const out = [`*${plant}*`, `*Stock ${fmtDate(date)}*`];
  const made = sections.flatMap((s) => (s.kind === "finished" ? s.rows.filter((r) => r.production.length) : []));
  if (made.length) {
    out.push("", "*Today production*");
    for (const r of made) out.push(rowText(r.name, r.production, r.unit, null));
  }
  for (const s of sections) {
    const rows = s.rows.filter((r) => r.stock.length);
    if (!rows.length) continue;
    out.push("", `*${s.name}*`);
    for (const r of rows) out.push(rowText(r.name, r.stock, r.unit, r.second_unit));
  }
  return out.join("\n");
}

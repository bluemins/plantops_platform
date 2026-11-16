// Floor Stock's part of Sales' Day report (owner only; packages/module-kit/src/day-report.ts): that day's count as the
// owner's day page shows it (made, sold / used, low, check the count, Can make). Read only, nothing stored.
import type { DayReportPart } from "@plantops/types";
import { clip, plural } from "@plantops/module-kit/day-report";
import { qty } from "@/lib/compare";
import { countDay, istTime } from "@/lib/days";
import type { CanMakeGroup } from "@/lib/recipe";
import type { StockUser } from "./session";
import { dayView, type DayRow } from "./views";

/** The owner's view of the plant, for reading only (never used to write). */
const reader = (tenantId: string): StockUser => ({
  tenantId,
  userId: "00000000-0000-0000-0000-000000000000",
  name: "Day report",
  roles: ["tenant_admin"],
  isOwner: true,
  canCount: true,
  isViewer: false,
  isSupport: false,
});

function byUnit(rows: { unit: string; n: number }[]) {
  const per = new Map<string, number>();
  for (const r of rows) if (r.n) per.set(r.unit, (per.get(r.unit) ?? 0) + r.n);
  return [...per].map(([u, n]) => `${qty(n)} ${u}`).join(" + ");
}

function canMakeText(groups: CanMakeGroup[]) {
  const out: { label: string; value: string }[] = [];
  for (const g of groups)
    for (const p of g.products)
      if (p.status === "ok")
        out.push({
          label: `Can make: ${p.name}`,
          value: `${p.boxes !== null ? `up to ${qty(p.boxes)} box` : `up to ${qty(p.bottles)} ${p.unit}`}${p.limiting.length ? ` (runs out first: ${p.limiting.join(", ")})` : ""}${g.shared.length ? " · shares material" : ""}`,
        });
  return out.slice(0, 10);
}

export async function stockDayReport(tenantId: string, date: string, now: Date): Promise<DayReportPart> {
  const v = await dayView(reader(tenantId), date);
  if (!v) {
    const open = date === countDay(now);
    return { summary: open ? "Count not done yet" : "No count that day", tone: "warn", rows: [], attention: [open ? "Today's stock count is not done" : "No stock count that day"] };
  }
  const first = v.versions[0]!;
  const rows: DayReportPart["rows"] = [{ label: "Counted", value: `${istTime(first.entered_at)} by ${first.entered_by}` }];
  if (v.versions.length > 1) {
    const last = v.versions.at(-1)!;
    rows.push({ label: "Corrected", value: clip(`${plural(v.versions.length - 1, "time")}, last by ${last.entered_by}${last.reason ? `: ${last.reason}` : ""}`, 300), tone: "warn" });
  }
  const all: DayRow[] = v.sections.flatMap((s) => s.rows);
  const finished = all.filter((r) => r.finished);
  const made = byUnit(finished.map((r) => ({ unit: r.unit, n: r.production_total })));
  const sold = byUnit(finished.map((r) => ({ unit: r.unit, n: r.comparison.kind === "sold" ? r.comparison.value : 0 })));
  rows.push({ label: "Made", value: made || "Nothing" });
  if (v.previous_counted) rows.push({ label: "Sold (worked out)", value: sold || "Nothing" });
  else rows.push({ label: "Sold (worked out)", value: `No count on the day before` });
  for (const r of finished.filter((x) => x.production_total || x.closing))
    rows.push({
      label: `  ${r.name}`,
      value: [r.production_total ? `made ${qty(r.production_total)}` : "", r.comparison.kind === "sold" ? `sold ${qty(r.comparison.value)}` : "", `left ${qty(r.closing)} ${r.unit}`].filter(Boolean).join(" · "),
    });
  if (v.low.length) rows.push({ label: "Low", value: clip(v.low.map((r) => `${r.name} ${qty(r.closing)} ${r.unit} (limit ${qty(r.min_level ?? 0)})`).join(", "), 300), tone: "bad" });
  else rows.push({ label: "Low", value: "None", tone: "ok" });
  const checks = all.filter((r) => r.comparison.kind === "check");
  if (checks.length) rows.push({ label: "Check the count", value: clip(checks.map((r) => r.name).join(", "), 300), tone: "warn" });
  rows.push(...canMakeText(v.can_make));

  const attention: string[] = [];
  if (v.low.length) attention.push(clip(`${plural(v.low.length, "stock item")} low: ${v.low.map((r) => r.name).join(", ")}`, 200));
  if (checks.length) attention.push(clip(`Check the stock count: ${checks.map((r) => r.name).join(", ")}`, 200));
  return {
    summary: clip(`Counted ${istTime(first.entered_at)}${v.low.length ? ` · ${v.low.length} low` : ""}`, 100),
    tone: v.low.length ? "bad" : "ok",
    rows: rows.slice(0, 60),
    attention,
  };
}

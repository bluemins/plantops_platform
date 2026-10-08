// Small pieces shared by the read-only screens (server components).
import type { ReactNode } from "react";
import { comparisonText, qty, type Comparison } from "@/lib/compare";

const TONE: Record<Comparison["kind"], string> = {
  sold: "text-slate-700",
  used: "text-slate-700",
  received: "text-sky-700",
  check: "font-semibold text-red-700",
  no_previous_count: "text-slate-400",
  new_item: "text-slate-400",
  unit_changed: "text-amber-700",
};

export function ComparisonLine({ c, unit, previousDate }: { c: Comparison; unit: string; previousDate?: string }) {
  return <span className={TONE[c.kind]}>{comparisonText(c, unit, previousDate)}</span>;
}

export function LowChip({ minLevel }: { minLevel: number | null }) {
  return <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Low · limit {minLevel === null ? "—" : qty(minLevel)}</span>;
}

export function BackLink({ href = "/", children = "← Floor Stock" }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} className="text-sm font-semibold text-(--brand)">
      {children}
    </a>
  );
}

/** "2 box (6 pcs) · Hemex" for one line. */
export function lineText(l: { qty: number; second_qty: number | null; remark: string | null }, unit: string, secondUnit: string | null) {
  return `${qty(l.qty)} ${unit}${l.second_qty !== null && secondUnit ? ` + ${qty(l.second_qty)} ${secondUnit}` : ""}${l.remark ? ` · ${l.remark}` : ""}`;
}

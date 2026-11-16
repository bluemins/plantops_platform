// Charts for Business Overview / Business charts (docs/REPORTS_PHASE_PLAN.md section 9), drawn on the server as plain
// HTML + one SVG line: no chart library, nothing to load on a phone, prints as it shows. Hover / long-press a bar for its
// amount (title); every chart has a "Table" under it with the same numbers.
import type { ReactNode } from "react";
import { niceScale, shortRupees } from "@/lib/business";

/** The validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red) + a grey for "other". */
export const SLOT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
export const GREY = "#94a3b8";

export const toRupees = (p: bigint) => Number(p) / 100;
export const fullRupees = (r: number) => `${r < 0 ? "−" : ""}₹${Math.round(Math.abs(r)).toLocaleString("en-IN")}`;

export type ChartSeries = { name: string; color: string; values: number[] };
export type ChartLine = { name: string; color: string; values: (number | null)[]; dash?: boolean };

const AXIS = 56; // px for the axis labels on the left

/** Bars (stacked or side by side) with an optional line, on one axis. `count` = numbers, not rupees. */
export function Chart(props: { labels: string[]; axis?: string[]; series: ChartSeries[]; mode?: "stack" | "group"; line?: ChartLine; height?: number; count?: boolean; label: string }) {
  const { labels, series, mode = "stack", line, height = 200, count = false } = props;
  const fmtAxis = (v: number) => (count ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : shortRupees(v));
  const fmt = (v: number) => (count ? String(v) : fullRupees(v));
  const n = labels.length;
  const colSums = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
  const all = [0, ...(mode === "stack" ? colSums : series.flatMap((s) => s.values)), ...(line?.values.filter((v): v is number => v !== null) ?? [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const { step } = niceScale(hi - lo || 1);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const y = (v: number) => ((v - lo) / (hi - lo)) * height;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const every = Math.max(1, Math.ceil(n / 12));
  const gap = n > 20 ? 2 : n > 12 ? 4 : 8;
  const pts = line
    ? line.values.map((v, i) => (v === null ? null : `${(((i + 0.5) / n) * 1000).toFixed(1)},${(200 - (y(v) / height) * 200).toFixed(1)}`)).filter(Boolean).join(" ")
    : "";
  const zero = y(0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        {(series.length > 1 || line) && series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>
        ))}
        {line && (
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash ? "4 3" : undefined} /></svg>
            {line.name}
          </span>
        )}
      </div>
      <div role="img" aria-label={props.label} className="relative" style={{ height, marginLeft: AXIS }}>
        {ticks.map((v) => (
          <div key={v} className="absolute inset-x-0 border-t" style={{ bottom: y(v), borderColor: v === 0 && lo < 0 ? "#94a3b8" : "#eef2f6" }}>
            <span className="absolute -top-2 text-right text-[11px] text-slate-500" style={{ left: -AXIS, width: AXIS - 6 }}>{fmtAxis(v)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex" style={{ gap }}>
          {labels.map((lab, i) => (
            <div key={i} className="relative flex flex-1 justify-center" style={{ gap: 2 }} title={line && !series.length && line.values[i] !== null ? `${lab} · ${line.name}: ${fmt(line.values[i]!)}` : undefined}>
              {(mode === "stack" ? [series] : series.map((s) => [s])).map((group, g) => {
                let base = 0;
                return (
                  <div key={g} className="relative h-full flex-1" style={{ maxWidth: mode === "stack" ? 44 : 22 }}>
                    {group.map((s, k) => {
                      const v = s.values[i] ?? 0;
                      if (!v) return null;
                      const top = k === group.length - 1 || group.slice(k + 1).every((x) => !(x.values[i] ?? 0));
                      const bottom = v >= 0 ? y(base) + (base > 0 ? 2 : 0) : y(v);
                      const h = Math.max(1, Math.abs(y(base + v) - y(base)) - (base > 0 ? 2 : 0));
                      if (v > 0) base += v;
                      return (
                        <div
                          key={s.name}
                          title={`${lab} · ${s.name}: ${fmt(v)}`}
                          className="absolute inset-x-0"
                          style={{ bottom: v >= 0 ? bottom : y(v), height: v >= 0 ? h : zero - y(v), background: s.color, borderRadius: v >= 0 ? (top ? "4px 4px 0 0" : 0) : "0 0 4px 4px" }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {line && (
          <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            <polyline points={pts} fill="none" stroke={line.color} strokeWidth="2" strokeDasharray={line.dash ? "6 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex" style={{ marginLeft: AXIS, gap }}>
        {(props.axis ?? labels).map((lab, i) => (
          <span key={i} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-slate-500">{i % every === 0 ? lab : ""}</span>
        ))}
      </div>
      <ChartTable heads={["", ...series.map((s) => s.name), ...(line ? [line.name] : [])]} rows={labels.map((lab, i) => [lab, ...series.map((s) => fmt(s.values[i] ?? 0)), ...(line ? [line.values[i] === null ? "—" : fmt(line.values[i]!)] : [])])} />
    </div>
  );
}

/** Horizontal bars, biggest first (expense types, customers). */
export function HBars({ rows, label }: { rows: { label: string; value: number; color: string; href?: string | null }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing in this period.</p>;
  return (
    <div role="img" aria-label={label} className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${fullRupees(r.value)}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-2 text-sm">
          {r.href ? <a href={r.href} className="truncate font-semibold text-(--brand)">{r.label}</a> : <span className="truncate text-slate-700">{r.label}</span>}
          <span className="h-4 rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          <span className="text-right tabular-nums">{fullRupees(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Not due yet / overdue as one split bar (Receivables, Payables cards). */
export function SplitBar({ notDue, overdue }: { notDue: number; overdue: number }) {
  const all = notDue + overdue;
  return (
    <div className="space-y-2">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded bg-slate-100">
        {all > 0 && notDue > 0 && <span title={`Not due yet: ${fullRupees(notDue)}`} style={{ width: `${(notDue / all) * 100}%`, background: SLOT[0] }} />}
        {all > 0 && overdue > 0 && <span title={`Overdue: ${fullRupees(overdue)}`} style={{ width: `${(overdue / all) * 100}%`, background: SLOT[1] }} />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: SLOT[0] }} />Not due yet: <b>{fullRupees(notDue)}</b></span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: SLOT[1] }} />Overdue: <b>{fullRupees(overdue)}</b></span>
      </div>
    </div>
  );
}

export function ChartTable({ heads, rows }: { heads: string[]; rows: string[][] }) {
  return (
    <details className="text-sm print:hidden">
      <summary className="cursor-pointer text-xs font-semibold text-(--brand)">Table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr>{heads.map((h, i) => <th key={i} className={`px-2 py-1 font-semibold text-slate-500 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-2 py-1 ${j ? "text-right tabular-nums" : ""}`}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ChartCard({ id, title, sub, foot, children }: { id?: string; title: string; sub?: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 break-inside-avoid">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {sub && <p className="text-sm text-slate-600">{sub}</p>}
      </div>
      {children}
      {foot && <p className="text-xs text-slate-600">{foot}</p>}
    </section>
  );
}

/** What the page says about salary (release 2): included up to the newest paid month, or why it is missing. */
export function salaryNote(s: { state: "in" | "off" | "unreachable"; lastPaidMonth: string | null }) {
  if (s.state === "off") return "Salary is not included: Attendance & Salary is not switched on for this plant.";
  if (s.state === "unreachable") return "Salary is missing: Attendance didn't answer. Reload the page in a minute.";
  if (!s.lastPaidMonth) return "Salary: no month has been marked paid in Attendance yet.";
  const m = new Date(`${s.lastPaidMonth}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return `Salary from Attendance's paid months (newest: ${m}); a month counts once it is marked paid.`;
}

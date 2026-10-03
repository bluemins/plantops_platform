import type { ReactNode } from "react";
import type { Verdict } from "./verdict";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800" },
  on_hold: { label: "On hold", className: "bg-red-100 text-red-700" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", className: "bg-slate-200 text-slate-700" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  return <span className={cx("inline-block rounded-full px-3 py-0.5 text-sm font-semibold", s.className)}>{s.label}</span>;
}

const VERDICT: Record<Verdict, { label: string; className: string }> = {
  pass: { label: "Pass", className: "bg-emerald-100 text-emerald-800" },
  fail: { label: "Fail", className: "bg-red-100 text-red-700" },
  none: { label: "No limit", className: "bg-slate-100 text-slate-600" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return <span className={cx("inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", v.className)}>{v.label}</span>;
}

/** Colour for a single value cell. */
export const verdictText = (v: Verdict) => (v === "fail" ? "text-red-700 font-bold" : v === "pass" ? "text-emerald-700 font-semibold" : "text-slate-800");

/** A big tap target that looks like a button (links between screens). */
export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <a
      href={href}
      className={cx(
        "inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-semibold",
        variant === "primary" ? "bg-(--brand) text-(--brand-contrast) hover:bg-(--brand-hover)" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
      )}
    >
      {children}
    </a>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-500">{children}</h2>;
}

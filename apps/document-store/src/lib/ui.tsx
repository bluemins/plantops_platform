import type { ReactNode } from "react";
import type { ExpiryKind } from "./expiry";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const EXPIRY_STYLE: Record<ExpiryKind, string> = {
  expired: "bg-red-100 text-red-700",
  today: "bg-red-100 text-red-700",
  soon: "bg-amber-100 text-amber-800",
  valid: "bg-emerald-100 text-emerald-800",
  none: "bg-slate-100 text-slate-600",
};

export function ExpiryChip({ kind, text }: { kind: ExpiryKind; text: string }) {
  return <span className={cx("inline-block whitespace-nowrap rounded-full px-3 py-0.5 text-sm font-semibold", EXPIRY_STYLE[kind])}>{text}</span>;
}

const REMINDER_TEXT: Record<string, string> = { sent: "sent", pending: "sending…", skipped: "not sent", failed: "failed" };
export const reminderStatusText = (s: string) => REMINDER_TEXT[s] ?? s;

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

export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

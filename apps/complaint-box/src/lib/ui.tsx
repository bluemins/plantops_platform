import type { ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

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

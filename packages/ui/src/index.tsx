// Shared, mobile-first building blocks (big touch targets, CLAUDE.md "UX"). Styled with Tailwind classes;
// each app's Tailwind setup must scan this package (see apps/platform/src/app/globals.css @source).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      {...props}
      className={cx(
        "min-h-12 rounded-xl px-5 text-base font-semibold transition disabled:opacity-50",
        variant === "primary" && "bg-blue-700 text-white hover:bg-blue-800",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "danger" && "border border-red-300 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</div>;
}

export function TextField({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );
}

/** 6-digit PIN entry: numeric keypad on phones, digits only. */
export function PinInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return <TextField {...props} type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="current-password" />;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p>;
}

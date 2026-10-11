// Shared, mobile-first building blocks (big touch targets, CLAUDE.md "UX"). Styled with Tailwind classes;
// each app's Tailwind setup must scan this package (see apps/platform/src/app/globals.css @source).
// Colours come from the plant's brand (CSS variables from brandStyle(); defaults in each app's global CSS).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export { brandPalette, brandStyle, DEFAULT_BRAND, type BrandPalette } from "./brand";

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
        variant === "primary" && "bg-(--brand) text-(--brand-contrast) hover:bg-(--brand-hover)",
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
        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
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

/**
 * The 🔔 in a module's header: links to the PlantOps notifications page, with the unread count when known
 * (CLAUDE.md "Notifications"). Never shown in a support view.
 */
export function NotificationsLink({ href, unread }: { href: string; unread: number | null }) {
  const label = unread ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <a href={href} aria-label={label} title={label} className="relative flex h-11 w-11 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-900">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {!!unread && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-700 px-1 text-xs font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </a>
  );
}

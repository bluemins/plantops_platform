// Small pieces shared by the screens (server and client components).
import type { ReactNode } from "react";
import { phoneDisplay } from "@plantops/module-kit/phone";

export function BackLink({ href = "/", children = "← Order Capture" }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} className="text-sm font-semibold text-(--brand)">
      {children}
    </a>
  );
}

/** The customer's mobile: one tap to call (tel:+91...). PlantOps support sees plain text. */
export function PhoneLink({ phone, plain, prefix = "" }: { phone: string; plain?: boolean; prefix?: string }) {
  const { text, href } = phoneDisplay(phone, plain);
  if (!href) return <span>{prefix ? `+91 ${text}` : text}</span>;
  return (
    <a href={href} className="inline-flex min-h-11 items-center font-semibold text-(--brand) underline-offset-2 hover:underline">
      📞 {prefix}
      {text}
    </a>
  );
}

const BADGE: Record<string, string> = {
  pending: "bg-sky-100 text-sky-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-700",
};
const STATUS: Record<string, string> = { pending: "Pending", delivered: "Delivered", cancelled: "Cancelled" };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${BADGE[status] ?? ""}`}>{STATUS[status] ?? status}</span>;
}

/** A big tappable row that leads to another screen (home page, Rates page links). */
export function LinkRow({ href, children, note }: { href: string; children: ReactNode; note?: string }) {
  return (
    <a href={href} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold shadow-sm hover:bg-slate-50">
      <span>
        <span className="block">{children}</span>
        {note && <span className="block text-sm font-normal text-slate-500">{note}</span>}
      </span>
      <span aria-hidden="true" className="text-slate-400">
        ›
      </span>
    </a>
  );
}

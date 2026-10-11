// Small pieces shared by the screens (server components).
import type { ReactNode } from "react";
import { phoneDisplay } from "@/lib/phone";

export function BackLink({ href = "/", children = "← Complaint Box" }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} className="text-sm font-semibold text-(--brand)">
      {children}
    </a>
  );
}

const BADGE: Record<string, string> = {
  open: "bg-sky-100 text-sky-800",
  in_progress: "bg-amber-100 text-amber-900",
  resolved: "bg-green-100 text-green-800",
};
const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${BADGE[status] ?? ""}`}>{STATUS[status] ?? status}</span>;
}

/** The customer's mobile: one tap to call (tel:+91...). PlantOps support sees plain text. */
export function PhoneLink({ phone, plain }: { phone: string; plain?: boolean }) {
  const { text, href } = phoneDisplay(phone, plain);
  if (!href) return <span>{text}</span>;
  return (
    <a href={href} className="font-semibold text-(--brand) underline-offset-2 hover:underline">
      📞 {text}
    </a>
  );
}

/** "Open 4 days" (amber after 3 days) or "Resolved 3 Oct". */
export function AgeText({ status, days, amber, changedAt }: { status: string; days: number | null; amber: boolean; changedAt: string }) {
  if (status === "resolved") {
    const d = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(changedAt));
    return <span className="text-sm text-slate-500">Resolved {d}</span>;
  }
  const text = days === 0 ? "Open today" : `Open ${days} day${days === 1 ? "" : "s"}`;
  return <span className={`text-sm ${amber ? "rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900" : "text-slate-500"}`}>{text}</span>;
}

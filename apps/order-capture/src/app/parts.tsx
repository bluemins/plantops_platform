// Small pieces shared by the screens (server and client components).
import type { ReactNode } from "react";
import { phoneDisplay } from "@plantops/module-kit/phone";
import { brandColour } from "@/lib/brand";

export function BackLink({ href = "/", children = "← Sales" }: { href?: string; children?: ReactNode }) {
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

/** A product brand on an order card ("Bluemins"), the same colour everywhere. */
export function BrandTag({ brand }: { brand: string }) {
  return <span className={`inline-block shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${brandColour(brand)}`}>{brand}</span>;
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

/**
 * "Orders | Bills | Calls" under the header for people who use more than one (owner, Order desk, support); Bills needs
 * the ledger (amounts), Calls the Calls tab; Calls shows the waiting count.
 */
export function SectionTabs({ current, waiting, bills = false, calls = true }: { current: "orders" | "bills" | "calls"; waiting: number; bills?: boolean; calls?: boolean }) {
  const tabs: ["orders" | "bills" | "calls", string, string][] = [["orders", "/", "Orders"]];
  if (bills) tabs.push(["bills", "/bills", "Bills"]);
  if (calls) tabs.push(["calls", "/calls", "📞 Calls"]);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Orders, bills or calls" className={`grid gap-1 rounded-xl border border-slate-200 bg-white p-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {tabs.map(([key, href, label]) => (
        <a
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${key === current ? "bg-(--brand) text-(--brand-contrast)" : "text-slate-600"}`}
        >
          {label}
          {key === "calls" && waiting > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{waiting}</span>}
        </a>
      ))}
    </nav>
  );
}

const BILL_BADGE: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  due: "bg-amber-100 text-amber-900",
  part_paid: "bg-amber-100 text-amber-900",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-700",
  closed: "bg-green-100 text-green-800",
};
const BILL_LABEL: Record<string, string> = { paid: "Paid", due: "Due", part_paid: "Partly paid", overdue: "Overdue", cancelled: "Cancelled", closed: "Closed" };

/** A bill's status (Paid / Due / Partly paid / Overdue / Cancelled), or an order's "Closed". */
export function BillBadge({ status, due }: { status: string; due?: string }) {
  const showDue = due && (status === "due" || status === "part_paid" || status === "overdue");
  return (
    <span className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BILL_BADGE[status] ?? ""}`}>
      {BILL_LABEL[status] ?? status}
      {showDue ? ` ${due}` : ""}
    </span>
  );
}

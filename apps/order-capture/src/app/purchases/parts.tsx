// Pieces shared by the Purchases pages (docs/PURCHASES_PHASE_PLAN.md, P1).
import { can, type Actor } from "@/server/access";

export type PurchaseTab = "bills" | "payments" | "vendors" | "payables" | "received" | "import";
export const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";
export const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const qty = (q: string) => Number(q).toLocaleString("en-IN", { maximumFractionDigits: 3 });
export const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" };
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Purchase bills | Payments made | Vendors | Import from Zoho (owner). */
export function PurchaseNav({ current, user }: { current: PurchaseTab; user: Actor }) {
  const tabs: [PurchaseTab, string, string][] = [
    ["bills", "/purchases", "Purchase bills"],
    ["payments", "/purchases/payments", "Payments made"],
    ["vendors", "/purchases/vendors", "Vendors"],
  ];
  if (can(user, "payables")) tabs.push(["payables", "/purchases/payables", "Payables"]);
  tabs.push(["received", "/purchases/received", "Received"]);
  if (can(user, "purchase_import")) tabs.push(["import", "/purchases/import", "Import from Zoho"]);
  return (
    <nav aria-label="Purchases" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
      {tabs.map(([k, href, label]) =>
        k === current ? (
          <span key={k} className="border-b-2 border-(--brand) pb-1">{label}</span>
        ) : (
          <a key={k} href={href} className={`pb-1 ${k === "import" ? "ml-auto text-(--brand)" : "text-slate-600"}`}>{label}</a>
        ),
      )}
      {can(user, "purchase_enter") && (
        <span className="flex w-full gap-2 pt-1">
          <a href="/purchases/bills/new" className="inline-flex min-h-10 items-center rounded-xl bg-(--brand) px-4 text-sm font-semibold text-(--brand-contrast)">+ Purchase bill</a>
          <a href="/purchases/vendors/new" className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800">+ Vendor</a>
        </span>
      )}
    </nav>
  );
}

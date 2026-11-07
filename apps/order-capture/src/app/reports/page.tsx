import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";

const LATER = ["Receivables", "Payments received", "GST", "Stock", "Attendance & salary"];

/** Reports (mock-up 2): sections on the left (Sales now; the rest later), the section's reports on the right. Owner. */
export default async function ReportsPage() {
  const user = await requirePageUser("/reports");
  if (!can(user, "reports")) redirect("/");
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href={`${process.env.PLATFORM_URL ?? ""}/home?launcher=1`}>← Dashboard</BackLink>
      <h1 className="text-2xl font-bold">Reports</h1>
      <div className="flex flex-wrap gap-4">
        <nav aria-label="Report sections" className="flex w-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3 sm:w-60">
          <p className="px-2 py-1 text-xs font-bold tracking-wide text-slate-600">SECTIONS</p>
          <span className="flex justify-between rounded-lg bg-(--brand-soft) px-3 py-2 font-bold text-(--brand)">Sales <span className="text-sm">2</span></span>
          {LATER.map((s) => (
            <span key={s} className="flex justify-between px-3 py-2 text-slate-500">{s} <span className="text-xs">later</span></span>
          ))}
        </nav>
        <section className="min-w-0 flex-[999_1_480px] space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-lg font-bold">Sales</h2>
            <p className="text-sm text-slate-600">From bills: PlantOps bills and the history imported from Zoho. Cancelled and opening-balance bills are left out.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            <li>
              <a href="/reports/sales/item" className="flex flex-wrap justify-between gap-2 py-3">
                <span className="font-semibold text-(--brand)">Sales by Item</span>
                <span className="text-sm text-slate-600">Quantity and sales per product</span>
              </a>
            </li>
            <li>
              <a href="/reports/sales/customer" className="flex flex-wrap justify-between gap-2 py-3">
                <span className="font-semibold text-(--brand)">Sales by Customer</span>
                <span className="text-sm text-slate-600">Bills and sales per customer</span>
              </a>
            </li>
          </ul>
          <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600">
            <b>Filters on every report:</b> period (month, quarter, financial year, custom) · break down by month or quarter · salesperson · place ·
            vehicle · group by salesperson, customer, place, vehicle or brand · before / with GST.
          </p>
        </section>
      </div>
    </div>
  );
}

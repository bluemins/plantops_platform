import { redirect } from "next/navigation";
import { REC_ABOUT, REC_KINDS, REC_TITLE } from "@/lib/receivables";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";

type Section = "sales" | "receivables";
const SECTIONS: { id: Section; name: string; title: string; about: string; reports: { href: string; name: string; about: string }[]; filters: string }[] = [
  {
    id: "sales",
    name: "Sales",
    title: "Sales",
    about: "From bills: PlantOps bills and the history imported from Zoho. Cancelled and opening-balance bills are left out.",
    reports: [
      { href: "/reports/sales/item", name: "Sales by Item", about: "Quantity and sales per product" },
      { href: "/reports/sales/customer", name: "Sales by Customer", about: "Bills and sales per customer" },
      { href: "/reports/order-payment", name: "Order to Payment", about: "Where each order stands: delivered, billed, paid (Board or List)" },
    ],
    filters:
      "period (month, quarter, financial year, custom) · break down by month or quarter · salesperson · place · vehicle · group by salesperson, customer, place, vehicle or brand · before / with GST.",
  },
  {
    id: "receivables",
    name: "Receivables",
    title: "Receivables",
    about:
      "What customers owe: PlantOps bills and payments, with the Zoho history up to 5 Nov 2026. Amounts with GST; opening balances count; cancelled bills and payments are left out.",
    reports: REC_KINDS.map((k) => ({ href: `/reports/receivables/${k}`, name: REC_TITLE[k], about: REC_ABOUT[k] })),
    filters:
      "period or “as of” a date (today, end of last month / quarter / financial year, custom) · age by due date or bill date · 15- or 30-day bands · salesperson · place · vehicle · group by.",
  },
];
const LATER = ["Payments received", "GST", "Stock", "Attendance & salary"];

/** Reports (mock-up 2): sections on the left, the chosen section's reports on the right. Owner. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  const user = await requirePageUser("/reports");
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const sec = SECTIONS.find((s) => s.id === sp.section) ?? SECTIONS[0]!;
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href={`${process.env.PLATFORM_URL ?? ""}/home?launcher=1`}>← Dashboard</BackLink>
      <h1 className="text-2xl font-bold">Reports</h1>
      <div className="flex flex-wrap gap-4">
        <nav aria-label="Report sections" className="flex w-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3 sm:w-60">
          <p className="px-2 py-1 text-xs font-bold tracking-wide text-slate-600">SECTIONS</p>
          {SECTIONS.map((s) =>
            s.id === sec.id ? (
              <span key={s.id} aria-current="page" className="flex justify-between rounded-lg bg-(--brand-soft) px-3 py-2 font-bold text-(--brand)">
                {s.name} <span className="text-sm">{s.reports.length}</span>
              </span>
            ) : (
              <a key={s.id} href={`/reports?section=${s.id}`} className="flex justify-between rounded-lg px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50">
                {s.name} <span className="text-sm text-slate-500">{s.reports.length}</span>
              </a>
            ),
          )}
          {LATER.map((s) => (
            <span key={s} className="flex justify-between px-3 py-2 text-slate-500">{s} <span className="text-xs">later</span></span>
          ))}
        </nav>
        <section className="min-w-0 flex-[999_1_480px] space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-lg font-bold">{sec.title}</h2>
            <p className="text-sm text-slate-600">{sec.about}</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {sec.reports.map((r) => (
              <li key={r.href}>
                <a href={r.href} className="flex flex-wrap justify-between gap-2 py-3">
                  <span className="font-semibold text-(--brand)">{r.name}</span>
                  <span className="text-sm text-slate-600">{r.about}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600">
            <b>Filters on every report:</b> {sec.filters}
          </p>
        </section>
      </div>
    </div>
  );
}

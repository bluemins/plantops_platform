import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { dropShops } from "@/server/drop/manage";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Owner (and support): the shops switched on for the Drop app, with the pilot's numbers (mock-up 4). */
export default async function DropShopsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/customers/drop");
  if (!can(user, "drop_shops")) redirect("/customers");
  const brand = one((await searchParams).brand).slice(0, 40);
  const [plant, data] = await Promise.all([kit.branding(user.tenantId), dropShops(user)]);
  const brands = [...new Set(data.shops.flatMap((s) => s.brands.slice(1)))].sort((a, b) => a.localeCompare(b));
  const shown = brand ? data.shops.filter((s) => s.brands.some((b) => b.toLowerCase() === brand.toLowerCase())) : data.shops;
  const box = "rounded-xl border border-slate-200 bg-white p-3";
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Drop shops</h1>
      {!data.set_up && <p className="text-sm text-slate-600">The Drop app isn&apos;t set up for this plant yet.</p>}
      <div className="grid grid-cols-3 gap-2">
        <div className={box}><p className="text-xl font-bold">{data.counts.on}</p><p className="text-xs text-slate-600">switched on</p></div>
        <div className={box}><p className="text-xl font-bold">{data.counts.logged_in}</p><p className="text-xs text-slate-600">logged in</p></div>
        <div className={box}><p className="text-xl font-bold">{data.counts.used_week}</p><p className="text-xs text-slate-600">used this week</p></div>
      </div>
      {brands.length > 0 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Brand">
          <a href="/customers/drop" className={`min-h-11 rounded-full px-3 py-2.5 font-semibold ${!brand ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-300 bg-white"}`}>All</a>
          {brands.map((b) => (
            <a key={b} href={`/customers/drop?brand=${encodeURIComponent(b)}`} className={`min-h-11 rounded-full px-3 py-2.5 font-semibold ${brand.toLowerCase() === b.toLowerCase() ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-300 bg-white"}`}>
              {b} ticked
            </a>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-slate-600">No shop is switched on yet. Switch a shop on from its customer page (Overview → Drop app).</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {shown.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <a href={`/customers/${s.id}`} className="font-semibold text-(--brand) hover:underline">{s.name}</a>
                <p className="text-xs text-slate-600">{s.place} · {s.phones} {s.phones === 1 ? "phone" : "phones"} · {s.brands.join(", ")}</p>
              </div>
              <p className={`shrink-0 text-right text-xs ${s.last_login ? "text-slate-600" : "font-semibold text-amber-800"}`}>
                {s.last_login ? <>Last login<br />{when(s.last_login)}</> : <>Never<br />logged in</>}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">Owner only. These numbers help judge the pilot.</p>
    </div>
  );
}

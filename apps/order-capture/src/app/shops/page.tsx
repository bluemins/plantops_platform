import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { shopSearch } from "@/server/customer-details";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Shop locations (docs/CUSTOMER_PAGE_PHASE_PLAN.md D6): find a customer, open their shop page, save / open the pin. No money. */
export default async function ShopsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/shops");
  if (!can(user, "location_view")) redirect("/");
  const q = one((await searchParams).q).slice(0, 100);
  const [plant, list] = await Promise.all([kit.branding(user.tenantId), shopSearch(user, q)]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={user.who === "delivery" ? "/calls" : "/"}>{user.who === "delivery" ? "← Calls" : "← Sales"}</BackLink>
      <h1 className="text-2xl font-bold">Shop locations</h1>
      <form method="get" className="flex gap-2">
        <label htmlFor="shop-q" className="sr-only">Name, place or phone</label>
        <input id="shop-q" name="q" defaultValue={q} placeholder="Name, place or phone" className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base" />
        <button className="min-h-12 shrink-0 rounded-xl border border-slate-300 bg-white px-4 font-semibold">Find</button>
      </form>
      {list.length === 0 && <p className="text-sm text-slate-500">No customer found.</p>}
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.id}>
            <a href={`/shops/${c.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block font-semibold break-words">{c.name}</span>
                <span className="block text-sm text-slate-500">{c.place} · {c.phone.slice(0, 5)} {c.phone.slice(5)}</span>
              </span>
              <span className={`shrink-0 text-sm font-semibold ${c.has_location ? "text-green-700" : "text-slate-400"}`}>{c.has_location ? "📍 Saved" : "No pin"}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

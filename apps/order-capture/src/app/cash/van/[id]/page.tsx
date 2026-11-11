import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { byBrand, vanDifferenceText, vanWhatsapp } from "@/lib/van";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { vanReport } from "@/server/van";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { CancelEntry } from "../../cash-forms";
import { longDay, shortDay } from "../../parts";
import { CopyWhatsapp } from "../van-parts";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const rs = (s: string) => signedMoney(paise(s));
const STATUS: Record<string, [string, string]> = {
  waiting: ["not posted yet", "bg-amber-100 text-amber-900"],
  posted: ["posted", "bg-green-100 text-green-800"],
  billed: ["billed", "bg-green-100 text-green-800"],
  turned_down: ["turned down", "bg-slate-200 text-slate-700"],
  void: ["cancelled", "bg-slate-200 text-slate-700"],
};

/** One van report (owner, Accounts; support reads): what was sold, credit, collections, cash handed in. */
export default async function VanReportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const user = await requirePageUser(`/cash/van/${id}`);
  if (!can(user, "cash_view")) redirect("/");
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect("/cash/van");
  const [plant, r] = await Promise.all([kit.branding(user.tenantId), vanReport(user, id)]);
  const saved = (await searchParams).saved === "1";
  const diff = paise(r.difference);
  const sales = r.lines.filter((l) => l.quantity > 0).map((l) => ({ product: l.product, brand: l.brand, quantity: l.quantity, rate: l.rate }));
  const text = vanWhatsapp({
    date: r.work_date,
    vehicle: r.vehicle,
    person: r.person,
    sales,
    not_paid: r.credits.map((c) => ({ name: c.customer.name, amount: c.amount })),
    collected: r.collected.map((c) => ({ name: c.customer.name, amount: c.amount, mode: c.mode })),
    online: r.online,
    meal: r.meal,
    tiffin: r.tiffin,
    diesel: r.diesel,
    toll: r.toll,
    handed_in: r.handed_in,
  });
  const row = (label: string, v: string, sign = "") => (paise(v) === 0n ? null : <p className="flex justify-between"><span>{sign}{label}</span><span>{rs(v)}</span></p>);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href={`/cash?d=${r.cash_date}`}>← Day sheet</BackLink>
      {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{r.ref} saved: {rs(r.handed_in)} into the cash book. Customer lines wait in To post.</p>}
      <div>
        <h1 className={`text-2xl font-bold ${r.cancelled ? "line-through" : ""}`}>{r.vehicle} · {longDay(r.work_date)}</h1>
        <p className="text-sm text-slate-600">{r.ref} · {r.person} · entered by {r.by}{r.cash_date !== r.work_date ? ` · cash on ${shortDay(r.cash_date)}` : ""}</p>
        {r.cancelled && <p className="text-sm text-red-700">Cancelled by {r.cancelled.by}: {r.cancelled.reason}</p>}
      </div>

      <Card className="space-y-1 text-sm">
        <p className="flex justify-between"><span>Sold</span><span>{rs(r.sales)}</span></p>
        {row("Not paid", r.not_paid, "− ")}
        {row("Collected (cash)", r.collected_cash, "+ ")}
        {row("Online", r.online, "− ")}
        {row("Meal", r.meal, "− ")}
        {row("Tiffin", r.tiffin, "− ")}
        {row("Diesel", r.diesel, "− ")}
        {row("Toll", r.toll, "− ")}
        <p className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Cash to hand in</span><span>{rs(r.expected)}</span></p>
        <p className="flex justify-between text-base font-bold"><span>Cash handed in</span><span>{rs(r.handed_in)}</span></p>
        <p className={`text-right font-semibold ${diff === 0n ? "text-green-700" : "text-red-700"}`}>{vanDifferenceText(paise(r.handed_in), paise(r.expected))}</p>
        {paise(r.collected_online) > 0n && <p className="text-xs text-slate-500">Collected online {rs(r.collected_online)} (not in the cash).</p>}
        {r.note && <p className="text-slate-600">Note: {r.note}</p>}
      </Card>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Sold by product</h2>
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm">
          {byBrand(sales).map((b) => (
            <li key={b.brand} className="px-4 py-2">
              <p className="flex justify-between font-semibold"><span>{b.brand}</span><span>{signedMoney(b.amount)}</span></p>
              {r.lines.filter((l) => l.brand === b.brand).map((l) => (
                <p key={l.product} className="flex justify-between text-slate-600">
                  <span className="min-w-0 break-words">{l.product}: {l.quantity} {l.unit} × {rs(l.rate)}{l.loaded !== null || l.returned !== null ? ` · loaded ${l.loaded ?? "—"}, returned ${l.returned ?? "—"}` : ""}</span>
                  <span className="shrink-0">{rs(l.amount)}</span>
                </p>
              ))}
            </li>
          ))}
          {sales.length === 0 && <li className="px-4 py-2 text-slate-500">No boxes sold.</li>}
        </ul>
      </section>

      {(r.credits.length > 0 || r.collected.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Customers</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm">
            {r.credits.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 px-4 py-2">
                <span className="min-w-0 break-words">{c.customer.name} · not paid <span className={`rounded px-1 font-semibold ${STATUS[c.status]![1]}`}>{c.status === "billed" ? `billed ${c.bill!.number}` : STATUS[c.status]![0]}</span></span>
                <span className="shrink-0">{rs(c.amount)}</span>
              </li>
            ))}
            {r.collected.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 px-4 py-2">
                <span className="min-w-0 break-words">{c.customer.name} · paid{c.mode === "upi" ? " online" : ""} <span className={`rounded px-1 font-semibold ${STATUS[c.status]![1]}`}>{c.status === "posted" ? `posted ${c.payment!.number}` : STATUS[c.status]![0]}</span></span>
                <span className="shrink-0">{rs(c.amount)}</span>
              </li>
            ))}
          </ul>
          <a href="/cash/post" className="text-sm font-semibold text-(--brand)">Go to To post →</a>
        </section>
      )}

      <CopyWhatsapp text={text} />
      {can(user, "cash_owner") && !r.cancelled && <CancelEntry id={r.entry_id} refText={r.ref} closed={false} />}
    </div>
  );
}

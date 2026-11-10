import { notFound, redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { GST_STATES } from "@plantops/types";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { vendorDetail } from "@/server/purchases";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink, BillBadge } from "../../../parts";
import { day, MODE, one, qty } from "../../parts";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [["bills", "Bills"], ["payments", "Payments"], ["items", "What we buy"]] as const;
type Tab = (typeof TABS)[number][0];

/** One vendor: details, bought / paid / owed, their bills, payments made and what is bought from them. */
export default async function VendorPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/purchases/vendors/${id}`);
  if (!can(user, "purchases_view")) redirect("/");
  const want = one((await searchParams).tab);
  const tab = (TABS.find(([k]) => k === want)?.[0] ?? "bills") as Tab;
  const [plant, d] = await Promise.all([kit.branding(user.tenantId), orNotFound(vendorDetail(user, id))]);
  const v = d.vendor;
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/purchases/vendors">← Vendors</BackLink>
      <h1 className="text-2xl font-bold break-words">{v.name}</h1>
      <Card className="space-y-1 text-sm">
        {v.company && <p>{v.company}</p>}
        {v.phone && <p><a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-(--brand)">{v.phone}</a></p>}
        {v.email && <p className="break-all">{v.email}</p>}
        <p className="text-slate-600">
          {v.gstin ? `GSTIN ${v.gstin}` : v.gst_treatment === "unregistered" ? "Not GST registered" : "No GSTIN"}
          {v.state ? ` · ${GST_STATES[v.state] ?? v.state}${v.state === plant?.gstin?.slice(0, 2) ? " (same state: CGST + SGST)" : " (other state: IGST)"}` : ""}
        </p>
        {v.address && <p className="text-slate-600">{v.address}</p>}
        <p className="text-slate-500">{v.terms ? `Terms: ${v.terms} · ` : ""}{v.from_zoho ? "From Zoho" : "Added here"}{v.active ? "" : " · switched off"}</p>
      </Card>
      <Card className="grid grid-cols-3 gap-3">
        <div><p className="text-xs text-slate-500">Bought</p><p className="text-lg font-bold">{money(d.totals.billed)}</p></div>
        <div><p className="text-xs text-slate-500">Paid</p><p className="text-lg font-bold">{money(d.totals.paid)}</p></div>
        <div>
          <p className="text-xs text-slate-500">{d.totals.balance.startsWith("-") ? "Advance" : "You owe"}</p>
          <p className={`text-lg font-bold ${d.totals.balance !== "0.00" ? "text-amber-700" : ""}`}>{money(d.totals.balance.replace("-", ""))}</p>
          {d.totals.overdue !== "0.00" && <p className="text-xs text-red-700">{money(d.totals.overdue)} overdue</p>}
        </div>
      </Card>

      <nav aria-label="Vendor" className="flex gap-4 text-sm font-semibold">
        {TABS.map(([k, label]) =>
          k === tab ? <span key={k} className="border-b-2 border-(--brand) pb-1">{label}</span> : <a key={k} href={`/purchases/vendors/${id}?tab=${k}`} className="pb-1 text-slate-600">{label}</a>,
        )}
      </nav>

      {tab === "bills" && (
        <ul className="space-y-2">
          {d.bills.length === 0 && <p className="text-sm text-slate-500">No bills from this vendor.</p>}
          {d.bills.map((b) => (
            <li key={b.id}>
              <a href={`/purchases/bills/${b.id}`} className={`flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 ${b.cancelled ? "opacity-60" : ""}`}>
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">{b.number}{b.po_number ? ` · ${b.po_number}` : ""}</span>
                  <span className="block text-slate-500">{day(b.bill_date)} · {b.lines} {b.lines === 1 ? "item" : "items"}{b.source === "zoho" ? " · Zoho" : ""}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold">{money(b.total)}</span>
                  <BillBadge status={b.status} due={money(b.due)} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {tab === "payments" && (
        <ul className="space-y-2">
          {d.payments.length === 0 && <p className="text-sm text-slate-500">No payments to this vendor.</p>}
          {d.payments.map((p) => (
            <li key={p.id} className={`flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm ${p.cancelled ? "opacity-60" : ""}`}>
              <span className="min-w-0">
                <span className="block font-semibold">{p.number}{p.source === "zoho" ? " · Zoho" : ""}{p.cancelled ? " · cancelled" : ""}</span>
                <span className="block text-slate-500">{day(p.date)} · {MODE[p.mode] ?? p.mode}{p.paid_from ? ` from ${p.paid_from}` : ""}{p.reference ? ` · ${p.reference}` : ""}</span>
              </span>
              <span className="shrink-0 font-semibold">{money(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {tab === "items" && (
        <Card className="space-y-2">
          {d.items.length === 0 && <p className="text-sm text-slate-500">Nothing bought yet.</p>}
          {d.items.map((i) => (
            <div key={i.item} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{i.item}<span className="block text-slate-500">{qty(i.quantity)}{i.unit ? ` ${i.unit}` : ""} · last {day(i.last)}</span></span>
              <span className="shrink-0">{money(i.amount)}</span>
            </div>
          ))}
          {d.items.length > 0 && <p className="text-xs text-slate-500">Before GST, all bills not cancelled.</p>}
        </Card>
      )}
    </div>
  );
}

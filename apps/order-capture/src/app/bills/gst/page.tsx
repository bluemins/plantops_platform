import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { gstQueue, type GstQueue } from "@/server/bill-make";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { GstInvoice } from "../../ledger-forms";
import { SectionTabs } from "../../parts";
import { ZohoDownload } from "./zoho-download";

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const sum = (xs: GstQueue["not_sent"], k: "taxable" | "tax" | "total") => xs.reduce((s, b) => s + Number(b[k]), 0).toFixed(2);

type Row = GstQueue["not_sent"][number];

function BillRow({ b, children }: { b: Row; children?: React.ReactNode }) {
  const split = Number(b.igst) > 0 ? `IGST ${money(b.igst)}` : `CGST ${money(b.cgst)} · SGST ${money(b.sgst)}`;
  return (
    <li className="space-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <a href={`/bills/${b.id}`} className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-semibold break-words">{b.number} · {b.customer}</span>
          {b.bill_to && b.bill_to !== b.customer && <span className="block text-sm text-slate-600">Zoho: {b.bill_to}</span>}
          <span className="block text-sm text-slate-500">{day(b.bill_date)}{b.gstin ? ` · GSTIN ${b.gstin}` : " · no GSTIN (consumer)"}</span>
        </span>
        <span className="shrink-0 text-right font-semibold">{money(b.total)}</span>
      </a>
      <p className="text-sm text-slate-600">
        Taxable {money(b.taxable)} · {split}{b.place ? ` · ${b.place}` : ""}{b.inclusive ? " · rates incl. GST" : " · GST on top"}
      </p>
      {children}
    </li>
  );
}

/** Owner, Accounts (support reads): every bill ticked "Needs GST invoice", in one place, and the file for Zoho. */
export default async function GstInvoicesPage() {
  const user = await requirePageUser("/bills/gst");
  if (!can(user, "ledger_view")) redirect("/");
  const [plant, q, waiting] = await Promise.all([kit.branding(user.tenantId), gstQueue(user), waitingCount(user)]);
  const canSend = can(user, "bill_make");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="bills" waiting={waiting} bills purchases={can(user, "purchases_view")} calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
      <nav aria-label="Bills, payments or GST invoices" className="flex flex-wrap gap-4 text-sm font-semibold">
        <a href="/bills" className="pb-1 text-slate-600">Bills</a>
        <a href="/payments" className="pb-1 text-slate-600">Payments</a>
        <span className="border-b-2 border-(--brand) pb-1">GST invoices to make · {q.not_sent.length + q.sent.length}</span>
      </nav>

      <Card className="space-y-3">
        <h1 className="text-lg font-semibold">{q.not_sent.length === 1 ? "1 bill waits" : `${q.not_sent.length} bills wait`} for a GST invoice</h1>
        {q.not_sent.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-xs text-slate-500">Taxable</p><p className="font-semibold">{money(sum(q.not_sent, "taxable"))}</p></div>
            <div><p className="text-xs text-slate-500">GST</p><p className="font-semibold">{money(sum(q.not_sent, "tax"))}</p></div>
            <div><p className="text-xs text-slate-500">Total</p><p className="font-semibold">{money(sum(q.not_sent, "total"))}</p></div>
          </div>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Check the bills below, then download the file for Zoho.</li>
          <li>In Zoho Books: Sales → Invoices → Import invoices → pick the file. They come in as drafts to check and send.</li>
          <li>Type each Zoho INV number on its bill below (or on the bill&apos;s page).</li>
        </ol>
        {canSend && <ZohoDownload which="new" count={q.not_sent.length} label={`Download for Zoho (${q.not_sent.length} ${q.not_sent.length === 1 ? "bill" : "bills"})`} />}
      </Card>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-600">NOT SENT YET</h2>
        {q.not_sent.length === 0 && <p className="text-sm text-slate-500">Nothing waiting. Bills ticked "Needs GST invoice" show here.</p>}
        <ul className="space-y-2">{q.not_sent.map((b) => <BillRow key={b.id} b={b} />)}</ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-600">SENT · WAITING FOR THE INV NO.</h2>
        {q.sent.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <ul className="space-y-2">
          {q.sent.map((b) => (
            <BillRow key={b.id} b={b}>
              <p className="text-xs text-slate-500">Downloaded {when(b.sent_at!)} by {b.sent_by}</p>
              {canSend && <GstInvoice billId={b.id} value={null} />}
            </BillRow>
          ))}
        </ul>
        {canSend && q.sent.length > 0 && <ZohoDownload which="again" count={q.sent.length} label="Download the sent ones again" />}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-600">DONE (LATEST 30)</h2>
        {q.done.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <ul className="space-y-2">
          {q.done.map((b) => (
            <li key={b.id}>
              <a href={`/bills/${b.id}`} className="flex justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                <span><b>{b.number}</b> · {b.customer} → {b.invoice_no}</span>
                <span className="rounded-full bg-green-50 px-2 text-xs font-semibold text-green-800">GST invoice made</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

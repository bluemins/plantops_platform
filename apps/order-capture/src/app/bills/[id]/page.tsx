import { notFound, redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { GST_STATES } from "@plantops/types";
import { TERMS_LABEL, type BillTerms } from "@/lib/ledger";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { billDetail } from "@/server/ledger";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { CancelWithReason, GstInvoice, PrintButton } from "../../ledger-forms";
import { BackLink, BillBadge } from "../../parts";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const qty = (q: string) => Number(q).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank", cheque: "Cheque", other: "Other" };

/** One bill: lines, totals, what was paid on it, its order and Zoho GST invoice no. (owner, Accounts, support; Marketing staff
 * read it from a customer's page). */
export default async function BillPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/bills/${id}`);
  if (!can(user, "account_view")) redirect("/");
  const [plant, b] = await Promise.all([kit.branding(user.tenantId), orNotFound(billDetail(user, id))]);
  const partyHref = b.party ? (b.party.kind === "customer" ? `/customers/${b.party.id}` : `/customers/z/${b.party.id}`) : null;
  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="print:hidden">{can(user, "ledger_view") || !partyHref ? <BackLink href="/bills">← Bills</BackLink> : <BackLink href={partyHref}>← {b.party!.name}</BackLink>}</div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Bill {b.number}</h1>
        <BillBadge status={b.status} due={money(b.due)} />
      </div>
      <p className="text-sm text-slate-600">
        {plant?.name} · {b.opening_balance ? "Opening balance from Zoho" : b.source === "zoho" ? "Imported from Zoho" : `Made by ${b.created_by}`} · {day(b.bill_date)}
        {b.due_date ? ` · due ${day(b.due_date)}` : ""}{b.terms ? ` (${TERMS_LABEL[b.terms as BillTerms]})` : ""}
      </p>

      <Card className="space-y-1">
        <p className="text-sm text-slate-500">Bill to</p>
        {partyHref ? <a href={partyHref} className="text-lg font-semibold text-(--brand)">{b.party!.name}</a> : <p className="text-lg font-semibold">{b.customer_name}</p>}
        {b.party?.kind === "contact" && <p className="text-xs text-amber-800">Zoho contact not matched to a customer yet.</p>}
        {b.order && <p className="text-sm">Order {can(user, "read") ? <a href={`/o/${b.order.id}`} className="font-semibold text-(--brand)">{b.order.ref}</a> : <b>{b.order.ref}</b>}</p>}
        {b.gst?.bill_to_name && (
          <p className="text-sm">
            GST invoice to <b>{b.gst.bill_to_name}</b>
            {b.gst.bill_to_address ? <span className="text-slate-600">, {b.gst.bill_to_address}</span> : null}
          </p>
        )}
        {b.gst && (
          <p className="text-sm text-slate-600">
            {b.gst.gstin ? `GSTIN ${b.gst.gstin}` : b.gst.treatment === "unregistered" ? "No GSTIN (unregistered business)" : "No GSTIN (consumer)"}{b.gst.place ? ` · Place of supply: ${GST_STATES[b.gst.place] ?? ""} (${b.gst.place})` : ""}
          </p>
        )}
        {(b.salesperson || b.vehicle || b.reference_no) && (
          <p className="text-sm text-slate-600">
            {[b.salesperson && `Salesperson: ${b.salesperson}`, b.vehicle && `Vehicle: ${b.vehicle}`, b.reference_no && `Reference: ${b.reference_no}`].filter(Boolean).join(" · ")}
          </p>
        )}
      </Card>

      <Card className="space-y-2">
        {b.lines.length === 0 && <p className="text-sm text-slate-500">{b.opening_balance ? "What the customer owed before Zoho." : "No lines."}</p>}
        {b.lines.map((l) => (
          <div key={l.line_no} className="flex justify-between gap-3 text-sm">
            <span className="break-words">
              {l.item}{l.description ? ` (${l.description})` : ""} · {qty(l.quantity)}{l.unit ? ` ${l.unit}` : ""} × {money(l.rate)}
              {l.tax ? <span className="text-slate-500"> · {l.tax} {money(l.tax_amount)}</span> : null}
              {l.hsn ? <span className="text-slate-500"> · HSN {l.hsn}</span> : null}
            </span>
            <span className="shrink-0">{money(l.total)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t border-slate-200 pt-2 text-sm">
          {(b.discount !== "0.00" || b.adjustment !== "0.00" || b.tax_total !== "0.00") && (
            <div className="flex justify-between"><span>Sub-total</span><span>{money(b.sub_total)}</span></div>
          )}
          {b.discount !== "0.00" && <div className="flex justify-between"><span>Discount</span><span>−{money(b.discount)}</span></div>}
          {b.gst ? (
            <>
              {b.gst.cgst !== "0.00" && <div className="flex justify-between"><span>CGST</span><span>{money(b.gst.cgst)}</span></div>}
              {b.gst.sgst !== "0.00" && <div className="flex justify-between"><span>SGST</span><span>{money(b.gst.sgst)}</span></div>}
              {b.gst.igst !== "0.00" && <div className="flex justify-between"><span>IGST</span><span>{money(b.gst.igst)}</span></div>}
              {b.gst.inclusive && <p className="text-xs text-slate-500">Rates include GST: the GST above is inside the total.</p>}
            </>
          ) : (
            b.tax_total !== "0.00" && <div className="flex justify-between"><span>Tax</span><span>{money(b.tax_total)}</span></div>
          )}
          {b.adjustment !== "0.00" && <div className="flex justify-between"><span>Adjustment</span><span>{b.adjustment.startsWith("-") ? "−" : ""}{money(b.adjustment.replace("-", ""))}</span></div>}
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(b.total)}</span></div>
          {b.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-slate-600">
              <span>{p.amount.startsWith("-") ? "Undone: payment" : "Paid:"} {p.number} · {MODE[p.mode] ?? p.mode} · {day(p.date)}</span>
              <span>{p.amount.startsWith("-") ? "+" : "−"}{money(p.amount.replace("-", ""))}</span>
            </div>
          ))}
          {b.adjustments.map((x, i) => (
            <div key={`a${i}`} className="flex justify-between text-slate-600"><span>Settled: {x.reason} · {day(x.date)}</span><span>−{money(x.amount)}</span></div>
          ))}
          <div className="flex justify-between font-semibold"><span>Still due</span><span>{money(b.due)}</span></div>
        </div>
        {b.notes && <p className="text-sm text-slate-600 whitespace-pre-line">{b.notes}</p>}
        <p className="text-xs text-slate-500">
          A bill (statement of account), not a tax invoice.
          {b.gst_invoice_no ? ` GST invoice in Zoho: ${b.gst_invoice_no}.` : b.gst ? (b.gst.sent_at ? ` GST invoice: sent to Zoho by ${b.gst.sent_by}, waiting for the INV no.` : " GST invoice: waiting in Bills → GST invoices to make.") : ""}
        </p>
        {b.private_note && can(user, "bill_make") && <p className="text-xs text-slate-500 print:hidden">Private note: {b.private_note}</p>}
      </Card>

      {b.cancelled && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">Cancelled by {b.cancelled.by}: {b.cancelled.reason}</p>
      )}
      {!b.cancelled && b.source === "plantops" && can(user, "bill_make") && (
        <div className="print:hidden"><GstInvoice billId={b.id} value={b.gst_invoice_no} /></div>
      )}
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton />
        {partyHref && b.party?.kind === "customer" && !b.cancelled && b.due !== "0.00" && can(user, "payment_receive") && (
          <a href={`${partyHref}?tab=bills`} className="min-h-10 text-sm font-semibold text-(--brand)">Receive payment →</a>
        )}
      </div>
      {!b.cancelled && can(user, "bill_cancel") && (
        <div className="print:hidden">
          <CancelWithReason url={`/api/bills/${b.id}/cancel`} what="bill" effect="What was paid on it goes back to those payments as the customer's advance; the order can get a new bill." />
        </div>
      )}
    </div>
  );
}

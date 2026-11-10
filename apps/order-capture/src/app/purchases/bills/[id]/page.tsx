import { notFound, redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { purchaseBillDetail } from "@/server/purchases";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { CancelWithReason } from "../../../ledger-forms";
import { BackLink, BillBadge } from "../../../parts";
import { day, MODE, qty } from "../../parts";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signed = (s: string) => `${s.startsWith("-") ? "−" : ""}${money(s.replace("-", ""))}`;

/** One purchase bill: vendor, lines with GST, totals, what was paid on it (owner, Accounts, support). */
export default async function PurchaseBillPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/purchases/bills/${id}`);
  if (!can(user, "purchases_view")) redirect("/");
  const [plant, b] = await Promise.all([kit.branding(user.tenantId), orNotFound(purchaseBillDetail(user, id))]);
  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="print:hidden"><BackLink href="/purchases">← Purchase bills</BackLink></div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Purchase bill {b.number}</h1>
        <BillBadge status={b.status} due={money(b.due)} />
      </div>
      <p className="text-sm text-slate-600">
        {b.source === "zoho" ? "Imported from Zoho" : `Entered by ${b.created_by}`} · {day(b.bill_date)}{b.due_date && b.due_date !== b.bill_date ? ` · due ${day(b.due_date)}` : ""}
      </p>

      <Card className="space-y-1">
        <p className="text-sm text-slate-500">From</p>
        <a href={`/purchases/vendors/${b.vendor.id}`} className="text-lg font-semibold text-(--brand)">{b.vendor.name}</a>
        {b.vendor.gstin && <p className="text-sm text-slate-600">GSTIN {b.vendor.gstin}</p>}
        {(b.vendor_invoice_no || b.po_number) && (
          <p className="text-sm text-slate-600">{[b.vendor_invoice_no && `Vendor's invoice: ${b.vendor_invoice_no}`, b.po_number && `PO: ${b.po_number}`].filter(Boolean).join(" · ")}</p>
        )}
      </Card>

      <Card className="space-y-2">
        {b.lines.length === 0 && <p className="text-sm text-slate-500">No lines.</p>}
        {b.lines.map((l) => (
          <div key={l.line_no} className="flex justify-between gap-3 text-sm">
            <span className="break-words">
              {l.item}{l.description ? ` (${l.description})` : ""} · {qty(l.quantity)}{l.unit ? ` ${l.unit}` : ""} × {money(l.rate)}
              {l.discount !== "0.00" ? <span className="text-slate-500"> · discount {money(l.discount)}</span> : null}
              {l.tax ? <span className="text-slate-500"> · {l.tax} {money(l.tax_amount)}</span> : null}
              {l.hsn ? <span className="text-slate-500"> · HSN {l.hsn}</span> : null}
            </span>
            <span className="shrink-0">{money(l.total)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t border-slate-200 pt-2 text-sm">
          <div className="flex justify-between"><span>Sub-total</span><span>{money(b.sub_total)}</span></div>
          {b.discount !== "0.00" && <div className="flex justify-between"><span>Discount</span><span>−{money(b.discount)}</span></div>}
          {b.cgst !== "0.00" && <div className="flex justify-between"><span>CGST</span><span>{money(b.cgst)}</span></div>}
          {b.sgst !== "0.00" && <div className="flex justify-between"><span>SGST</span><span>{money(b.sgst)}</span></div>}
          {b.igst !== "0.00" && <div className="flex justify-between"><span>IGST</span><span>{money(b.igst)}</span></div>}
          {b.cgst === "0.00" && b.sgst === "0.00" && b.igst === "0.00" && b.tax_total !== "0.00" && <div className="flex justify-between"><span>GST</span><span>{money(b.tax_total)}</span></div>}
          {b.adjustment !== "0.00" && <div className="flex justify-between"><span>Rounding</span><span>{signed(b.adjustment)}</span></div>}
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(b.total)}</span></div>
          {b.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-slate-600">
              <span>{p.amount.startsWith("-") ? "Undone: payment" : "Paid:"} {p.number} · {MODE[p.mode] ?? p.mode}{p.paid_from ? ` from ${p.paid_from}` : ""} · {day(p.date)}</span>
              <span>{p.amount.startsWith("-") ? "+" : "−"}{money(p.amount.replace("-", ""))}</span>
            </div>
          ))}
          <div className="flex justify-between font-semibold"><span>Still to pay</span><span>{money(b.due)}</span></div>
        </div>
        {b.notes && <p className="text-sm whitespace-pre-line text-slate-600">{b.notes}</p>}
      </Card>

      {!b.cancelled && can(user, "purchase_cancel") && (
        <div className="print:hidden"><CancelWithReason url={`/api/purchases/bills/${b.id}/cancel`} what="purchase bill" effect="What was paid on it goes back to those payments as advance." /></div>
      )}
      {b.cancelled && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">Cancelled by {b.cancelled.by}: {b.cancelled.reason}</p>}
    </div>
  );
}

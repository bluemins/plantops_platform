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
import { BackLink, BillBadge, GstTag } from "../../../parts";
import { AddBillCopy } from "../../bill-copy";
import { PurchaseBillGst } from "../../forms";
import { day, MODE, qty } from "../../parts";

type Params = Promise<{ id: string }>;
type Search = Promise<{ copy?: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const at = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const signed = (s: string) => `${s.startsWith("-") ? "−" : ""}${money(s.replace("-", ""))}`;

/** One purchase bill: vendor, lines with GST, totals, what was paid on it (owner, Accounts, support). */
export default async function PurchaseBillPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const copyFailed = (await searchParams).copy === "failed";
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/purchases/bills/${id}`);
  if (!can(user, "purchases_view")) redirect("/");
  const [plant, b] = await Promise.all([kit.branding(user.tenantId), orNotFound(purchaseBillDetail(user, id))]);
  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="print:hidden"><BackLink href="/purchases">← Purchase bills</BackLink></div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Purchase bill {b.number}{b.gst_bill && <GstTag />}</h1>
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

      {(b.copies.length > 0 || (!b.cancelled && can(user, "purchase_enter"))) && (
        <Card className="space-y-3 print:hidden">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Bill copy</h2>
            {b.copies.length > 0 && <span className="text-xs text-slate-500">{b.copies.length} file{b.copies.length > 1 ? "s" : ""}</span>}
          </div>
          {b.copies.length === 0 && <p className="text-sm text-slate-500">No copy of the vendor&apos;s bill yet.</p>}
          {b.copies.some((f) => f.content_type.startsWith("image/")) && (
            <div className="flex flex-wrap gap-2">
              {b.copies.filter((f) => f.content_type.startsWith("image/")).map((f, i) => (
                <a key={f.id} href={`/purchase-bill-files/${f.id}`} target="_blank" rel="noopener" aria-label={`Open photo ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private file, served by this module */}
                  <img src={`/purchase-bill-files/${f.id}`} alt={`Bill copy photo ${i + 1}`} className="h-24 w-20 rounded-lg border border-slate-200 object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {b.copies.filter((f) => f.content_type === "application/pdf").map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0 break-words"><span className="font-semibold">{f.file_name ?? "Bill copy.pdf"}</span><span className="block text-xs text-slate-500">PDF · {kb(f.size)}</span></span>
              <span className="flex shrink-0 gap-3">
                <a href={`/purchase-bill-files/${f.id}`} target="_blank" rel="noopener" className="font-semibold text-(--brand)">Open</a>
                <a href={`/purchase-bill-files/${f.id}?download=1`} className="font-semibold text-(--brand)">Save</a>
              </span>
            </div>
          ))}
          {b.copies.length > 0 && <p className="text-xs text-slate-500">{b.copies.map((f) => `${f.content_type === "application/pdf" ? "PDF" : "Photo"} added by ${f.by} · ${at(f.at)}`).join(" · ")}</p>}
          {!b.cancelled && can(user, "purchase_enter") && <AddBillCopy billId={b.id} startOpen={copyFailed} failed={copyFailed} />}
          {b.copies.length > 0 && <p className="text-xs text-slate-500">Copies are kept with the bill and never deleted. Added the wrong file? Add the right one next to it.</p>}
        </Card>
      )}
      {!b.cancelled && can(user, "purchase_enter") && (
        <Card className="print:hidden"><PurchaseBillGst id={b.id} value={b.gst_bill} /></Card>
      )}
      {!b.cancelled && can(user, "purchase_cancel") && (
        <div className="print:hidden"><CancelWithReason url={`/api/purchases/bills/${b.id}/cancel`} what="purchase bill" effect="What was paid on it goes back to those payments as advance." /></div>
      )}
      {b.cancelled && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">Cancelled by {b.cancelled.by}: {b.cancelled.reason}</p>}
    </div>
  );
}

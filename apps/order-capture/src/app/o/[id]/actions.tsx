"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { api } from "@/lib/api";

type Order = { id: string; ref: string; status: "pending" | "delivered" | "cancelled"; version: number; summary: string };
type May = { deliver: boolean; change: boolean; cancel: boolean; undo: boolean };
type Open = "deliver" | "cancel" | "undo" | null;
/** The WhatsApp thank-you: offered when the plant has a Twilio sender; `already` = this order had one (never twice). */
type Thanks = { available: boolean; already: string | null; name: string; phone: string };

const area = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const input = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/**
 * The buttons this person may use on this order right now (the server checks again), and their panels. Every
 * action sends the status and version the page showed, so a change made meanwhile by someone else answers
 * "This order was just changed by …".
 */
export function OrderActions({ order, may, thanks }: { order: Order; may: May; thanks: Thanks }) {
  const [open, setOpen] = useState<Open>(null);
  const [note, setNote] = useState("");
  const [invoice, setInvoice] = useState("");
  const offerThanks = thanks.available && !thanks.already;
  const [sendThanks, setSendThanks] = useState(true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const expected = { status: order.status, version: order.version };

  if (!may.deliver && !may.change && !may.cancel && !may.undo) return null;

  async function send(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${order.id}/${path}`, { body: { expected, ...body } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }
  const close = () => {
    setOpen(null);
    setError(undefined);
  };

  if (open === "deliver") {
    return (
      <section aria-label="Mark order delivered" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-bold">Mark {order.ref} delivered?</h2>
        <p className="text-slate-600">Only when the whole order has been delivered: {order.summary}.</p>
        <label className="block text-sm font-semibold">
          Delivery note <span className="font-normal text-slate-500">(optional)</span>
          <textarea className={`${area} mt-1`} rows={3} maxLength={300} placeholder="e.g. handed to the manager" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Zoho invoice no. <span className="font-normal text-slate-500">(optional)</span>
          <input className={`${input} mt-1`} maxLength={40} placeholder="e.g. INV-001234" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </label>
        {offerThanks && (
          <label className="flex min-h-12 items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-3 text-green-950">
            <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-green-700" checked={sendThanks} onChange={(e) => setSendThanks(e.target.checked)} />
            <span>
              <span className="font-semibold">Send a WhatsApp thank-you</span> to <span className="break-words">{thanks.name}</span> (+91 {thanks.phone.slice(0, 5)} {thanks.phone.slice(5)})
            </span>
          </label>
        )}
        {thanks.available && thanks.already && <p className="text-sm text-slate-600">This order already had its WhatsApp thank-you ({fmtDateTime(thanks.already)}, see History). It is never sent twice.</p>}
        <ErrorText>{error}</ErrorText>
        <Button
          className="w-full min-h-14 text-lg"
          disabled={busy}
          onClick={() => send("deliver", { note: note.trim() || undefined, invoice_no: invoice.trim() || undefined, ...(offerThanks && sendThanks ? { send_thanks: true } : {}) })}
        >
          {busy ? "Saving…" : "Delivered"}
        </Button>
        <Button variant="secondary" className="w-full" onClick={close}>
          Not yet
        </Button>
      </section>
    );
  }

  if (open === "cancel" || open === "undo") {
    const cancel = open === "cancel";
    return (
      <section aria-label={cancel ? "Cancel order" : "Undo delivered"} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-bold">{cancel ? `Cancel ${order.ref}?` : `Undo "Delivered" for ${order.ref}?`}</h2>
        <p className="text-slate-600">{cancel ? "Cancelled is final: a cancelled order can't be opened again. Enter a new order if needed." : "The order goes back to Pending and can be changed or delivered again."}</p>
        <label className="block text-sm font-semibold">
          Reason
          <textarea className={`${area} mt-1`} rows={3} maxLength={300} placeholder={cancel ? "e.g. customer changed mind" : "e.g. marked by mistake"} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button variant={cancel ? "danger" : "primary"} className="w-full min-h-14 text-lg" disabled={busy || reason.trim().length < 3} onClick={() => send(cancel ? "cancel" : "undo-delivered", { reason: reason.trim() })}>
          {busy ? "Saving…" : cancel ? "Cancel order" : "Undo delivered"}
        </Button>
        <Button variant="secondary" className="w-full" onClick={close}>
          {cancel ? "Keep the order" : "Leave it delivered"}
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      {may.deliver && (
        <Button className="w-full min-h-14 text-lg" onClick={() => setOpen("deliver")}>
          Mark delivered
        </Button>
      )}
      {(may.change || may.cancel) && (
        <div className="grid grid-cols-2 gap-3">
          {may.change && (
            <a href={`/o/${order.id}/change`} className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-(--brand)">
              Change order
            </a>
          )}
          {may.cancel && (
            <Button variant="danger" onClick={() => setOpen("cancel")}>
              Cancel order
            </Button>
          )}
        </div>
      )}
      {may.undo && (
        <Button variant="secondary" className="w-full" onClick={() => setOpen("undo")}>
          Undo delivered
        </Button>
      )}
    </div>
  );
}

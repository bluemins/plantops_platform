"use client";

// Purchases P2 forms (owner + Accounts): vendor, purchase bill with live GST totals, pay vendor, a payment's real mode.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { GST_RATES, GST_STATES } from "@plantops/types";
import { api } from "@/lib/api";
import { paise, rupees } from "@/lib/ledger";
import { money } from "@/lib/money";
import { isIntraState, lineAmount, purchaseAmounts } from "@/lib/purchase-amounts";
import type { EntryChoices } from "@/server/purchase-entry";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";
const label = "block text-sm text-slate-700";
const MODES: [string, string][] = [["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"], ["cheque", "Cheque"], ["other", "Other"]];
const PAID_FROM = ["Petty Cash", "Cash in hand", "Bank account", "UPI"];
const STATES = Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1]));
const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const RATE = /^\d{1,9}(\.\d{1,2})?$/;

function PaidFromList() {
  return <datalist id="paid-from">{PAID_FROM.map((p) => <option key={p} value={p} />)}</datalist>;
}

// ---------- vendor ----------

export type VendorValues = {
  name: string; company: string; phone: string; email: string; gstin: string; state: string; address: string; terms: string; notes: string; active: boolean;
};
export const EMPTY_VENDOR: VendorValues = { name: "", company: "", phone: "", email: "", gstin: "", state: "", address: "", terms: "Due on Receipt", notes: "", active: true };

export function VendorForm({ id, values, back }: { id?: string; values: VendorValues; back?: string }) {
  const router = useRouter();
  const [v, setV] = useState(values);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof VendorValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    setError(undefined);
    const body = { ...v, state: v.gstin.trim() ? null : v.state || null };
    const r = await api<{ id: string }>(id ? `/api/purchases/vendors/${id}` : "/api/purchases/vendors", { method: id ? "PUT" : "POST", body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(back ?? `/purchases/vendors/${id ?? r.data.id}`);
    router.refresh();
  }
  return (
    <Card className="space-y-3">
      <label className={label}>Name *<input className={field} value={v.name} maxLength={200} onChange={set("name")} placeholder="e.g. Balaji Sales Sambalpur" /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>Phone<input className={field} value={v.phone} maxLength={30} inputMode="tel" onChange={set("phone")} /></label>
        <label className={label}>Email<input className={field} value={v.email} maxLength={200} inputMode="email" onChange={set("email")} /></label>
      </div>
      <label className={label}>GSTIN<input className={field} value={v.gstin} maxLength={20} onChange={set("gstin")} placeholder="15 characters; blank if not registered" /></label>
      {!v.gstin.trim() && (
        <label className={label}>State (decides CGST + SGST or IGST)
          <select className={field} value={v.state} onChange={set("state")}>
            <option value="">Same as the plant</option>
            {STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
          </select>
        </label>
      )}
      <label className={label}>Company / legal name<input className={field} value={v.company} maxLength={200} onChange={set("company")} /></label>
      <label className={label}>Address<input className={field} value={v.address} maxLength={500} onChange={set("address")} /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>Payment terms<input className={field} value={v.terms} maxLength={60} onChange={set("terms")} placeholder="Due on Receipt / 15 days" /></label>
        {id && (
          <label className={label}>Status
            <select className={field} value={v.active ? "on" : "off"} onChange={(e) => setV((x) => ({ ...x, active: e.target.value === "on" }))}>
              <option value="on">Switched on</option>
              <option value="off">Switched off (no new bills)</option>
            </select>
          </label>
        )}
      </div>
      <label className={label}>Notes<input className={field} value={v.notes} maxLength={1000} onChange={set("notes")} /></label>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full" disabled={busy || v.name.trim().length < 2} onClick={save}>{busy ? "Saving..." : id ? "Save vendor" : "Add vendor"}</Button>
    </Card>
  );
}

// ---------- purchase bill ----------

type Line = { item_id: string | null; item_name: string; quantity: string; unit: string; rate: string; gst_rate: number; hsn: string };
const emptyLine = (): Line => ({ item_id: null, item_name: "", quantity: "", unit: "", rate: "", gst_rate: 18, hsn: "" });

export function PurchaseBillForm({ choices, vendorId }: { choices: EntryChoices; vendorId?: string }) {
  const router = useRouter();
  const vendors = choices.vendors.filter((v) => v.active);
  const [vendor, setVendor] = useState(vendorId && vendors.some((v) => v.id === vendorId) ? vendorId : "");
  const [billDate, setBillDate] = useState(choices.today);
  const [dueDate, setDueDate] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [po, setPo] = useState("");
  const [notes, setNotes] = useState("");
  const [rounding, setRounding] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [paidNow, setPaidNow] = useState(false);
  const [mode, setMode] = useState("cash");
  const [paidFrom, setPaidFrom] = useState("Petty Cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const v = choices.vendors.find((x) => x.id === vendor);
  const intra = isIntraState(v?.state ?? null, choices.plant_state);
  const itemByName = useMemo(() => new Map(choices.items.map((i) => [i.name.toLowerCase(), i])), [choices.items]);
  const ready = lines.every((l) => l.item_name.trim() && QTY.test(l.quantity) && RATE.test(l.rate));
  const roundingOk = rounding === "" || /^-?\d{1,4}(\.\d{1,2})?$/.test(rounding);
  const totals = useMemo(() => {
    if (!ready || !roundingOk) return null;
    try {
      return purchaseAmounts(lines, rounding ? paise(rounding) : 0n, intra);
    } catch {
      return null;
    }
  }, [lines, rounding, intra, ready, roundingOk]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  function pickItem(i: number, name: string) {
    const it = itemByName.get(name.trim().toLowerCase());
    if (!it) return setLine(i, { item_name: name, item_id: null });
    setLine(i, {
      item_name: it.name,
      item_id: it.id,
      unit: lines[i]!.unit || it.unit || "",
      rate: lines[i]!.rate || (it.rate ? String(Number(it.rate)) : ""),
      gst_rate: it.gst_percent !== null ? Number(it.gst_percent) : lines[i]!.gst_rate,
      hsn: lines[i]!.hsn || it.hsn || "",
    });
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api<{ id: string }>("/api/purchases/bills", {
      body: {
        vendor_id: vendor,
        bill_date: billDate,
        due_date: dueDate || null,
        vendor_invoice_no: invoiceNo,
        po_number: po,
        notes,
        adjustment: rounding || "0",
        lines: lines.map((l) => ({ item_id: l.item_id, item_name: l.item_name, quantity: l.quantity, unit: l.unit, rate: l.rate, gst_rate: l.gst_rate, hsn: l.hsn })),
        paid_now: paidNow ? { mode, paid_from: paidFrom, reference } : null,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/purchases/bills/${r.data.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <label className={label}>Vendor *
          <select className={field} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">Pick the vendor</option>
            {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <p className="text-sm text-slate-500">
          Not in the list? <a href="/purchases/vendors/new?back=bill" className="font-semibold text-(--brand)">Add a vendor</a>
          {v ? ` · ${intra ? "CGST + SGST (same state)" : `IGST (${GST_STATES[v.state ?? ""] ?? "other state"})`}` : ""}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Bill date *<input type="date" className={field} value={billDate} max={choices.today} onChange={(e) => setBillDate(e.target.value)} /></label>
          <label className={label}>Due date<input type="date" className={field} value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>Vendor&apos;s invoice no.<input className={field} value={invoiceNo} maxLength={60} onChange={(e) => setInvoiceNo(e.target.value)} /></label>
          <label className={label}>PO no.<input className={field} value={po} maxLength={40} onChange={(e) => setPo(e.target.value)} /></label>
        </div>
      </Card>

      <datalist id="purchase-items">{choices.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
      {lines.map((l, i) => {
        const amt = QTY.test(l.quantity) && RATE.test(l.rate) ? lineAmount(l.quantity, l.rate) : null;
        return (
          <Card key={i} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Item {i + 1}</p>
              {lines.length > 1 && <button className="text-sm font-semibold text-red-700" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>Remove</button>}
            </div>
            <input className={field} list="purchase-items" value={l.item_name} maxLength={200} onChange={(e) => pickItem(i, e.target.value)} placeholder="Item (pick or type a new one)" />
            {l.item_name.trim() && !l.item_id && <p className="text-xs text-amber-800">New item: it will be added to your purchase items.</p>}
            <div className="grid grid-cols-3 gap-2">
              <label className={label}>Quantity<input className={field} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.trim() })} /></label>
              <label className={label}>Unit<input className={field} value={l.unit} maxLength={20} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="kg / pcs" /></label>
              <label className={label}>Rate ₹<input className={field} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value.trim() })} /></label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className={label}>GST %
                <select className={field} value={l.gst_rate} onChange={(e) => setLine(i, { gst_rate: Number(e.target.value) })}>
                  {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </label>
              <label className={label}>HSN<input className={field} value={l.hsn} maxLength={12} onChange={(e) => setLine(i, { hsn: e.target.value.trim() })} /></label>
              <div className="text-right text-sm"><span className="block text-slate-500">Amount</span><span className="text-lg font-semibold">{amt === null ? "—" : money(rupees(amt))}</span></div>
            </div>
          </Card>
        );
      })}
      <button className="min-h-11 w-full rounded-xl border border-dashed border-slate-400 text-sm font-semibold text-slate-700" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add another item</button>

      <Card className="space-y-2 text-sm">
        <div className="flex justify-between"><span>Sub-total (before GST)</span><span>{totals ? money(rupees(totals.sub_total)) : "—"}</span></div>
        {intra ? (
          <>
            <div className="flex justify-between"><span>CGST</span><span>{totals ? money(rupees(totals.cgst)) : "—"}</span></div>
            <div className="flex justify-between"><span>SGST</span><span>{totals ? money(rupees(totals.sgst)) : "—"}</span></div>
          </>
        ) : (
          <div className="flex justify-between"><span>IGST</span><span>{totals ? money(rupees(totals.igst)) : "—"}</span></div>
        )}
        <label className="flex items-center justify-between gap-3">
          <span>Rounding (as on the vendor&apos;s bill)</span>
          <input className="min-h-10 w-28 rounded-lg border border-slate-300 px-2 text-right" inputMode="decimal" value={rounding} placeholder="0.00" onChange={(e) => setRounding(e.target.value.trim())} />
        </label>
        <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{totals ? money(rupees(totals.total)) : "—"}</span></div>
        <p className="text-xs text-slate-500">Check this total against the vendor&apos;s bill before saving.</p>
      </Card>

      <Card className="space-y-3">
        <label className="flex items-center gap-3 text-base font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> Paid now (in full)
        </label>
        {paidNow && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={label}>Mode<select className={field} value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label className={label}>Paid from<input className={field} list="paid-from" value={paidFrom} maxLength={100} onChange={(e) => setPaidFrom(e.target.value)} /></label>
            <label className={label}>Reference<input className={field} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." /></label>
            <PaidFromList />
          </div>
        )}
        <label className={label}>Note<input className={field} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button className="w-full" disabled={busy || !vendor || !totals || totals.total <= 0n} onClick={save}>{busy ? "Saving..." : `Save purchase bill${totals ? ` · ${money(rupees(totals.total))}` : ""}`}</Button>
    </div>
  );
}

// ---------- pay vendor ----------

export function PayVendor({ vendorId, openBills, today }: { vendorId: string; openBills: { id: string; number: string; bill_date: string; due: string }[]; today: string }) {
  const router = useRouter();
  const owed = openBills.reduce((a, b) => a + paise(b.due), 0n);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(owed > 0n ? rupees(owed) : "");
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState("cash");
  const [paidFrom, setPaidFrom] = useState("Petty Cash");
  const [reference, setReference] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api("/api/purchases/payments", { body: { vendor_id: vendorId, payment_date: date, amount, mode, paid_from: paidFrom, reference, bill_ids: ticked } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open) return <Button className="w-full" onClick={() => setOpen(true)}>Pay vendor{owed > 0n ? ` · ${money(rupees(owed))} to pay` : ""}</Button>;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Pay vendor</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Amount ₹<input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></label>
        <label className={label}>Date<input type="date" className={field} value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className={label}>Mode<select className={field} value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className={label}>Paid from<input className={field} list="paid-from" value={paidFrom} maxLength={100} onChange={(e) => setPaidFrom(e.target.value)} /></label>
      </div>
      <label className={label}>Reference<input className={field} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." /></label>
      <PaidFromList />
      {openBills.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-slate-600">For which bills? None ticked = the oldest first. More than the bills = advance for the next bill.</p>
          {openBills.map((b) => (
            <label key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={ticked.includes(b.id)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, b.id] : t.filter((x) => x !== b.id)))} />
                {b.number} · {b.bill_date}
              </span>
              <span>{money(b.due)}</span>
            </label>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={busy || !RATE.test(amount) || paise(amount) <= 0n} onClick={save}>{busy ? "Saving..." : `Pay ${RATE.test(amount) ? money(amount) : ""}`}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </Card>
  );
}

// ---------- a payment's real mode ----------

export function PaymentMode({ id, mode, paidFrom }: { id: string; mode: string; paidFrom: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(mode);
  const [f, setF] = useState(paidFrom ?? "");
  const [error, setError] = useState<string>();
  async function save() {
    setError(undefined);
    const r = await api(`/api/purchases/payments/${id}/mode`, { body: { mode: m, paid_from: f } });
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open) return <button className="text-sm font-semibold text-(--brand)" onClick={() => setOpen(true)}>Change mode</button>;
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select className={field} value={m} onChange={(e) => setM(e.target.value)}>{MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <input className={field} list="paid-from" value={f} maxLength={100} onChange={(e) => setF(e.target.value)} placeholder="Paid from" />
      </div>
      <PaidFromList />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button onClick={save}>Save</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
      </div>
    </div>
  );
}

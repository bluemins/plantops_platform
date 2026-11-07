"use client";

// The sales ledger's forms (docs/ZOHO_IMPORT_PHASE_PLAN.md section 6): Receive payment, Make bill, cancel a bill or a
// payment with a reason, the Zoho GST invoice no., Print. The server checks everything again.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { BILL_TERMS, billAmounts, dueFromTerms, paise, rupees, TERMS_LABEL, type BillAmounts, type BillTerms } from "@/lib/ledger";
import { money } from "@/lib/money";
import type { BillForm } from "@/server/bill-make";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const MODES: [string, string][] = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["bank", "Bank"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

/** Receive a payment: oldest bills first, or only the ticked ones; what is left stays as advance. */
export function ReceivePayment({ customerId, openBills, today }: { customerId: string; openBills: { id: string; number: string; bill_date: string; due: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: "", payment_date: today, mode: "cash", reference: "", note: "" });
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const totalDue = openBills.reduce((s, b) => s + Number(b.due), 0);

  async function save() {
    setError(undefined);
    if (!AMOUNT.test(f.amount.trim()) || Number(f.amount) <= 0) return setError("Amount: rupees, e.g. 500 or 1250.50");
    setBusy(true);
    const r = await api<{ number: string; bills: string[]; advance: string }>("/api/payments", {
      body: { customer_id: customerId, ...f, amount: f.amount.trim(), reference: f.reference || undefined, note: f.note || undefined, bill_ids: ticked },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(`${r.data.number} saved. ${r.data.bills.length ? `Paid ${r.data.bills.join(", ")}.` : ""}${r.data.advance !== "0.00" ? ` ${money(r.data.advance)} kept as advance.` : ""}`);
    setOpen(false);
    setF({ amount: "", payment_date: today, mode: "cash", reference: "", note: "" });
    setTicked([]);
    router.refresh();
  }

  if (!open)
    return (
      <div className="space-y-2">
        {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
        <Button variant="secondary" className="w-full" onClick={() => { setDone(undefined); setOpen(true); }}>Receive payment</Button>
      </div>
    );
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Receive payment</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Amount ₹</span>
          <input className={field} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={totalDue ? String(totalDue) : "0"} />
        </label>
        <label className="block">
          <span className={label}>Date</span>
          <input className={field} type="date" max={today} value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>Mode</span>
          <select className={field} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Reference (optional)</span>
          <input className={field} value={f.reference} maxLength={100} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UPI ref, cheque no." />
        </label>
      </div>
      <label className="block">
        <span className={label}>Note (optional)</span>
        <input className={field} value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      {openBills.length > 0 && (
        <fieldset className="space-y-1">
          <legend className={label}>Pays (none ticked = oldest bills first)</legend>
          {openBills.map((b) => (
            <label key={b.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={ticked.includes(b.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, b.id] : ticked.filter((x) => x !== b.id))} />
              {b.number} · {b.bill_date} · due {money(b.due)}
            </label>
          ))}
        </fieldset>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save payment"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

const SIGNED = /^-?\d{1,7}(\.\d{1,2})?$/;
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).replace(/\//g, "-");

/**
 * Make the bill of a delivered order (mock-ups 1–3, docs/BILL_FIELDS_PHASE_PLAN.md): bill date, terms, salesperson,
 * vehicle, "Needs GST invoice" (ticked when the customer has a GSTIN), a description per line, discount; the rest under
 * "Show all fields". The totals are worked out here with the same rules the server uses (src/lib/ledger.ts).
 */
export function MakeBill({ form }: { form: BillForm }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [f, setF] = useState({
    bill_date: form.today,
    terms: form.settings.default_terms as BillTerms,
    salesperson_id: form.last.salesperson_id ?? "",
    vehicle: form.last.vehicle ?? "",
    needs_gst: !!form.customer.gstin,
    gstin: form.customer.gstin ?? "",
    place: form.customer.state_code ?? (form.customer.gstin ? form.customer.gstin.slice(0, 2) : form.plant_state ?? "21"),
    inclusive: form.settings.rates_include_gst,
    discount: "",
    adjustment: "",
    reference_no: "",
    notes: form.settings.default_notes ?? "",
    private_note: "",
    zoho_no: "",
    // GST details (D8): the legal name and address Zoho bills to; the calling name stays on everything else
    legal_name: form.customer.legal_name ?? form.customer.name,
    gst_treatment: (form.customer.gst_treatment ?? "") as string,
    billing_address: form.customer.billing_address ?? "",
    billing_city: form.customer.billing_city ?? "",
    billing_pin: form.customer.billing_pin ?? "",
  });
  const [lines, setLines] = useState(form.lines.map((l) => ({ line_no: l.line_no, description: "", discount: "", pct: false })));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const lineDiscount = (amount: bigint, x: (typeof lines)[number]) => {
    const t = x.discount.trim();
    if (!t || !AMOUNT.test(t)) return 0n;
    return x.pct ? (amount * BigInt(Math.round(Number(t) * 100)) + 5000n) / 10000n : paise(t);
  };
  const missingRate = f.needs_gst ? form.lines.filter((l) => l.gst_rate === null).map((l) => l.name) : [];
  let calc: BillAmounts | null = null;
  let calcError: string | null = null;
  try {
    if (f.discount.trim() && !AMOUNT.test(f.discount.trim())) throw new Error("Discount: rupees, e.g. 20");
    if (f.adjustment.trim() && !SIGNED.test(f.adjustment.trim())) throw new Error("Adjustment: rupees, e.g. -0.40");
    calc = billAmounts(
      form.lines.map((l, i) => ({ amount: paise(l.amount), discount: lineDiscount(paise(l.amount), lines[i]!), gst_rate: l.gst_rate })),
      f.discount.trim() ? paise(f.discount.trim()) : 0n,
      f.adjustment.trim() ? paise(f.adjustment.trim()) : 0n,
      f.needs_gst && form.plant_state ? { inclusive: f.inclusive, intra: f.place === form.plant_state } : null,
    );
  } catch (e) {
    calcError = (e as Error).message;
  }
  const due = dueFromTerms(f.bill_date || form.today, f.terms);
  const intra = f.place === form.plant_state;

  async function save() {
    setError(undefined);
    if (calcError) return setError(calcError);
    setBusy(true);
    const r = await api<{ id: string }>("/api/bills", {
      body: {
        order_id: form.order.id,
        bill_date: f.bill_date,
        terms: f.terms,
        salesperson_id: f.salesperson_id || null,
        vehicle: f.vehicle.trim() || undefined,
        reference_no: f.reference_no.trim() || undefined,
        notes: f.notes.trim(),
        private_note: f.private_note.trim() || undefined,
        discount: f.discount.trim() || undefined,
        adjustment: f.adjustment.trim() || undefined,
        needs_gst: f.needs_gst,
        ...(f.needs_gst
          ? {
              gstin: f.gstin.trim() || undefined,
              place_of_supply: f.place,
              tax_inclusive: f.inclusive,
              legal_name: f.legal_name.trim(),
              ...(f.gstin.trim() ? {} : { gst_treatment: f.gst_treatment === "unregistered" ? "unregistered" : "consumer" }),
              billing_address: f.billing_address.trim(),
              billing_city: f.billing_city.trim(),
              billing_pin: f.billing_pin.trim(),
            }
          : {}),
        lines: lines
          .filter((x) => x.description.trim() || x.discount.trim())
          .map((x) => ({
            line_no: x.line_no,
            description: x.description.trim() || undefined,
            ...(x.discount.trim() ? (x.pct ? { discount_pct: Number(x.discount) } : { discount: x.discount.trim() }) : {}),
          })),
        zoho_gst_invoice_no: f.zoho_no.trim() || undefined,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/bills/${r.data.id}`);
  }

  if (!open) return <Button className="w-full" onClick={() => setOpen(true)}>Make bill</Button>;
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Make bill</h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Bill date</span>
          <input className={field} type="date" min={form.order.delivered_on} max={form.today} value={f.bill_date} onChange={set("bill_date")} />
        </label>
        <label className="block">
          <span className={label}>Terms</span>
          <select className={field} value={f.terms} onChange={set("terms")}>
            {BILL_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABEL[t]}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm text-slate-600">Due date: <b>{fmtDay(due)}</b> (from the terms)</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Salesperson</span>
          <select className={field} value={f.salesperson_id} onChange={set("salesperson_id")}>
            <option value="">None</option>
            {form.salespeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Vehicle</span>
          <input className={field} value={f.vehicle} maxLength={30} onChange={set("vehicle")} list="vehicles" placeholder="OD-17 AB 1234" autoCapitalize="characters" />
          <datalist id="vehicles">{form.vehicles.map((v) => <option key={v} value={v} />)}</datalist>
        </label>
      </div>
      {(form.last.salesperson_id || form.last.vehicle) && <p className="-mt-2 text-xs text-slate-500">Filled in from {form.customer.name}&apos;s last bill.</p>}

      <div className={`space-y-3 rounded-xl border p-3 ${f.needs_gst ? "border-(--brand) bg-(--brand-soft)" : "border-slate-200 bg-slate-50"}`}>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={f.needs_gst} onChange={(e) => setF({ ...f, needs_gst: e.target.checked })} />
          <span>
            <span className="block font-semibold">Needs GST invoice (send to Zoho)</span>
            <span className="block text-sm text-slate-600">
              {form.customer.gstin ? "Ticked because this customer has a GSTIN. You can untick it." : `${form.customer.name} has no GSTIN saved. Tick if they want a GST invoice.`}
            </span>
          </span>
        </label>
        {f.needs_gst && !form.plant_state && (
          <p className="text-sm font-semibold text-red-800">Add your GSTIN on PlantOps → Business details first: it says which state you bill from.</p>
        )}
        {f.needs_gst && (
          <>
            <label className="block">
              <span className={label}>Customer GSTIN (optional)</span>
              <input className={`${field} uppercase tracking-wide`} value={f.gstin} maxLength={20}
                onChange={(e) => { const g = e.target.value.toUpperCase(); const st = g.replace(/\s+/g, "").slice(0, 2); setF({ ...f, gstin: g, place: /^\d{2}$/.test(st) && form.states.some((s) => s.code === st) ? st : f.place }); }}
                placeholder="21AAACL0140P4ZS" />
            </label>
            <label className="block">
              <span className={label}>Legal name (as on the GST registration / in Zoho)</span>
              <input className={field} value={f.legal_name} maxLength={200} onChange={set("legal_name")} />
              {f.legal_name.trim() !== form.customer.name && <span className="mt-1 block text-xs text-slate-500">Calling name stays “{form.customer.name}” on orders and lists.</span>}
            </label>
            {!f.gstin.trim() && (
              <label className="block">
                <span className={label}>Without a GSTIN, the buyer is</span>
                <select className={field} value={f.gst_treatment === "unregistered" ? "unregistered" : "consumer"} onChange={set("gst_treatment")}>
                  <option value="consumer">A consumer</option>
                  <option value="unregistered">An unregistered business</option>
                </select>
              </label>
            )}
            <label className="block">
              <span className={label}>Billing address{f.gstin.trim() ? "" : " (optional)"}</span>
              <input className={field} value={f.billing_address} maxLength={300} onChange={set("billing_address")} placeholder="Street, area" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={label}>City{f.gstin.trim() ? "" : " (optional)"}</span>
                <input className={field} value={f.billing_city} maxLength={80} onChange={set("billing_city")} />
              </label>
              <label className="block">
                <span className={label}>PIN code{f.gstin.trim() ? "" : " (optional)"}</span>
                <input className={field} value={f.billing_pin} inputMode="numeric" maxLength={6} onChange={set("billing_pin")} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={label}>Place of supply</span>
                <select className={field} value={f.place} onChange={set("place")}>
                  {form.states.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </select>
              </label>
              <label className="block">
                <span className={label}>Rates include GST</span>
                <select className={field} value={f.inclusive ? "yes" : "no"} onChange={(e) => setF({ ...f, inclusive: e.target.value === "yes" })}>
                  <option value="yes">Yes</option>
                  <option value="no">No, add GST</option>
                </select>
              </label>
            </div>
            {f.inclusive !== form.settings.rates_include_gst && (
              <p className="text-xs text-slate-600">Plant usually: rates {form.settings.rates_include_gst ? "include" : "exclude"} GST. Changed for this bill only.</p>
            )}
            {missingRate.length > 0 && (
              <p className="text-sm font-semibold text-red-800">No GST rate on {missingRate.join(", ")}. Set it on PlantOps → Business details → Products.</p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <p className={label}>Lines</p>
        {form.lines.map((l, i) => {
          const out = calc?.lines[i];
          return (
            <div key={l.line_no} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex justify-between gap-2 font-semibold">
                <span className="min-w-0 break-words">{l.name}</span>
                <span className="shrink-0">{money(out ? rupees(out.amount) : l.amount)}</span>
              </div>
              <p className="text-sm text-slate-500">
                {l.quantity} {l.unit} × {money(l.rate)}{l.hsn ? ` · HSN ${l.hsn}` : ""}{f.needs_gst && l.gst_rate !== null ? ` · GST ${l.gst_rate}%` : ""}
              </p>
              <input className={field} value={lines[i]!.description} maxLength={500} placeholder="Description (optional), e.g. Oct month"
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              {all && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Line discount</span>
                  <input className={`${field} max-w-28`} inputMode="decimal" value={lines[i]!.discount} placeholder="0"
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))} />
                  <select className={`${field} max-w-20`} value={lines[i]!.pct ? "%" : "₹"}
                    onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, pct: e.target.value === "%" } : x)))}>
                    <option>₹</option>
                    <option>%</option>
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <label className="block">
        <span className={label}>Discount ₹ (optional)</span>
        <input className={field} inputMode="decimal" value={f.discount} onChange={set("discount")} placeholder="0" />
      </label>

      {all && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <label className="block">
            <span className={label}>Reference / PO no. (customer&apos;s)</span>
            <input className={field} value={f.reference_no} maxLength={50} onChange={set("reference_no")} placeholder="e.g. PO-4512" />
          </label>
          <label className="block">
            <span className={label}>Adjustment ± (round-off)</span>
            <input className={field} inputMode="decimal" value={f.adjustment} onChange={set("adjustment")} placeholder="e.g. -0.40" />
          </label>
          <label className="block">
            <span className={label}>Customer notes (printed on the bill)</span>
            <textarea className={`${field} py-2`} rows={2} maxLength={2000} value={f.notes} onChange={set("notes")} />
          </label>
          <label className="block">
            <span className={label}>Private note (only staff see it)</span>
            <textarea className={`${field} py-2`} rows={2} maxLength={500} value={f.private_note} onChange={set("private_note")} />
          </label>
          <label className="block">
            <span className={label}>Zoho GST invoice no.</span>
            <input className={field} value={f.zoho_no} maxLength={40} onChange={set("zoho_no")} placeholder="Or type it later on the bill" />
          </label>
        </div>
      )}

      <div className="space-y-1 border-t border-slate-200 pt-3 text-sm text-slate-700">
        {calc && (
          <>
            <p className="flex justify-between"><span>Sub total</span><span>{money(rupees(calc.sub_total))}</span></p>
            {calc.discount > 0n && <p className="flex justify-between"><span>Discount</span><span>−{money(rupees(calc.discount))}</span></p>}
            {calc.taxable_total !== null && <p className="flex justify-between"><span>Taxable amount</span><span>{money(rupees(calc.taxable_total))}</span></p>}
            {calc.taxable_total !== null && intra && (
              <>
                <p className="flex justify-between"><span>CGST</span><span>{money(rupees(calc.cgst))}</span></p>
                <p className="flex justify-between"><span>SGST</span><span>{money(rupees(calc.sgst))}</span></p>
              </>
            )}
            {calc.taxable_total !== null && !intra && <p className="flex justify-between"><span>IGST</span><span>{money(rupees(calc.igst))}</span></p>}
            {calc.adjustment !== 0n && <p className="flex justify-between"><span>Adjustment</span><span>{calc.adjustment < 0n ? "−" : ""}{money(rupees(calc.adjustment < 0n ? -calc.adjustment : calc.adjustment))}</span></p>}
            <p className="flex justify-between text-lg font-bold text-slate-900"><span>Bill total</span><span>{money(rupees(calc.total))}</span></p>
            {calc.taxable_total === null && <p className="text-xs text-slate-500">No GST lines: this bill is a statement of account.</p>}
          </>
        )}
        {calcError && !missingRate.length && <p className="font-semibold text-red-800">{calcError}</p>}
      </div>

      <button type="button" className="min-h-10 text-sm font-semibold text-(--brand)" onClick={() => setAll(!all)}>
        {all ? "▾ Hide extra fields" : "▸ Show all fields"}
      </button>

      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || !!calcError || (f.needs_gst && !form.plant_state)} onClick={save}>{busy ? "Saving..." : "Save bill"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {f.needs_gst && <p className="text-xs text-slate-500">After saving, the bill waits in Bills → GST invoices to make.</p>}
    </div>
  );
}

/** Owner: cancel a bill or a payment, with a reason. Final. */
export function CancelWithReason({ url, what, effect }: { url: string; what: string; effect: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api(url, { body: { reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open)
    return (
      <button className="min-h-10 text-sm font-semibold text-red-700" onClick={() => setOpen(true)}>
        Cancel {what}…
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">{effect} This can&apos;t be undone.</p>
      <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. typed twice)" />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="bg-red-700 hover:bg-red-800" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? "Cancelling..." : `Cancel ${what}`}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </div>
  );
}

/** The Zoho GST invoice no. on a bill. */
export function GstInvoice({ billId, value }: { billId: string; value: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  async function save() {
    setError(undefined);
    const r = await api(`/api/bills/${billId}/gst`, { body: { zoho_gst_invoice_no: v } });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <label className={label} htmlFor="gst">Zoho GST invoice no.</label>
      <div className="flex gap-2">
        <input id="gst" className={field} value={v} maxLength={40} onChange={(e) => { setV(e.target.value); setSaved(false); }} placeholder="INV-001900" />
        <Button variant="secondary" onClick={save} disabled={v === (value ?? "")}>{saved ? "Saved" : "Save"}</Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function PrintButton() {
  return (
    <button className="min-h-10 text-sm font-semibold text-(--brand) print:hidden" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}

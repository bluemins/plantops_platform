"use client";

// Cash book step C2: + Collection (owner, Accounts) on the day sheet, and Post / Turn down on "To post". The server checks
// everything again. A collection never touches a customer's bills by itself: each line waits until it is posted.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { paise, rupees, signedMoney } from "@/lib/cash";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const chip = (on: boolean) => `min-h-11 rounded-xl border px-3 text-sm font-semibold ${on ? "border-2 border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`;
const rs = (s: string) => signedMoney(paise(s));

export interface Found {
  id: string;
  name: string;
  phone: string;
  place: string;
  jar: boolean;
  group_name: string | null;
  due: string;
  last: string | null;
}

/** Search customers (20 L first) and pick one. */
export function CustomerSearch({ onPick, placeholder = "Find a customer: name or mobile" }: { onPick: (c: Found) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await api<Found[]>(`/api/cash/collections/search?q=${encodeURIComponent(q.trim())}`);
      if (n === seq.current && r.ok) setFound(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? [] : found;
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} className={field} placeholder={placeholder} />
      {shown.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left" onClick={() => { onPick(c); setQ(""); setFound([]); }}>
                <span className="min-w-0">
                  <span className="block font-semibold break-words">{c.name}{c.jar && <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-900">20 L</span>}</span>
                  <span className="text-xs text-slate-500">{c.phone} · {c.place}</span>
                </span>
                <span className={`shrink-0 text-sm ${paise(c.due) > 0n ? "text-red-700" : "text-slate-500"}`}>{paise(c.due) > 0n ? `owes ${rs(c.due)}` : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && shown.length === 0 && <p className="text-sm text-slate-500">No customer found. Add them in Sales → Customers first.</p>}
    </div>
  );
}

type Line = { customer: Found; amount: string; mode: "cash" | "upi" };

/** + Collection: customers who paid, amount, Cash / Online. Cash goes into the box now; every line waits to be posted. */
export function CollectionForm({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: (text: string) => void }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [work, setWork] = useState(date);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ok = (a: string) => AMOUNT.test(a.trim()) && Number(a) > 0;
  const sum = (m: "cash" | "upi") => lines.filter((l) => l.mode === m && ok(l.amount)).reduce((s, l) => s + paise(l.amount.trim()), 0n);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    setError(undefined);
    if (!lines.length) return setError("Add at least one customer");
    const bad = lines.find((l) => !ok(l.amount));
    if (bad) return setError(`Amount for ${bad.customer.name}: rupees, e.g. 50`);
    setBusy(true);
    const r = await api<{ ref: string | null; cash: string; online: string; lines: number }>("/api/cash/collections", {
      body: { cash_date: date, ...(work !== date ? { work_date: work } : {}), lines: lines.map((l) => ({ customer_id: l.customer.id, amount: l.amount.trim(), mode: l.mode })) },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(
      r.data.ref
        ? `${r.data.ref} saved: ${rs(r.data.cash)} cash into the box${paise(r.data.online) > 0n ? `, ${rs(r.data.online)} online` : ""}. ${r.data.lines} line${r.data.lines === 1 ? "" : "s"} wait in "To post".`
        : `Saved: ${rs(r.data.online)} online, no cash for the box. ${r.data.lines} line${r.data.lines === 1 ? "" : "s"} wait in "To post".`,
    );
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">Collection from customers</p>
      <p className="text-sm text-slate-600">The cash goes into today&apos;s cash book now. Customers&apos; accounts change only when the owner or Accounts posts each line (&ldquo;To post&rdquo;).</p>
      <CustomerSearch onPick={(c) => setLines([...lines, { customer: c, amount: c.last ?? "", mode: "cash" }])} />
      {lines.length > 0 && (
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold break-words">{l.customer.name}</p>
                <button type="button" className="shrink-0 text-sm font-semibold text-red-700" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
              </div>
              {paise(l.customer.due) > 0n && <p className="text-xs text-slate-500">Owes {rs(l.customer.due)}</p>}
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <input inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} className={`${field} font-semibold`} placeholder="₹" aria-label={`Amount from ${l.customer.name}`} />
                <button type="button" className={chip(l.mode === "cash")} onClick={() => set(i, { mode: "cash" })}>Cash</button>
                <button type="button" className={chip(l.mode === "upi")} onClick={() => set(i, { mode: "upi" })}>Online</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && (
        <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm">
          Cash into the box: <b>{rs(rupees(sum("cash")))}</b>
          {sum("upi") > 0n && <> · Online: <b>{rs(rupees(sum("upi")))}</b></>}
        </p>
      )}
      <label className="block">
        <span className={label}>Day collected (usually today)</span>
        <input type="date" value={work} max={date} onChange={(e) => setWork(e.target.value)} className={field} />
      </label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

/** Owner, Accounts: post a waiting line onto the account (oldest bills first), maybe to another customer; or turn it down. */
export function PostActions({ id, customer, amount }: { id: string; customer: string; amount: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "other" | "down">("none");
  const [other, setOther] = useState<Found>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();

  async function post() {
    setError(undefined);
    setBusy(true);
    const r = await api<{ number: string; customer: string; bills: string[]; advance: string }>(`/api/collections/${id}/post`, { body: other ? { customer_id: other.id } : {} });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    // no refresh here: the line would leave the Waiting list before anyone read this (the totals update on the next visit)
    setDone(`Posted: ${r.data.number} on ${r.data.customer}'s account, ${r.data.bills.length ? `paid ${r.data.bills.join(", ")}` : "kept as advance"}${r.data.bills.length && paise(r.data.advance) > 0n ? `, ${rs(r.data.advance)} advance` : ""}.`);
  }
  async function down() {
    setError(undefined);
    if (reason.trim().length < 3) return setError("Please give a reason");
    setBusy(true);
    const r = await api(`/api/collections/${id}/turn-down`, { body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (done) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>;
  return (
    <div className="space-y-2">
      {mode === "other" && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          {other ? (
            <p className="text-sm">Post to <b>{other.name}</b> ({other.phone}) instead of {customer}. <button type="button" className="font-semibold text-(--brand)" onClick={() => setOther(undefined)}>Change</button></p>
          ) : (
            <CustomerSearch onPick={setOther} placeholder="Whose money was it? Name or mobile" />
          )}
        </div>
      )}
      {mode === "down" && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={field} placeholder="Why? e.g. not a customer payment, it was a refund" />
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        {mode !== "down" && (
          <Button onClick={post} disabled={busy || (mode === "other" && !other)}>{busy ? "Posting…" : `Post ${rs(amount)}${other ? ` to ${other.name}` : ""}`}</Button>
        )}
        {mode === "down" && <Button onClick={down} disabled={busy}>{busy ? "Saving…" : "Turn down"}</Button>}
        {mode === "none" ? (
          <>
            <Button variant="secondary" onClick={() => setMode("other")} disabled={busy}>Another customer</Button>
            <Button variant="secondary" onClick={() => setMode("down")} disabled={busy}>Turn down</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => { setMode("none"); setOther(undefined); setError(undefined); }} disabled={busy}>Back</Button>
        )}
      </div>
    </div>
  );
}

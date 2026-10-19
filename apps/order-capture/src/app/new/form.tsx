"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, TextField } from "@plantops/ui";
import { normalisePhone } from "@plantops/module-kit/phone";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import { NOTE_MAX } from "@/lib/note";
import { NAME_MAX, PLACE_MAX } from "@/lib/upload";
import type { SavedOrder } from "@/server/orders";
import type { RateView } from "@/server/rates";
import { LinesEditor, linesBody, linesProblem, plainRate, totalOf, unitsOf, type EditLine } from "../lines-editor";

type Lookup = { phone: string; customer: { id: string; name: string; place: string; active: boolean } | null; last_order_at: string | null; last_rates: Record<string, string> };
type Match = { id: string; name: string; phone: string; place: string; active: boolean };
const spaced = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;

let counter = 0;
/**
 * A one-time key for this order: the same key on every retry, so a double tap or a resend after a dropped connection
 * never makes two orders. Not crypto.randomUUID(): it doesn't exist on plain-http pages (phones on the Wi-Fi address).
 */
const newKey = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${(counter++).toString(36)}`;
const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));

/** The rate a new line starts with: their last rate for it, else the default rate, else empty. */
function startRate(skuId: string, products: RateView[], found: Lookup | null) {
  const last = found?.last_rates[skuId];
  if (last) return plainRate(last);
  const def = products.find((p) => p.sku_id === skuId)?.default_rate;
  return def ? plainRate(def) : "";
}

export function OrderForm({ products, ownerNotified }: { products: RateView[]; ownerNotified: boolean }) {
  const [key, setKey] = useState(newKey);
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedOrder>();
  const asked = useRef("");
  const [matches, setMatches] = useState<{ q: string; list: Match[]; more: boolean } | null>(null);
  const typedName = useRef("");

  // the box takes a name, a place or a phone: a full mobile number is looked up at once, anything else is searched
  const normal = normalisePhone(phone);
  const query = normal ? "" : phone.trim();

  useEffect(() => {
    if (query.length < 2) {
      setMatches(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api<{ customers: Match[]; more: boolean }>(`/api/customers/search?q=${encodeURIComponent(query)}`).catch(() => null);
      if (r?.ok) setMatches({ q: query, list: r.data.customers, more: r.data.more });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  /** Remember a typed name that wasn't found, so the new-customer box starts with it once the number is typed. */
  useEffect(() => {
    if (matches && matches.list.length === 0 && /[^\d\s+()-]/.test(matches.q)) typedName.current = matches.q;
  }, [matches]);

  function pick(m: Match) {
    setPhone(spaced(m.phone));
    setMatches(null);
  }

  // look the phone up as soon as it is a valid mobile number
  useEffect(() => {
    if (!normal) {
      asked.current = "";
      setFound(null);
      return;
    }
    if (asked.current === normal) return;
    asked.current = normal;
    void lookup(normal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normal]);

  async function lookup(p: string) {
    setLooking(true);
    const r = await api<Lookup>(`/api/customers/lookup?phone=${encodeURIComponent(p)}`).catch(() => null);
    setLooking(false);
    if (!r?.ok || asked.current !== p) return;
    setFound(r.data);
    if (!r.data.customer && typedName.current) setName((n) => n || typedName.current);
    // lines whose rate nobody typed take this customer's last rates
    setLines((ls) => ls.map((l) => (l.edited ? l : { ...l, rate: startRate(l.sku_id, products, r.data) })));
  }

  async function switchOn() {
    if (!found?.customer) return;
    const r = await api(`/api/customers/${found.customer.id}`, { method: "PATCH", body: { active: true } });
    if (!r.ok) return setError(r.error);
    asked.current = "";
    await lookup(found.phone);
    asked.current = found.phone;
  }

  const total = totalOf(lines);
  const units = unitsOf(lines, products);
  const isNew = Boolean(normal && found && !found.customer);
  const off = Boolean(found?.customer && !found.customer.active);

  function problem(): string | null {
    if (!normal) return "Pick the customer from the list, or enter their 10-digit mobile number";
    if (!found) return "Checking the customer…";
    if (off) return `${found.customer!.name} is switched off. Switch them back on first.`;
    if (isNew && (name.trim().length < 2 || place.trim().length < 2)) return "Enter the new customer's name and place";
    return linesProblem(lines, products);
  }

  async function save() {
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError(undefined);
    const body = {
      request_key: key,
      customer: { phone, ...(isNew ? { name, place } : {}) },
      lines: linesBody(lines),
      ...(note.trim() ? { note } : {}),
    };
    const r = await api<SavedOrder>("/api/orders", { body }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and press Save again.");
    if (!r.ok) return setError(r.error);
    setSaved(r.data);
  }

  function again() {
    setKey(newKey());
    setPhone("");
    setFound(null);
    asked.current = "";
    setMatches(null);
    typedName.current = "";
    setName("");
    setPlace("");
    setLines([]);
    setNote("");
    setError(undefined);
    setSaved(undefined);
    window.scrollTo(0, 0);
  }

  if (saved) return <SavedView order={saved} onNew={again} ownerNotified={ownerNotified && saved.created} />;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Customer name or phone</span>
        <input
          className="min-h-14 w-full rounded-xl border-2 border-(--brand) bg-white px-4 text-xl tracking-wide focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
          type="search"
          autoComplete="off"
          placeholder="Name, place or 98765 43210"
          value={phone}
          maxLength={NAME_MAX}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {phone.replace(/\D/g, "").length >= 10 && !normal && <p className="text-sm text-amber-800">Enter a 10-digit mobile number</p>}
      {looking && <p className="text-sm text-slate-500">Checking…</p>}

      {matches && matches.q === query && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {matches.list.map((m) => (
            <button key={m.id} type="button" onClick={() => pick(m)} className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-left last:border-b-0 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{m.name}</span>
                <span className="block truncate text-sm text-slate-600">
                  {m.place}
                  {!m.active && " · switched off"}
                </span>
              </span>
              <span className="shrink-0 text-sm text-slate-500">{spaced(m.phone)}</span>
            </button>
          ))}
          {matches.more && <p className="px-4 py-2 text-sm text-slate-500">More customers match: type more of the name.</p>}
          {matches.list.length === 0 && <p className="px-4 py-3 text-sm text-slate-600">No customer matches “{matches.q}”. For a new customer, type their 10-digit mobile number.</p>}
        </div>
      )}

      {found?.customer && found.customer.active && (
        <div className="flex gap-3 rounded-xl border border-green-300 bg-green-50 px-4 py-3">
          <span aria-hidden="true" className="text-xl text-green-700">
            ✓
          </span>
          <div>
            <p className="text-lg font-semibold">{found.customer.name}</p>
            <p className="text-sm text-slate-600">
              {found.customer.place} · {found.last_order_at ? `last order ${day(found.last_order_at)}` : "no orders yet"}
            </p>
          </div>
        </div>
      )}
      {off && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold">{found!.customer!.name} is switched off</p>
          <p className="text-sm text-slate-700">{found!.customer!.place}. Switch them back on to take an order.</p>
          <Button variant="secondary" onClick={switchOn}>
            Switch back on
          </Button>
        </div>
      )}
      {isNew && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-semibold">New customer: not in your list yet</p>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="off" />
          <TextField label="Place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={PLACE_MAX} autoComplete="off" />
          <p className="text-sm text-slate-500">Saved to your customer list with this order.</p>
        </div>
      )}

      <p className="pt-1 text-sm font-semibold">Products</p>
      <LinesEditor
        products={products}
        lines={lines}
        onChange={setLines}
        startRate={(skuId) => startRate(skuId, products, found)}
        hint={(l, p) => {
          const last = found?.last_rates[l.sku_id];
          return last ? `Their last rate: ${money(last)}` : p.default_rate ? "Default rate" : "No default rate: type the rate";
        }}
      />

      <label className="block pt-1">
        <span className="text-sm font-semibold">
          Note for this order <span className="font-normal text-slate-500">(optional)</span>
        </span>
        <textarea
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
          rows={3}
          maxLength={NOTE_MAX}
          placeholder="e.g. deliver after 4 pm, call before coming"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="block text-sm text-slate-500">Can't be changed after saving. More notes can be added to the order later.</span>
      </label>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pt-3 pb-4">
        <div className="mx-auto max-w-3xl space-y-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex items-baseline justify-between">
            <span className="text-slate-600">Total{units ? ` · ${units}` : ""}</span>
            <span className="text-2xl font-bold">{money(total)}</span>
          </div>
          <Button className="w-full min-h-14 text-lg" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save order"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "Order O-0042 saved" with what was saved (mock-up "Order saved"). */
function SavedView({ order, onNew, ownerNotified }: { order: SavedOrder; onNew: () => void; ownerNotified: boolean }) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-green-100 text-4xl text-green-800" aria-hidden="true">
        ✓
      </div>
      <h2 className="text-2xl font-bold">Order {order.ref} saved</h2>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-left">
        <p className="text-lg font-semibold">
          {order.customer.name}, {order.customer.place}
        </p>
        {order.lines.map((l) => (
          <div key={l.product} className="flex justify-between gap-3">
            <span>
              {l.product} · {l.quantity.toLocaleString("en-IN")} {l.unit} × {money(l.rate)}
            </span>
            <span className="shrink-0">{money(l.total)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold">
          <span>Total</span>
          <span>{money(order.total)}</span>
        </div>
        {order.note && <p className="rounded-lg bg-amber-50 px-3 py-2 whitespace-pre-line break-words text-amber-950">📝 {order.note}</p>}
      </div>
      {ownerNotified && <p className="text-sm text-slate-500">The owner has been notified.</p>}
      <div className="space-y-3">
        <Button className="w-full min-h-14 text-lg" onClick={onNew}>
          New order
        </Button>
        <a href="/" className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-(--brand)">
          Home
        </a>
      </div>
    </div>
  );
}

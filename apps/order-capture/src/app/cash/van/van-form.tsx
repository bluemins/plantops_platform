"use client";

// The van report form (cash book step C3): vehicle, who drove, boxes sold per product grouped by brand (rate pre-filled),
// "not paid" lines, "collected from customers" lines, online, meal, tiffin, diesel, toll, and the cash handed in. The cash
// to hand in is worked out live with the same rules as the server (src/lib/van.ts).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { paise, rupees, signedMoney } from "@/lib/cash";
import { byBrand, lineAmount, vanDifferenceText, vanSums } from "@/lib/van";
import type { VanForm as VanFormData } from "@/server/van";
import { CustomerSearch, type Found } from "../collect-forms";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const small = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-right text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const chip = (on: boolean) => `min-h-11 rounded-xl border px-3 text-sm font-semibold ${on ? "border-2 border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`;
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const okAmount = (a: string) => a.trim() === "" || AMOUNT.test(a.trim());
const rs = (p: bigint) => signedMoney(p);
const whole = (s: string) => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);

type Party = { customer: Found; amount: string; mode: "cash" | "upi" };
type Line = { qty: string; rate: string; loaded: string; returned: string };
const EXTRAS = [
  ["online", "Online received (UPI to the bank)"],
  ["meal", "Meal"],
  ["tiffin", "Tiffin"],
  ["diesel", "Diesel"],
  ["toll", "Toll"],
] as const;
type Extra = (typeof EXTRAS)[number][0];

export function VanReportForm({ date, form }: { date: string; form: VanFormData }) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState(form.vehicles.length === 1 ? form.vehicles[0]!.id : "");
  const [person, setPerson] = useState("");
  const [work, setWork] = useState(date);
  const [lines, setLines] = useState<Record<string, Line>>(() => Object.fromEntries(form.items.map((i) => [i.sku_id, { qty: "", rate: i.rate, loaded: "", returned: "" }])));
  const [showLoad, setShowLoad] = useState(false);
  const [notPaid, setNotPaid] = useState<Party[]>([]);
  const [collected, setCollected] = useState<Party[]>([]);
  const [extra, setExtra] = useState<Record<Extra, string>>({ online: "", meal: "", tiffin: "", diesel: "", toll: "" });
  const [handed, setHanded] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const brands = useMemo(() => {
    const m = new Map<string, typeof form.items>();
    for (const i of form.items) m.set(i.brand, [...(m.get(i.brand) ?? []), i]);
    return [...m.entries()];
  }, [form.items]);

  const sales = form.items
    .map((i) => ({ i, l: lines[i.sku_id]! }))
    .filter(({ l }) => (whole(l.qty) ?? 0) > 0 && AMOUNT.test(l.rate.trim()))
    .map(({ i, l }) => ({ product: i.product, brand: i.brand, quantity: whole(l.qty)!, rate: l.rate.trim() }));
  const valid = (xs: Party[], m?: "cash" | "upi") => xs.filter((x) => (!m || x.mode === m) && AMOUNT.test(x.amount.trim())).map((x) => x.amount.trim());
  const s = vanSums({ sales, not_paid: valid(notPaid), collected_cash: valid(collected, "cash"), collected_online: valid(collected, "upi"), ...Object.fromEntries(EXTRAS.map(([k]) => [k, okAmount(extra[k]) ? extra[k].trim() : ""])) } as Parameters<typeof vanSums>[0]);
  const handedP = AMOUNT.test(handed.trim()) ? paise(handed.trim()) : null;

  const setLine = (sku: string, patch: Partial<Line>) => setLines({ ...lines, [sku]: { ...lines[sku]!, ...patch } });
  const setParty = (list: Party[], set: (x: Party[]) => void, i: number, patch: Partial<Party>) => set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setError(undefined);
    if (!vehicle) return setError("Pick the vehicle");
    const name = person.trim();
    if (!name) return setError("Who drove / sold?");
    for (const i of form.items) {
      const l = lines[i.sku_id]!;
      if (l.qty.trim() && whole(l.qty) === null) return setError(`${i.product}: boxes are a whole number`);
      if ((whole(l.qty) ?? 0) > 0 && !AMOUNT.test(l.rate.trim())) return setError(`${i.product}: type the rate`);
      if ((l.loaded.trim() && whole(l.loaded) === null) || (l.returned.trim() && whole(l.returned) === null)) return setError(`${i.product}: loaded / returned are whole numbers`);
    }
    for (const x of [...notPaid, ...collected]) if (!AMOUNT.test(x.amount.trim()) || Number(x.amount) <= 0) return setError(`Amount for ${x.customer.name}: rupees, e.g. 500`);
    for (const [k, t] of EXTRAS) if (!okAmount(extra[k])) return setError(`${t}: rupees, e.g. 200`);
    if (handedP === null || handedP <= 0n) return setError("Cash handed in: rupees, e.g. 1150");
    const known = form.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const body = {
      cash_date: date,
      ...(work !== date ? { work_date: work } : {}),
      vehicle_id: vehicle,
      ...(known ? { person_user_id: known.id } : { person_name: name }),
      lines: form.items
        .map((i) => ({ i, l: lines[i.sku_id]! }))
        .filter(({ l }) => (whole(l.qty) ?? 0) > 0 || whole(l.loaded) !== null || whole(l.returned) !== null)
        .map(({ i, l }) => ({ sku_id: i.sku_id, quantity: whole(l.qty) ?? 0, rate: AMOUNT.test(l.rate.trim()) ? l.rate.trim() : "0", ...(whole(l.loaded) !== null ? { loaded: whole(l.loaded)! } : {}), ...(whole(l.returned) !== null ? { returned: whole(l.returned)! } : {}) })),
      not_paid: notPaid.map((x) => ({ customer_id: x.customer.id, amount: x.amount.trim() })),
      collected: collected.map((x) => ({ customer_id: x.customer.id, amount: x.amount.trim(), mode: x.mode })),
      ...Object.fromEntries(EXTRAS.map(([k]) => [k, extra[k].trim() || "0"])),
      handed_in: handed.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    setBusy(true);
    const r = await api<{ id: string }>("/api/cash/van", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/cash/van/${r.data.id}?saved=1`);
  }

  const partyList = (title: string, hint: string, list: Party[], set: (x: Party[]) => void, modes: boolean) => (
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-slate-600">{hint}</p>
      <CustomerSearch onPick={(c) => set([...list, { customer: c, amount: "", mode: "cash" }])} />
      {list.map((x, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 font-semibold break-words">{x.customer.name}</p>
            <button type="button" className="shrink-0 text-sm font-semibold text-red-700" onClick={() => set(list.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <div className={`grid gap-2 ${modes ? "grid-cols-[1fr_auto_auto]" : "grid-cols-1"}`}>
            <input inputMode="decimal" value={x.amount} onChange={(e) => setParty(list, set, i, { amount: e.target.value })} className={`${field} font-semibold`} placeholder="₹" aria-label={`${title}: ${x.customer.name}`} />
            {modes && <button type="button" className={chip(x.mode === "cash")} onClick={() => setParty(list, set, i, { mode: "cash" })}>Cash</button>}
            {modes && <button type="button" className={chip(x.mode === "upi")} onClick={() => setParty(list, set, i, { mode: "upi" })}>Online</button>}
          </div>
        </div>
      ))}
    </section>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <span className={label}>Vehicle</span>
          <div className="flex flex-wrap gap-2">
            {form.vehicles.map((v) => <button key={v.id} type="button" className={chip(vehicle === v.id)} onClick={() => setVehicle(v.id)}>{v.name}</button>)}
          </div>
          {form.vehicles.length === 0 && <p className="text-sm text-amber-800">No vehicles yet. The owner adds them on Cash → Settings.</p>}
        </div>
        <label className="block">
          <span className={label}>Who drove / sold</span>
          <input value={person} onChange={(e) => setPerson(e.target.value)} list="van-people" maxLength={100} className={field} placeholder="Type or pick a name" />
          <datalist id="van-people">{[...new Set([...form.people.map((p) => p.name), ...form.names])].map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="block">
          <span className={label}>Day of the trip</span>
          <input type="date" value={work} max={date} onChange={(e) => setWork(e.target.value)} className={field} />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">Sold · {rs(s.sales)}</p>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showLoad} onChange={(e) => setShowLoad(e.target.checked)} className="h-5 w-5" />Loaded / returned</label>
        </div>
        {brands.length === 0 && <p className="text-sm text-slate-500">No products with a brand. The owner sets brands on Rates.</p>}
        {brands.map(([brand, items]) => (
          <div key={brand} className="space-y-2">
            <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">{brand} · {rs(byBrand(sales).find((b) => b.brand === brand)?.amount ?? 0n)}</p>
            {items.map((i) => {
              const l = lines[i.sku_id]!;
              const q = whole(l.qty) ?? 0;
              const amt = q > 0 && AMOUNT.test(l.rate.trim()) ? lineAmount({ quantity: q, rate: l.rate.trim() }) : null;
              const lo = whole(l.loaded);
              const re = whole(l.returned);
              return (
                <div key={i.sku_id} className="rounded-xl border border-slate-100 p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold break-words">{i.product}</p>
                    <p className="shrink-0 text-sm text-slate-600">{amt !== null ? rs(amt) : ""}</p>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500">{i.unit} sold<input inputMode="numeric" value={l.qty} onChange={(e) => setLine(i.sku_id, { qty: e.target.value })} className={small} aria-label={`${i.product} sold`} /></label>
                    <label className="text-xs text-slate-500">Rate ₹<input inputMode="decimal" value={l.rate} onChange={(e) => setLine(i.sku_id, { rate: e.target.value })} className={small} aria-label={`${i.product} rate`} /></label>
                    {showLoad && <label className="text-xs text-slate-500">Loaded<input inputMode="numeric" value={l.loaded} onChange={(e) => setLine(i.sku_id, { loaded: e.target.value })} className={small} /></label>}
                    {showLoad && <label className="text-xs text-slate-500">Returned<input inputMode="numeric" value={l.returned} onChange={(e) => setLine(i.sku_id, { returned: e.target.value })} className={small} /></label>}
                  </div>
                  {lo !== null && re !== null && <p className={`mt-1 text-xs ${lo - re === q ? "text-green-700" : "text-amber-800"}`}>Loaded − returned = {lo - re}{lo - re === q ? " ✓" : ` (sold ${q})`}</p>}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {partyList(`Not paid · ${rs(s.not_paid)}`, "Credit given on the trip. Each line waits in To post; posting makes the bill on that customer's account.", notPaid, setNotPaid, false)}
      {partyList(`Collected from customers · ${rs(s.collected_cash + s.collected_online)}`, "Old dues or today's paid on the spot. Each line waits in To post. Online lines don't come into the cash.", collected, setCollected, true)}

      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        {EXTRAS.map(([k, t]) => (
          <label key={k} className={k === "online" ? "col-span-2 block" : "block"}>
            <span className={label}>{t}</span>
            <input inputMode="decimal" value={extra[k]} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} className={field} placeholder="0" />
          </label>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="space-y-1 text-sm">
          <p className="flex justify-between"><span>Sold</span><span>{rs(s.sales)}</span></p>
          {s.not_paid > 0n && <p className="flex justify-between"><span>− Not paid</span><span>{rs(s.not_paid)}</span></p>}
          {s.collected_cash > 0n && <p className="flex justify-between"><span>+ Collected (cash)</span><span>{rs(s.collected_cash)}</span></p>}
          {EXTRAS.filter(([k]) => s[k] > 0n).map(([k, t]) => <p key={k} className="flex justify-between"><span>− {t.split(" (")[0]}</span><span>{rs(s[k])}</span></p>)}
          <p className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><span>Cash to hand in</span><span>{rs(s.expected)}</span></p>
        </div>
        <label className="block">
          <span className={label}>Cash handed in (₹)</span>
          <input inputMode="decimal" value={handed} onChange={(e) => setHanded(e.target.value)} className={`${field} text-2xl font-bold`} />
        </label>
        {handedP !== null && (
          <p className={`rounded-xl px-3 py-3 text-center font-semibold ${handedP === s.expected ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{handedP === s.expected ? "Matches ✓" : vanDifferenceText(handedP, s.expected)}</p>
        )}
        <label className="block"><span className={label}>Note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={field} placeholder={handedP !== null && handedP !== s.expected ? "Why short / extra?" : ""} /></label>
        {error && <ErrorText>{error}</ErrorText>}
        <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : `Save van report${handedP ? ` · ${rs(handedP)} into the cash` : ""}`}</Button>
        <p className="text-center text-xs text-slate-500">{rupees(s.expected) === "0.00" ? "" : "Saved once; a wrong report is cancelled by the owner with a reason."}</p>
      </section>
    </div>
  );
}

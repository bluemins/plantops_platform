"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { LETTERS, type Letter } from "@/lib/letters";
import { OPTIN_TEXT } from "@/lib/optin";
import { NAME_MAX, PLACE_MAX } from "@/lib/upload";
import type { CustomerView } from "@/server/customers";
import type { BrandPalette } from "@/lib/brand";
import { brandColour } from "@/lib/brand";
import { BrandTag, PhoneLink } from "../parts";

/** balances: owner only (null for everyone else): rupees, > 0 = they owe, < 0 = advance; missing = no bills */
type List = { customers: CustomerView[]; more: boolean; total: number; off: number; balances: Record<string, string> | null; letters: Letter[] };
type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

const reload = () => window.location.reload();
const fmt = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;
const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** The owner's money line: Due (amber), Advance (green) or No due (grey). */
function Money({ balance }: { balance?: string }) {
  const n = Number(balance ?? 0);
  if (n > 0) return <span className="font-bold text-amber-700">Due {rs(n)}</span>;
  if (n < 0) return <span className="font-bold text-emerald-700">Advance {rs(-n)}</span>;
  return <span className="text-slate-500">No due</span>;
}

/** "No brand yet" in the address (NO_BRAND on the server). */
const NO_BRAND = "_";
type Brands = { labels: Record<string, string[]>; palette: BrandPalette; chips: { brand: string; count: number }[]; none: number };
type Where = { q: string; showOff: boolean; letter?: Letter; brand?: string };

/** The list's address with search, switched-off, brand and letter kept (a value of undefined drops that one). */
function listHref(p: Where) {
  const s = new URLSearchParams({ ...(p.q ? { q: p.q } : {}), ...(p.showOff ? { off: "1" } : {}), ...(p.brand ? { b: p.brand } : {}), ...(p.letter ? { l: p.letter } : {}) });
  return s.size ? `/customers?${s}` : "/customers";
}

/**
 * All · each brand with its customers · No brand yet (mock-up Xe7FYe8DnR4APvLu8RzxXy): one row above the letters, each
 * chip in its brand's colour; the picked one gets a ring. Counts follow "Show switched-off", not the search or letter.
 */
function BrandStrip({ where, brands }: { where: Where; brands: Brands }) {
  const chip = "flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold";
  const ring = "ring-2 ring-(--brand) ring-offset-1";
  const all = !where.brand;
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Brand</p>
      <nav aria-label="Show customers by brand" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pt-0.5 pb-1">
        <a href={listHref({ ...where, brand: undefined })} aria-current={all ? "page" : undefined} className={`${chip} ${all ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}>
          All
        </a>
        {brands.chips.map(({ brand, count }) => {
          const on = where.brand === brand.trim().toLowerCase();
          return (
            <a key={brand} href={listHref({ ...where, brand: brand.trim().toLowerCase() })} aria-current={on ? "page" : undefined} className={`${chip} ${brandColour(brand, brands.palette)} ${on ? ring : ""}`}>
              {brand}
              <span className="font-normal opacity-75">{count}</span>
            </a>
          );
        })}
        {brands.none > 0 && (
          <a href={listHref({ ...where, brand: NO_BRAND })} aria-current={where.brand === NO_BRAND ? "page" : undefined} className={`${chip} border border-dashed border-slate-300 bg-white text-slate-700 ${where.brand === NO_BRAND ? ring : ""}`} title="Customers with no brand tag: no Brands they buy and no orders yet">
            No brand yet
            <span className="font-normal opacity-75">{brands.none}</span>
          </a>
        )}
      </nav>
    </div>
  );
}

/** The picked brand as shown ("Bluemins 20L"), or "no brand yet". */
function brandName(brands: Brands, b: string) {
  return b === NO_BRAND ? null : (brands.chips.find((c) => c.brand.trim().toLowerCase() === b)?.brand ?? b);
}

/** All · A–Z · #: one row that scrolls sideways on a phone. Letters with no customer (for this search) are greyed. */
function LetterStrip({ q, showOff, letter, brand, have }: { q: string; showOff: boolean; letter?: Letter; brand?: string; have: Letter[] }) {
  const chip = "flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border px-2 font-bold";
  const on = `${chip} border-(--brand) bg-(--brand) text-(--brand-contrast)`;
  const off = `${chip} border-slate-200 bg-white text-slate-800 hover:bg-slate-50`;
  return (
    <nav aria-label="Show customers by first letter" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <a href={listHref({ q, showOff, brand })} aria-current={!letter ? "page" : undefined} className={!letter ? on : off}>
        All
      </a>
      {LETTERS.map((l) =>
        l === letter ? (
          <a key={l} href={listHref({ q, showOff, brand, letter: l })} aria-current="page" className={on}>
            {l}
          </a>
        ) : have.includes(l) ? (
          <a key={l} href={listHref({ q, showOff, brand, letter: l })} className={off} title={l === "#" ? "Names starting with a number or other sign" : undefined}>
            {l}
          </a>
        ) : (
          <span key={l} aria-disabled="true" className={`${chip} border-transparent text-slate-300`}>
            {l}
          </span>
        ),
      )}
    </nav>
  );
}

/** Search, add, edit name / place, switch off / on. PlantOps support gets the same list without buttons. */
export function CustomersEditor({ list, brands, q, showOff, letter, brand, canEdit, plainPhones, accounts = false, dropPhones = false, brandsLink = false }: { list: List; brands: Brands; q: string; showOff: boolean; letter?: Letter; brand?: string; canEdit: boolean; plainPhones: boolean; accounts?: boolean; dropPhones?: boolean; brandsLink?: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string>();
  const close = () => setEditing(null);

  async function toggle(c: CustomerView) {
    setError(undefined);
    const r = await api(`/api/customers/${c.id}`, { method: "PATCH", body: { active: !c.active } });
    if (!r.ok) return setError(r.error);
    reload();
  }

  return (
    <div className="space-y-4">
      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          aria-label="Search customers"
          placeholder="Search name, place or phone"
          className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
        />
        {showOff && <input type="hidden" name="off" value="1" />}
        {brand && <input type="hidden" name="b" value={brand} />}
        {letter && <input type="hidden" name="l" value={letter} />}
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit && editing?.kind !== "new" && <Button onClick={() => setEditing({ kind: "new" })}>+ Add customer</Button>}
        {list.off > 0 && (
          <a href={listHref({ q, showOff: !showOff, letter, brand })} className="flex min-h-12 items-center text-sm font-semibold text-(--brand)">
            {showOff ? "Hide switched-off" : `Show switched-off (${list.off})`}
          </a>
        )}
      </div>
      {editing?.kind === "new" && <CustomerForm onClose={close} />}
      <ErrorText>{error}</ErrorText>

      {list.total > 0 && (brands.chips.length > 0 || brand) && <BrandStrip where={{ q, showOff, letter, brand }} brands={brands} />}
      {list.total > 0 && (
        <div className="space-y-1">
          {(brands.chips.length > 0 || brand) && <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Name</p>}
          <LetterStrip q={q} showOff={showOff} letter={letter} brand={brand} have={list.letters} />
        </div>
      )}
      {(letter || brand) && list.customers.length > 0 && (
        <p className="text-sm text-slate-500">
          <b className="text-slate-800">{list.more ? `More than ${list.customers.length}` : list.customers.length}</b> customer{list.customers.length === 1 ? "" : "s"}
          {brand && (brand === NO_BRAND ? " with no brand yet" : <> buying <b className="text-slate-800">{brandName(brands, brand)}</b></>)}
          {letter ? ` starting with ${letter === "#" ? "a number or other sign" : letter}` : ""}
          {q ? ` matching “${q}”` : ""}{" "}
          <a href={listHref({ q, showOff })} className="ml-1 font-semibold text-(--brand)">
            ✕ Clear
          </a>
        </p>
      )}

      <Card className="p-3">
        {list.customers.length === 0 ? (
          <p className="p-2 text-slate-500">
            {brand || letter
              ? `No customer${brand ? (brand === NO_BRAND ? " without a brand" : ` buying ${brandName(brands, brand)}`) : ""}${letter ? ` starts with ${letter === "#" ? "a number or other sign" : letter}` : ""}${q ? " for this search" : ""}.`
              : q ? "No customer matches this search." : list.total === 0 ? "No customers yet." : "No customers to show."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.customers.map((c) => (
              <li key={c.id} className="py-2">
                {editing?.kind === "edit" && editing.id === c.id ? (
                  <CustomerForm customer={c} onClose={close} onSwitchOff={() => toggle(c)} />
                ) : (
                  <div className={`px-1 ${c.active ? "" : "text-slate-400"}`}>
                    {/* line 1: name + brand labels | Account › (or 📍 Location); line 2: place + money | Edit + phone (mock-up F4xKTCKEAfjioGbsadR3gr) */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                        {accounts ? (
                          <a href={`/customers/${c.id}`} className="font-semibold break-words hover:underline">
                            {c.name}
                          </a>
                        ) : (
                          <span className="font-semibold break-words">{c.name}</span>
                        )}
                        {(brands.labels[c.id] ?? []).map((b) => (
                          <BrandTag key={b} brand={b} palette={brands.palette} />
                        ))}
                        {!c.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Off</span>}
                        {c.reminders === "granted" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Reminders</span>}
                      </p>
                      {accounts ? (
                        <a href={`/customers/${c.id}`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-(--brand)">
                          Account ›
                        </a>
                      ) : (
                        <a href={`/shops/${c.id}`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-(--brand)">
                          📍 Location
                        </a>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className={c.active ? "text-slate-500" : ""}>{c.place}</span>
                        {list.balances && <Money balance={list.balances[c.id]} />}
                      </p>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4">
                        {canEdit &&
                          (c.active ? (
                            <button type="button" onClick={() => setEditing({ kind: "edit", id: c.id })} className="-mx-3 min-h-11 rounded-lg px-3 font-semibold text-slate-600 hover:bg-slate-100">
                              Edit
                            </button>
                          ) : (
                            <button type="button" onClick={() => toggle(c)} className="min-h-11 rounded-lg border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50">
                              Switch on
                            </button>
                          ))}
                        <PhoneLink phone={c.phone} plain={plainPhones || !c.active} />
                        {brandsLink && !accounts && (
                          <a href={`/customers/${c.id}/brands`} className="inline-flex min-h-11 items-center font-semibold text-(--brand)">
                            Brands
                          </a>
                        )}
                        {dropPhones && !accounts && (
                          <a href={`/customers/${c.id}/drop`} className="inline-flex min-h-11 items-center font-semibold text-(--brand)">
                            Drop phones
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {list.more && <p className="p-2 text-sm text-slate-500">More customers than shown: type in the search box to narrow the list.</p>}
      </Card>
    </div>
  );
}

/** Add (name, phone, place) or edit (name, place: the phone is fixed). */
function CustomerForm({ customer, onClose, onSwitchOff }: { customer?: CustomerView; onClose: () => void; onSwitchOff?: () => void }) {
  const [error, setError] = useState<string>();
  const [found, setFound] = useState<CustomerView>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const agreed = f.get("reminders") === "on";
    const body = {
      name: String(f.get("name") ?? ""),
      place: String(f.get("place") ?? ""),
      ...(customer ? {} : { phone: String(f.get("phone") ?? "") }),
      // only when the tick changed: a consent row is a record of what the customer said
      ...(customer?.active && agreed !== (customer.reminders === "granted") ? { reminders: agreed } : {}),
    };
    setBusy(true);
    setError(undefined);
    setFound(undefined);
    const r = customer ? await api(`/api/customers/${customer.id}`, { method: "PATCH", body }) : await api<{ customer?: CustomerView }>("/api/customers", { body });
    setBusy(false);
    if (r.status === 409 && !customer) {
      setFound((r.data as { customer?: CustomerView }).customer);
      return setError(r.error);
    }
    if (!r.ok) return setError(r.error);
    reload();
  }

  async function switchOn(c: CustomerView) {
    const r = await api(`/api/customers/${c.id}`, { method: "PATCH", body: { active: true } });
    if (!r.ok) return setError(r.error);
    reload();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-slate-50 p-3">
      <TextField label="Name" name="name" defaultValue={customer?.name} maxLength={NAME_MAX} required autoComplete="off" />
      {customer ? (
        <p className="text-sm text-slate-600">
          Phone {fmt(customer.phone)} <span className="text-slate-500">(can&apos;t be changed: a different number is a new customer)</span>
        </p>
      ) : (
        <TextField label="Phone" name="phone" inputMode="tel" placeholder="98765 43210" maxLength={30} required autoComplete="off" />
      )}
      <TextField label="Place" name="place" defaultValue={customer?.place} maxLength={PLACE_MAX} required autoComplete="off" />
      {customer?.active && (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" name="reminders" defaultChecked={customer.reminders === "granted"} className="mt-1 h-5 w-5 shrink-0 accent-(--brand)" />
          <span>
            <span className="font-semibold">Agreed to WhatsApp reminders</span>
            <span className="block text-slate-600">Tick only after reading this to the customer and hearing yes: &ldquo;{OPTIN_TEXT}&rdquo;</span>
          </span>
        </label>
      )}
      <ErrorText>{error}</ErrorText>
      {found && !found.active && (
        <Button type="button" variant="secondary" onClick={() => switchOn(found)}>
          Switch {found.name} back on
        </Button>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : customer ? "Save" : "Add customer"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {customer?.active && onSwitchOff && (
        <div className="border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={() => window.confirm(`Switch off ${customer.name}? They leave this list and New order. You can switch them back on later.`) && onSwitchOff()}
            className="min-h-11 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
          >
            Switch off this customer
          </button>
        </div>
      )}
    </form>
  );
}

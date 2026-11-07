"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import type { MatchContact, MatchData } from "@/server/zoho-match";

type Tab = "todo" | "linked" | "customers";
const PAGE = 60;
const ph = (p: string | null) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : "no mobile");
const input = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";
const small = "min-h-10 px-3 text-sm";

/** Three lists that together hold every Zoho contact and every customer: nothing can be missed. */
export function MatchScreen({ data }: { data: MatchData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(data.counts.unmatched ? "todo" : "linked");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const byLabel = useMemo(() => new Map(data.customers.map((c) => [`${c.name} · ${ph(c.phone)} · ${c.place}`, c.id])), [data.customers]);

  async function act(key: string, body: object) {
    setBusy(key);
    setError(undefined);
    const r = await api("/api/zoho-match", { body });
    setBusy(undefined);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  const needle = q.trim().toLowerCase();
  const hit = (...xs: (string | null)[]) => !needle || xs.some((x) => x?.toLowerCase().includes(needle) || x?.replace(/\s/g, "").includes(needle.replace(/\s/g, "")));
  const todo = data.contacts.filter((c) => !c.customer && hit(c.name, c.mobile));
  const linked = data.contacts.filter((c) => c.customer && hit(c.name, c.mobile, c.customer.name, c.customer.phone));
  const lonely = data.customers.filter((c) => c.contacts === 0 && hit(c.name, c.phone, c.place));
  const list = tab === "todo" ? todo : tab === "linked" ? linked : lonely;
  const k = data.counts;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-700">
          <b>{k.contacts}</b> Zoho contacts: <b>{k.linked}</b> linked, <b>{k.unmatched}</b> to match. <b>{k.customers}</b> customers here:{" "}
          <b>{k.customers_with_zoho}</b> with a Zoho contact, <b>{k.customers_without_zoho}</b> without.
        </p>
        <p className="mt-1 text-xs text-slate-500">A contact&apos;s bills and payments follow its link. Linking never changes your customer&apos;s name or mobile.</p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {([["todo", `To match (${k.unmatched})`], ["linked", `Linked (${k.linked})`], ["customers", `Your customers without Zoho (${k.customers_without_zoho})`]] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setShown(PAGE); }}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === t ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>
      <input className={input} placeholder="Search name or mobile" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
      <ErrorText>{error}</ErrorText>
      {/* one list of every customer for the "link to …" boxes */}
      <datalist id="all-customers">{[...byLabel.keys()].map((l) => <option key={l} value={l} />)}</datalist>

      {tab === "todo" && <NoMobileBulk count={data.contacts.filter((c) => !c.customer && !c.mobile).length} busy={busy} act={act} />}
      {list.length === 0 && <p className="text-sm text-slate-500">{needle ? "Nothing found." : tab === "todo" ? "Everything is matched. ✓" : "None."}</p>}
      {tab === "todo" && todo.slice(0, shown).map((c) => <ToMatch key={c.id} c={c} byLabel={byLabel} busy={busy} act={act} />)}
      {tab === "linked" && linked.slice(0, shown).map((c) => (
        <Card key={c.id}>
          <ContactLine c={c} />
          <p className="mt-1 text-sm">→ <b>{c.customer!.name}</b> · {ph(c.customer!.phone)}</p>
          <Button variant="secondary" className={`mt-2 ${small}`} disabled={!!busy} onClick={() => act(c.id, { action: "unlink", contact_id: c.id })}>Unlink</Button>
        </Card>
      ))}
      {tab === "customers" && lonely.slice(0, shown).map((c) => (
        <Card key={c.id}>
          <p className="font-medium">{c.name}{c.active ? "" : " (switched off)"}</p>
          <p className="text-sm text-slate-500">{ph(c.phone)} · {c.place}</p>
          {c.suggestions.length === 0 && <p className="mt-1 text-xs text-slate-400">No Zoho contact looks like this customer.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {c.suggestions.map((s) => (
              <Button key={s.id} variant="secondary" className={small} disabled={!!busy} onClick={() => act(s.id, { action: "link", contact_id: s.id, customer_id: c.id })}>
                Link Zoho: {s.name} ({ph(s.mobile)}, {Math.round(s.score * 100)}%)
              </Button>
            ))}
          </div>
        </Card>
      ))}
      {list.length > shown && <Button variant="secondary" className="w-full" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown} left)</Button>}
    </div>
  );
}

/** All contacts to match that have no mobile → one customer (e.g. "Retail Customer"), in one step. */
function NoMobileBulk({ count, busy, act }: { count: number; busy?: string; act: (key: string, body: object) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", place: "" });
  if (!count) return null;
  const go = async () => {
    if (!window.confirm(`Link all ${count} Zoho contacts with no mobile to ${form.name || "this customer"} (${form.phone})? Their bills and payments move to that customer's account. Each can be unlinked later.`)) return;
    await act("no-mobile", { action: "link_no_mobile", ...form });
    setOpen(false);
  };
  return (
    <Card>
      <p className="text-sm text-slate-700"><b>{count}</b> contacts to match have no mobile.</p>
      {!open ? (
        <button className="mt-1 text-sm font-medium text-(--brand)" onClick={() => setOpen(true)}>Link all {count} to one customer…</button>
      ) : (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-slate-500">The customer with this mobile is used if you have one (its name stays); otherwise it is added with this name and place.</p>
          <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Mobile" inputMode="tel" maxLength={30} />
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. Retail Customer" maxLength={100} />
          <input className={input} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Place" maxLength={200} />
          <div className="flex gap-2">
            <Button className={small} disabled={!!busy || !form.phone.trim()} onClick={go}>{busy === "no-mobile" ? "Linking…" : `Link all ${count}`}</Button>
            <Button variant="secondary" className={small} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ContactLine({ c }: { c: MatchContact }) {
  return (
    <>
      <p className="font-medium">{c.name} <span className="text-xs font-normal text-slate-400">Zoho</span></p>
      <p className="text-sm text-slate-500">
        {ph(c.mobile)}{c.gstin ? ` · GSTIN ${c.gstin}` : ""} · {c.bills} bills{c.bills ? `, ${money(c.billed)}, last ${c.last_bill}` : ""}
      </p>
    </>
  );
}

function ToMatch({ c, byLabel, busy, act }: { c: MatchContact; byLabel: Map<string, string>; busy?: string; act: (key: string, body: object) => void }) {
  const [pick, setPick] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: c.name.slice(0, 100), phone: c.mobile ?? "", place: c.place_guess === "Not set" ? "" : c.place_guess });
  const picked = byLabel.get(pick);
  return (
    <Card>
      <ContactLine c={c} />
      <div className="mt-2 flex flex-wrap gap-2">
        {c.suggestions.map((s) => (
          <Button key={s.id} variant="secondary" className={small} disabled={!!busy} onClick={() => act(c.id, { action: "link", contact_id: c.id, customer_id: s.id })}>
            Link: {s.name} ({ph(s.phone)}){s.why === "mobile" ? " · same mobile" : ` · ${Math.round(s.score * 100)}%`}
          </Button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className={input} list="all-customers" placeholder="Or find any customer…" value={pick} onChange={(e) => setPick(e.target.value)} />
        <Button variant="secondary" className={small} disabled={!picked || !!busy} onClick={() => act(c.id, { action: "link", contact_id: c.id, customer_id: picked })}>Link</Button>
      </div>
      {!adding ? (
        <button className="mt-2 text-sm font-medium text-(--brand)" onClick={() => setAdding(true)}>+ Add as new customer</button>
      ) : (
        <div className="mt-2 grid gap-2">
          <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" maxLength={100} />
          <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Mobile (needed)" inputMode="tel" maxLength={30} />
          <input className={input} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Place" maxLength={200} />
          <div className="flex gap-2">
            <Button className={small} disabled={!!busy} onClick={() => act(c.id, { action: "new_customer", contact_id: c.id, ...form })}>Save as new customer</Button>
            <Button variant="secondary" className={small} onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

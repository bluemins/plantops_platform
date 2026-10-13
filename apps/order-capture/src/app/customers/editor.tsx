"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { NAME_MAX, PLACE_MAX } from "@/lib/upload";
import type { CustomerView } from "@/server/customers";
import { PhoneLink } from "../parts";

type List = { customers: CustomerView[]; more: boolean; total: number; off: number };
type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

const reload = () => window.location.reload();
const fmt = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;

/** Search, add, edit name / place, switch off / on. PlantOps support gets the same list without buttons. */
export function CustomersEditor({ list, q, showOff, canEdit, plainPhones }: { list: List; q: string; showOff: boolean; canEdit: boolean; plainPhones: boolean }) {
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
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit && editing?.kind !== "new" && <Button onClick={() => setEditing({ kind: "new" })}>+ Add customer</Button>}
        {list.off > 0 && (
          <a href={`/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(showOff ? {} : { off: "1" }) })}`} className="flex min-h-12 items-center text-sm font-semibold text-(--brand)">
            {showOff ? "Hide switched-off" : `Show switched-off (${list.off})`}
          </a>
        )}
      </div>
      {editing?.kind === "new" && <CustomerForm onClose={close} />}
      <ErrorText>{error}</ErrorText>

      <Card className="p-3">
        {list.customers.length === 0 ? (
          <p className="p-2 text-slate-500">{q ? "No customer matches this search." : list.total === 0 ? "No customers yet." : "No customers to show."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.customers.map((c) => (
              <li key={c.id} className="py-3">
                {editing?.kind === "edit" && editing.id === c.id ? (
                  <CustomerForm customer={c} onClose={close} />
                ) : (
                  <div className="space-y-2 px-1">
                    <div className={`min-w-0 ${c.active ? "" : "text-slate-400"}`}>
                      <p className="font-semibold break-words">
                        {c.name}
                        {!c.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Off</span>}
                      </p>
                      <p className="text-sm text-slate-600">{c.place}</p>
                      <p className="text-sm">
                        <PhoneLink phone={c.phone} plain={plainPhones || !c.active} />
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <Button variant="secondary" className="min-h-11 px-4 text-sm" onClick={() => setEditing({ kind: "edit", id: c.id })}>
                          Edit
                        </Button>
                        <Button variant={c.active ? "danger" : "secondary"} className="min-h-11 px-4 text-sm" onClick={() => toggle(c)}>
                          {c.active ? "Switch off" : "Switch on"}
                        </Button>
                      </div>
                    )}
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
function CustomerForm({ customer, onClose }: { customer?: CustomerView; onClose: () => void }) {
  const [error, setError] = useState<string>();
  const [found, setFound] = useState<CustomerView>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name") ?? ""), place: String(f.get("place") ?? ""), ...(customer ? {} : { phone: String(f.get("phone") ?? "") }) };
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
    </form>
  );
}

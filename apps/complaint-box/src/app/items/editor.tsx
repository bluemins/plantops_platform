"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import type { StarterItem } from "@/lib/starter";
import type { ItemView } from "@/server/items";

type Product = { id: string; label: string };
type Editing = { kind: "new" } | { kind: "rename"; id: string } | null;

const done = () => window.location.reload();

/** Moves one id up or down in a list; null when it is already at that end. */
function moved(ids: string[], id: string, by: -1 | 1) {
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

const complaintsText = (n: number) => (n === 0 ? "No complaints" : n === 1 ? "1 complaint" : `${n} complaints`);

/** The owner's item list. PlantOps support gets the same list without any buttons (`canEdit` false). */
export function ItemsEditor({ items, products, starter, canEdit }: { items: ItemView[]; products: Product[]; starter: StarterItem[] | null; canEdit: boolean }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [showOff, setShowOff] = useState(false);
  const [skipStarter, setSkipStarter] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => setEditing(null);
  const offCount = items.filter((i) => i.status === "off").length;
  const visible = showOff ? items : items.filter((i) => i.status === "active");

  async function call(path: string, body: unknown, method = "POST") {
    setError(undefined);
    const r = await api(path, { method, body });
    if (!r.ok) return setError(r.error);
    done();
  }
  const move = (id: string, by: -1 | 1) => {
    const ids = moved(items.map((i) => i.id), id, by);
    if (ids) void call("/api/items/order", { ids });
  };

  if (canEdit && starter && !skipStarter) return <StarterOffer starter={starter} onSkip={() => setSkipStarter(true)} />;

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        The products and equipment customers complain about. Staff pick one when they log a complaint. Items are switched off, never deleted, so old
        complaints keep their item.
      </p>
      <ErrorText>{error}</ErrorText>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit && editing?.kind !== "new" && <Button onClick={() => setEditing({ kind: "new" })}>+ Add item</Button>}
        {offCount > 0 && (
          <label className="flex min-h-12 items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
            Show switched-off ({offCount})
          </label>
        )}
      </div>
      {editing?.kind === "new" && <ItemForm products={products} onClose={close} />}

      <Card>
        {items.length === 0 ? (
          <p className="text-slate-500">{canEdit ? "No items yet. Add the first one." : "The plant owner has not set up the item list yet."}</p>
        ) : visible.length === 0 ? (
          <p className="text-slate-500">Every item is switched off.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((item) => {
              const off = item.status === "off";
              return (
                <li key={item.id} className="py-3">
                  {editing?.kind === "rename" && editing.id === item.id ? (
                    <ItemForm item={item} products={products} onClose={close} />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold ${off ? "text-slate-400" : ""}`}>
                          {item.name}
                          {item.sku_id && <Chip>Product</Chip>}
                          {off && <Chip>Switched off</Chip>}
                        </p>
                        <p className="text-sm text-slate-500">{complaintsText(item.complaint_count)}</p>
                      </div>
                      {canEdit && (
                        <div className="flex flex-wrap gap-2">
                          <SmallButton label={`Move ${item.name} up`} onClick={() => move(item.id, -1)}>↑</SmallButton>
                          <SmallButton label={`Move ${item.name} down`} onClick={() => move(item.id, 1)}>↓</SmallButton>
                          <SmallButton onClick={() => setEditing({ kind: "rename", id: item.id })}>Rename</SmallButton>
                          <SmallButton
                            onClick={() => {
                              if (!off && !confirm(`Switch off "${item.name}"? Staff can no longer pick it for new complaints. Old complaints keep it.`)) return;
                              void call(`/api/items/${item.id}`, { status: off ? "active" : "off" }, "PATCH");
                            }}
                          >
                            {off ? "Switch on" : "Switch off"}
                          </SmallButton>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** First start: the starter list with a tick box per entry (all ticked); only the ticked ones are created. */
function StarterOffer({ starter, onSkip }: { starter: StarterItem[]; onSkip: () => void }) {
  const [keys, setKeys] = useState(() => new Set(starter.map((s) => s.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const products = starter.filter((s) => s.sku_id).length;
  const toggle = (key: string) => setKeys((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  async function apply() {
    setBusy(true);
    setError(undefined);
    const r = await api("/api/items/starter", { body: { keys: starter.filter((s) => keys.has(s.key)).map((s) => s.key) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  return (
    <Card className="space-y-4">
      <p className="text-lg font-semibold">Start with a ready list?</p>
      <p className="text-slate-600">
        Your {products} PlantOps product{products === 1 ? "" : "s"} plus a few common complaint topics. Untick anything you don&apos;t want. You can rename,
        add, re-order or switch off items afterwards.
      </p>
      {products === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No products were found. Add your products in PlantOps Business details to have them here.</p>}
      <ul className="space-y-2">
        {starter.map((s) => (
          <li key={s.key}>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={keys.has(s.key)} onChange={() => toggle(s.key)} />
              <span className="min-w-0 flex-1 font-medium">{s.name}</span>
              {s.sku_id && <Chip>Product</Chip>}
            </label>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button onClick={apply} disabled={busy || keys.size === 0}>
          {busy ? "Creating…" : `Create ${keys.size} item${keys.size === 1 ? "" : "s"}`}
        </Button>
        <Button variant="secondary" onClick={onSkip} disabled={busy}>
          Skip, I&apos;ll add my own
        </Button>
      </div>
    </Card>
  );
}

/** New item (name + optional product link, chosen once) or rename an existing one. */
function ItemForm({ item, products, onClose }: { item?: ItemView; products: Product[]; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = item ? await api(`/api/items/${item.id}`, { method: "PATCH", body: { name } }) : await api("/api/items", { body: { name, sku_id: sku || null } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    done();
  }
  const pick = (id: string) => {
    setSku(id);
    const p = products.find((x) => x.id === id);
    if (p && !name.trim()) setName(p.label.slice(0, 60));
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-(--brand-ring) bg-(--brand-soft)/40 p-4">
      <p className="font-semibold">{item ? "Rename item" : "New item"}</p>
      {!item && products.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">PlantOps product (optional)</span>
          <select value={sku} onChange={(e) => pick(e.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
            <option value="">Not a product (e.g. Dispenser, Delivery)</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <TextField label="Item name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="e.g. 20 L jar" />
      {!item && sku && <p className="text-sm text-slate-500">The product link can&apos;t be changed later.</p>}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SmallButton({ onClick, label, children }: { onClick: () => void; label?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold hover:bg-slate-50">
      {children}
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="ml-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-slate-600">{children}</span>;
}

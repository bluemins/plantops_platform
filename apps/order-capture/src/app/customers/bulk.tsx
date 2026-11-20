"use client";

// Change many customers at once (owner, 2026-11-20; mock-up https://claude.ai/artifact/5qiMi1ZN47SAHKMiUNK8mz): the bar at
// the bottom of the list in Select mode and the Change… panel (one change per save), then what happened.
import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { brandColour, type BrandPalette } from "@/lib/brand";
import { BILL_TERMS, TERMS_LABEL, type BillTerms } from "@/lib/ledger";
import { PLACE_MAX } from "@/lib/upload";
import type { BulkResult, bulkSetup } from "@/server/customer-bulk";

export type BulkSetup = Awaited<ReturnType<typeof bulkSetup>>;
type Kind = "brands" | "place" | "terms" | "drop";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "brands", label: "Brands they buy" },
  { kind: "place", label: "Place" },
  { kind: "terms", label: "Payment terms" },
  { kind: "drop", label: "Drop app" },
];
const DONE_TITLE: Record<Kind, string> = { brands: "Brands they buy changed", place: "Place changed", terms: "Payment terms changed", drop: "Drop app changed" };
const brandLabel = (b: string) => b || "Other (no brand)";
const plural = (n: number) => `${n} customer${n === 1 ? "" : "s"}`;

/** Bottom bar: "12 customers ticked" + Change… */
export function BulkBar({ count, onChange }: { count: number; onChange: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 pt-3 pb-5 shadow-[0_-6px_18px_rgba(17,24,39,0.08)]">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <span className="flex-1 text-sm">
          <b>{count}</b> {count === 1 ? "customer" : "customers"} ticked
        </span>
        <Button onClick={onChange} disabled={count === 0}>
          Change…
        </Button>
      </div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-11 rounded-xl px-3 text-sm ${on ? "border-2 border-(--brand) bg-(--brand-soft) font-semibold" : "border border-slate-300 bg-white"}`}>
      {children}
    </button>
  );
}

function Radio({ name, checked, onChange, title, note }: { name: string; checked: boolean; onChange: () => void; title: string; note?: string }) {
  return (
    <label className={`flex min-h-11 items-start gap-3 rounded-xl p-3 ${checked ? "border-2 border-(--brand) bg-(--brand-soft)" : "border border-slate-300"}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 h-5 w-5 shrink-0 accent-(--brand)" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        {note && <span className="block text-xs text-slate-600">{note}</span>}
      </span>
    </label>
  );
}

function BrandTicks({ choices, ticked, palette, onToggle }: { choices: string[]; ticked: string[]; palette: BrandPalette; onToggle: (b: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {choices.map((b) => (
        <label key={b} className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm ${b ? brandColour(b, palette) : "bg-slate-100"} ${ticked.includes(b) ? "font-semibold" : ""}`}>
          <input type="checkbox" checked={ticked.includes(b)} onChange={() => onToggle(b)} className="h-5 w-5 shrink-0 accent-(--brand)" />
          {brandLabel(b)}
        </label>
      ))}
    </div>
  );
}

/** The Change… panel: pick what to change, set it, Save for N. */
export function BulkPanel({ ids, names, setup, palette, onClose }: { ids: string[]; names: string[]; setup: BulkSetup; palette: BrandPalette; onClose: () => void }) {
  const kinds = KINDS.filter((k) => k.kind !== "drop" || setup.drop);
  const [kind, setKind] = useState<Kind>("brands");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [brands, setBrands] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [terms, setTerms] = useState<BillTerms | "none">("receipt");
  const [dropOn, setDropOn] = useState(true);
  const [dropBrands, setDropBrands] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<BulkResult>();

  const toggle = (list: string[], set: (l: string[]) => void) => (b: string) => set(list.includes(b) ? list.filter((x) => x !== b) : [...list, b]);
  const n = ids.length;
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  const placeHits = (() => {
    const t = place.trim().toLowerCase();
    const list = t ? setup.places.filter((p) => p.place.toLowerCase().includes(t)) : setup.places;
    return list.slice(0, 8);
  })();

  let summary: string | null = null;
  if (kind === "brands" && brands.length) summary = `${plural(n)} will ${mode === "add" ? "get" : "buy only"} ${brands.map(brandLabel).join(", ")}. New order will list only their brands.`;
  if (kind === "brands" && !brands.length && mode === "replace") summary = `${plural(n)} will be back to every brand (nothing ticked).`;
  if (kind === "place" && place.trim()) summary = `${plural(n)} will have the place “${place.trim()}”. Old orders keep the place they were saved with.`;
  if (kind === "terms") summary = `${plural(n)} will have ${terms === "none" ? "no payment terms (the plant's usual)" : TERMS_LABEL[terms]}. Only new bills use it; bills already made keep their due date.`;
  if (kind === "drop") summary = dropOn ? `${plural(n)} can log in to the Drop app. Switched-off customers are skipped.` : `${plural(n)} lose the Drop app and are logged out at once.`;
  const ready = kind === "brands" ? brands.length > 0 || mode === "replace" : kind === "place" ? place.trim().length >= 2 : true;

  async function save() {
    const change =
      kind === "brands" ? { kind, mode, brands } : kind === "place" ? { kind, place: place.trim() } : kind === "terms" ? { kind, terms: terms === "none" ? null : terms } : { kind, enabled: dropOn, brands: dropBrands };
    setBusy(true);
    setError(undefined);
    const r = await api<BulkResult>("/api/customers/bulk", { body: { ids, change } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/45" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
      <div className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-2xl bg-white p-4 pb-6">
        {done ? (
          <>
            <h2 id="bulk-title" className="text-lg font-bold">
              {DONE_TITLE[kind]}
            </h2>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2.5">
                <span>Changed</span>
                <b>{done.changed}</b>
              </p>
              <p className="flex justify-between rounded-lg bg-slate-100 px-3 py-2.5">
                <span>Already like that</span>
                <b>{done.same}</b>
              </p>
              {done.skipped.length > 0 && (
                <p className="flex justify-between rounded-lg bg-amber-50 px-3 py-2.5">
                  <span>Skipped</span>
                  <b>{done.skipped.length}</b>
                </p>
              )}
            </div>
            {done.skipped.length > 0 && (
              <ul className="space-y-1 text-sm text-slate-700">
                {done.skipped.map((s, i) => (
                  <li key={i}>
                    <b>{s.name}:</b> {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">Each customer has its own line in Recent changes.</p>
            <Button onClick={() => window.location.reload()}>Back to the list</Button>
          </>
        ) : (
          <>
            <div>
              <h2 id="bulk-title" className="text-lg font-bold">
                Change {plural(n)}
              </h2>
              <p className="text-sm text-slate-600">{who}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">What to change</p>
              <div className="grid grid-cols-2 gap-2">
                {kinds.map((k) => (
                  <Choice key={k.kind} on={kind === k.kind} onClick={() => setKind(k.kind)}>
                    {k.label}
                  </Choice>
                ))}
              </div>
            </div>

            {kind === "brands" && (
              <div className="space-y-2">
                <Radio name="mode" checked={mode === "add"} onChange={() => setMode("add")} title="Add these brands" note="Keeps any brand a customer already has" />
                <Radio name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} title="Replace with these brands" note="Their brands become exactly the ticked ones (none ticked = every brand)" />
                <BrandTicks choices={setup.brands} ticked={brands} palette={palette} onToggle={toggle(brands, setBrands)} />
              </div>
            )}

            {kind === "place" && (
              <div className="space-y-2">
                <label htmlFor="bulk-place" className="block text-sm font-semibold">
                  New place for all {n}
                </label>
                <input
                  id="bulk-place"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  maxLength={PLACE_MAX}
                  autoComplete="off"
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
                />
                {placeHits.length > 0 && (
                  <>
                    <p className="text-xs text-slate-600">Places already used (tap one so spellings stay the same):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {placeHits.map((p) => (
                        <button
                          key={p.place}
                          type="button"
                          onClick={() => setPlace(p.place)}
                          className={`min-h-9 rounded-full px-3 text-sm ${p.place === place.trim() ? "bg-(--brand) text-(--brand-contrast)" : "bg-slate-100 text-slate-800"}`}
                        >
                          {p.place} · {p.count}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {kind === "terms" && (
              <div className="space-y-2">
                {BILL_TERMS.map((t) => (
                  <Radio key={t} name="terms" checked={terms === t} onChange={() => setTerms(t)} title={TERMS_LABEL[t]} />
                ))}
                <Radio name="terms" checked={terms === "none"} onChange={() => setTerms("none")} title="Not set (use the plant's usual)" />
              </div>
            )}

            {kind === "drop" && setup.drop && (
              <div className="space-y-2">
                <Radio name="drop" checked={dropOn} onChange={() => setDropOn(true)} title="Switch Drop on" note="They can log in to the Drop app with their mobile" />
                <Radio name="drop" checked={!dropOn} onChange={() => setDropOn(false)} title="Switch Drop off" note="Logs them out of the app at once" />
                {setup.drop.choices.length > 0 && (
                  <>
                    <p className="pt-1 text-xs font-bold uppercase tracking-wide text-slate-500">Also show in the app (besides {setup.drop.main})</p>
                    <BrandTicks choices={setup.drop.choices} ticked={dropBrands} palette={palette} onToggle={toggle(dropBrands, setDropBrands)} />
                    <p className="text-xs text-slate-600">Leave all unticked to keep each shop&apos;s Drop brands as they are.</p>
                  </>
                )}
              </div>
            )}

            {summary && <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{summary}</p>}
            <ErrorText>{error}</ErrorText>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={busy || !ready}>
                {busy ? "Saving…" : `Save for ${n}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

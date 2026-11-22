"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { qty } from "@/lib/compare";
import { NOT_UPDATED_LABEL, totalsOf, usedMaterials, type UsedMaterial } from "@/lib/not-updated";
import type { CountForm, FormItem, FormLine } from "@/server/counts";

type Kind = "production" | "stock";
type Draft = { qty: string; second: string; remark: string };
type Drafts = Record<string, Draft[]>;

const MAX_LINES = 20;
const key = (itemId: string, kind: Kind) => `${itemId}:${kind}`;
const empty = (): Draft => ({ qty: "", second: "", remark: "" });
const isBlank = (d: Draft) => !d.qty.trim() && !d.second.trim() && !d.remark.trim();
const toDraft = (l: FormLine): Draft => ({ qty: qty(l.qty), second: l.second_qty === null ? "" : qty(l.second_qty), remark: l.remark ?? "" });
/** "1,5" (comma decimal on some phone keyboards) reads as 1.5 */
const parse = (s: string) => (s.trim() === "" ? null : Number(s.trim().replace(",", ".")));
const valid = (n: number | null) => n !== null && Number.isFinite(n) && n >= 0 && Math.round(n * 100) / 100 === n;

function initialDrafts(form: CountForm): Drafts {
  const d: Drafts = {};
  for (const l of form.lines) (d[key(l.item_id, l.kind)] ??= []).push(toDraft(l));
  for (const s of form.sections) {
    for (const i of s.items) {
      d[key(i.id, "stock")] ??= [empty()];
      if (s.kind === "finished") d[key(i.id, "production")] ??= [empty()];
    }
  }
  return d;
}

/** The count, one long page in the WhatsApp message's order: today's production, then closing stock per section. */
export function CountEntry({ form }: { form: CountForm }) {
  const [drafts, setDrafts] = useState<Drafts>(() => initialDrafts(form));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [warn, setWarn] = useState<UsedMaterial[] | null>(null);
  const finished = form.sections.filter((s) => s.kind === "finished" && s.items.length);

  // "Consumable not updated correctly" (owner, 2026-11-22): materials used by what is typed as made, still at the last
  // count's number. Warn only: the note and the sheet on Submit; the save is never refused.
  const used = useMemo(() => {
    const typed: { item_id: string; kind: Kind; qty: number; second_qty: number | null }[] = [];
    for (const [k, lines] of Object.entries(drafts)) {
      const [item_id, kind] = k.split(":") as [string, Kind];
      for (const d of lines) {
        const n = parse(d.qty);
        if (n === null || !valid(n)) continue;
        const second = parse(d.second);
        typed.push({ item_id, kind, qty: n, second_qty: kind === "stock" && second !== null && valid(second) ? second : null });
      }
    }
    const t = totalsOf(typed);
    return new Map(usedMaterials(form.materials, t.production, t.closing).map((m) => [m.item_id, m]));
  }, [drafts, form.materials]);

  // Leaving with typed numbers asks first (phones lose a half-typed count easily).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (k: string, lines: Draft[]) => {
    setDirty(true);
    setDrafts((d) => ({ ...d, [k]: lines }));
  };

  /** Turns the drafts into lines for the server, or the first problem in plain words. */
  function collect(): { lines: object[] } | { error: string } {
    const lines: object[] = [];
    for (const s of form.sections) {
      for (const item of s.items) {
        for (const kind of (s.kind === "finished" ? ["production", "stock"] : ["stock"]) as Kind[]) {
          const typed = (drafts[key(item.id, kind)] ?? []).filter((d) => !isBlank(d));
          const label = kind === "production" ? `today's production of "${item.name}"` : `"${item.name}" (${s.name})`;
          if (kind === "stock" && typed.length === 0) return { error: `Please enter the closing stock of ${label}` };
          for (const d of typed) {
            const n = parse(d.qty);
            if (n === null) return { error: `Please enter a number for ${label}, or remove that line` };
            if (!valid(n)) return { error: `The number for ${label} must be 0 or more, with at most 2 decimals` };
            const second = kind === "stock" && item.second_unit ? parse(d.second) : null;
            if (second !== null && !valid(second)) return { error: `The ${item.second_unit} for ${label} must be 0 or more, with at most 2 decimals` };
            lines.push({ item_id: item.id, kind, qty: n, second_qty: second, remark: d.remark.trim() || null });
          }
        }
      }
    }
    return { lines };
  }

  async function submit() {
    setError(undefined);
    const got = collect();
    if ("error" in got) return setError(got.error);
    if (form.current && reason.trim().length < 3) return setError("Please say why the count is being corrected (at least 3 characters)");
    const flagged = [...used.values()].filter((m) => m.not_updated);
    if (flagged.length) return setWarn(flagged);
    const question = form.current ? "Save this correction? The old version stays on record." : "Submit the count? It is locked after saving; mistakes are fixed with a correction.";
    if (!confirm(question)) return;
    await save(got.lines);
  }

  async function save(lines: object[]) {
    setWarn(null);
    setBusy(true);
    const r = await api("/api/counts", { body: { date: form.date, expected_version: form.current?.version ?? 0, reason: form.current ? reason.trim() : null, lines } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDirty(false);
    window.location.href = `/day/${form.date}`;
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        {form.current
          ? `Showing version ${form.current.version} (${form.current.entered_by}). Change what was wrong; the old version stays on record.`
          : form.prefill_from
            ? `Closing stock is filled in from the count of ${fmtDate(form.prefill_from)}. Change only what changed. Production starts empty.`
            : "First count: fill in every item."}
      </p>

      {finished.length > 0 && (
        <Card>
          <h2 className="mb-1 text-lg font-bold">Today production</h2>
          <p className="mb-2 text-sm text-slate-500">Made today. Leave blank if nothing was made.</p>
          {finished.map((s) => (
            <div key={s.id}>
              {finished.length > 1 && <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-slate-500">{s.name}</h3>}
              <ul className="divide-y divide-slate-100">
                {s.items.map((item) => (
                  <ItemLines key={item.id} item={item} kind="production" lines={drafts[key(item.id, "production")]!} onChange={(l) => update(key(item.id, "production"), l)} />
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}

      {form.sections
        .filter((s) => s.items.length)
        .map((s) => (
          <Card key={s.id}>
            <h2 className="mb-2 text-lg font-bold">
              {s.name}
              {s.kind === "finished" && <span className="ml-2 text-sm font-normal text-slate-500">closing stock</span>}
            </h2>
            <ul className="divide-y divide-slate-100">
              {s.items.map((item) => (
                <ItemLines key={item.id} item={item} kind="stock" lines={drafts[key(item.id, "stock")]!} onChange={(l) => update(key(item.id, "stock"), l)} used={used.get(item.id)} />
              ))}
            </ul>
          </Card>
        ))}

      {form.current && (
        <Card>
          <label className="block">
            <span className="mb-1 block font-semibold">Why is it being corrected?</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base" placeholder="e.g. 500 ml boxes were counted twice" />
          </label>
        </Card>
      )}

      {warn && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/55" role="dialog" aria-modal="true" aria-labelledby="warn-title">
          <div className="max-h-[85vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-t-2xl bg-white px-4 pt-5 pb-6">
            <h2 id="warn-title" className="text-xl font-bold">
              {warn.length} material{warn.length === 1 ? "" : "s"} not updated
            </h2>
            <p className="text-slate-600">
              Production was entered, but these still show the number of {form.materials?.previous_date ? fmtDate(form.materials.previous_date) : "the last count"}. They will be marked &ldquo;{NOT_UPDATED_LABEL}&rdquo; for everyone who sees this count.
            </p>
            <ul className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {warn.map((m) => (
                <li key={m.item_id}>
                  <b>{m.name}</b>: {qty(m.closing)} {m.unit}
                  {m.expected !== null ? ` (expected about ${qty(m.expected)} ${m.unit})` : m.also.length ? ` (${m.also.join(", ")} also unchanged)` : ""}
                  <br />
                  used by {usedByText(m)}
                </li>
              ))}
            </ul>
            <Button className="w-full" onClick={() => setWarn(null)}>
              Go back and fix
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const got = collect();
                if ("error" in got) return setWarn(null), setError(got.error);
                void save(got.lines);
              }}
            >
              {busy ? "Saving…" : "Save anyway (they really didn't change)"}
            </Button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2">
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : form.current ? "Save correction" : "Submit count"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One item: its lines (number, second number, remark), "+ Add line", and the total when there are several. */
const usedByText = (m: UsedMaterial) => m.used_by.map((u) => `${u.name}, ${qty(u.qty)} ${u.unit} made`).join("; ");

function ItemLines({ item, kind, lines, onChange, used }: { item: FormItem; kind: Kind; lines: Draft[]; onChange: (lines: Draft[]) => void; used?: UsedMaterial }) {
  const second = kind === "stock" ? item.second_unit : null;
  const set = (i: number, patch: Partial<Draft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + Math.round((parse(l.qty) ?? 0) * 100), 0) / 100;
  return (
    <li className="py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-semibold">{item.name}</span>
        {lines.length > 1 && (
          <span className="text-sm text-slate-500">
            total {qty(total)} {item.unit}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <NumberBox value={l.qty} onChange={(v) => set(i, { qty: v })} unit={item.unit} label={`${item.name} ${kind === "production" ? "made" : "closing stock"}`} />
            {second && <NumberBox value={l.second} onChange={(v) => set(i, { second: v })} unit={second} label={`${item.name} ${second}`} />}
            <input
              value={l.remark}
              onChange={(e) => set(i, { remark: e.target.value })}
              maxLength={120}
              placeholder="Remark (party…)"
              aria-label={`${item.name} remark`}
              className="min-h-12 min-w-0 flex-1 basis-32 rounded-xl border border-slate-300 bg-white px-3 text-base"
            />
            {lines.length > 1 && (
              <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove this line" className="min-h-12 min-w-12 rounded-xl border border-slate-300 bg-white font-semibold text-slate-600">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {used?.not_updated && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {NOT_UPDATED_LABEL}: {usedByText(used)} today.
          {used.expected !== null ? (
            <>
              {" "}Expected about <b>{qty(used.expected)} {item.unit}</b>.
            </>
          ) : used.also.length ? (
            ` ${used.also.join(", ")} didn't change either.`
          ) : null}
        </p>
      )}
      {used && !used.not_updated && <p className="mt-1 text-sm text-green-700">Updated ✓{used.expected !== null ? ` (expected about ${qty(used.expected)} ${item.unit})` : ""}</p>}
      {lines.length < MAX_LINES && (
        <button type="button" onClick={() => onChange([...lines, empty()])} className="mt-2 min-h-11 text-sm font-semibold text-(--brand)">
          + Add line
        </button>
      )}
    </li>
  );
}

function NumberBox({ value, onChange, unit, label }: { value: string; onChange: (v: string) => void; unit: string; label: string }) {
  return (
    <label className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={label}
        className="min-h-12 w-24 rounded-xl border border-slate-300 bg-white px-3 text-right text-lg font-semibold focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)"
      />
      <span className="text-sm text-slate-500">{unit}</span>
    </label>
  );
}

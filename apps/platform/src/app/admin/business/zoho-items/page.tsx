"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { parseCsv } from "@/lib/csv-read";
import { FIELD_LABEL, PACK_TYPES, readZohoItems, type FieldChange, type ItemsPlan, type NewSpec, type ZohoItem } from "@/lib/zoho-items";

type Me = { roles: string[]; must_change_secret: boolean };
type Preview = ItemsPlan & { fingerprint: string };
type Counts = { updated: number; added: number; unchanged: number; skipped: number; kept: number };

const show = (f: FieldChange["field"], v: string | number | null) =>
  v === null ? "—" : f === "cost_rate" ? `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : String(v);
const sizeLabel = (ml: number) => (ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`);

/** Owner: bring the Zoho Items export into Products. Zoho wins on name, SKU, HSN, purchase rate and status. */
export default function ZohoItemsPage() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<ZohoItem[]>();
  const [match, setMatch] = useState<Record<string, string>>({});
  const [specs, setSpecs] = useState<Record<string, NewSpec>>({});
  /** every Zoho code the owner has to match by hand (kept on screen after a choice is made) */
  const [hand, setHand] = useState<Record<string, { name: string; guess: NewSpec }>>({});
  const [preview, setPreview] = useState<Preview>();
  const [done, setDone] = useState<Counts>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>("/api/auth/me").then((r) => {
      if (!r.ok) return router.replace("/login");
      if (r.data.must_change_secret) return router.replace("/change-secret");
      if (!r.data.roles.includes("tenant_admin")) return router.replace("/home");
      setOk(true);
    });
  }, [router]);

  const body = useCallback(() => ({ file_name: fileName, items, match, specs }), [fileName, items, match, specs]);

  useEffect(() => {
    if (!items) return;
    let stale = false;
    api<Preview>("/api/admin/skus/zoho/preview", { body: body() }).then((r) => {
      if (stale) return;
      if (!r.ok) return setError(r.error);
      setError(undefined);
      setPreview(r.data);
      setHand((old) => {
        const add = r.data.to_choose.filter((c) => !old[c.sku]);
        return add.length ? { ...old, ...Object.fromEntries(add.map((c) => [c.sku, { name: c.name, guess: c.guess }])) } : old;
      });
      // a new product starts from the guessed size, which the owner can change
      setSpecs((old) => {
        const next = { ...old };
        for (const c of r.data.to_choose) if (!next[c.sku]) next[c.sku] = c.guess;
        return Object.keys(next).length === Object.keys(old).length ? old : next;
      });
    });
    return () => void (stale = true);
  }, [items, body]);

  async function pick(file: File | undefined) {
    setError(undefined);
    setPreview(undefined);
    setDone(undefined);
    setMatch({});
    setSpecs({});
    setHand({});
    if (!file) return;
    try {
      const read = readZohoItems(parseCsv(await file.text()));
      if (!read.length) return setError("The file has no items.");
      setFileName(file.name);
      setItems(read);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    const r = await api<Counts>("/api/admin/skus/zoho/confirm", { body: { ...body(), fingerprint: preview.fingerprint } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    setItems(undefined);
    setPreview(undefined);
  }

  if (!ok) return null;
  const choosing = Object.entries(hand).map(([sku, h]) => ({ sku, ...h }));
  const needed = choosing.filter((c) => !match[c.sku]).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Import Zoho items</h1>
        <Link href="/admin/business" className="text-(--brand) font-medium">Back</Link>
      </div>
      <Card>
        <p className="text-sm text-slate-600">
          In Zoho: Items → ⋯ → Export Items (CSV). Only items Zoho <b>sells</b> come in. <b>Zoho wins</b> on name, SKU code, HSN, purchase
          rate and active / inactive. Size, pack type and units per pack stay as they are in PlantOps. Products not in the file are never
          changed. Nothing is saved until you press Confirm.
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          Choose Zoho Items CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {fileName && items && <p className="mt-2 text-sm text-slate-500">{fileName}: {items.length} items</p>}
        <ErrorText>{error}</ErrorText>
      </Card>

      {done && (
        <Card>
          <p className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
            Saved: {done.updated} updated, {done.added} added, {done.unchanged} already the same, {done.skipped} skipped, {done.kept} not in Zoho (kept).
          </p>
          <Link href="/admin/business" className="mt-3 inline-block font-medium text-(--brand)">Back to products</Link>
        </Card>
      )}

      {preview && (
        <>
          {choosing.length > 0 && (
            <Card>
              <h2 className="mb-1 text-lg font-semibold">Match these ({choosing.length})</h2>
              <p className="mb-3 text-sm text-slate-500">No PlantOps product has these SKU codes yet. Pick the same product, or add it as new.</p>
              <div className="space-y-4">
                {choosing.map((c) => {
                  const spec = specs[c.sku] ?? c.guess;
                  const setSpec = (s: Partial<NewSpec>) => setSpecs({ ...specs, [c.sku]: { ...spec, ...s } });
                  return (
                    <div key={c.sku} className="space-y-2 border-b border-slate-100 pb-3">
                      <p className="font-medium">{c.name} <span className="text-sm text-slate-500">· {c.sku}</span></p>
                      <select
                        value={match[c.sku] ?? ""}
                        onChange={(e) => setMatch({ ...match, [c.sku]: e.target.value })}
                        className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                      >
                        <option value="">Choose…</option>
                        <option value="new">New product</option>
                        {preview.candidates
                          .filter((p) => p.id === match[c.sku] || !Object.values(match).includes(p.id))
                          .map((p) => <option key={p.id} value={p.id}>Same as: {p.name}{p.sku_code ? ` (${p.sku_code})` : ""}</option>)}
                      </select>
                      {match[c.sku] === "new" && (
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <label>Size (ml)
                            <input inputMode="numeric" className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2" value={spec.volume_ml}
                              onChange={(e) => setSpec({ volume_ml: Math.round(Number(e.target.value) || 0) })} />
                          </label>
                          <label>Pack type
                            <select className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2 capitalize" value={spec.pack_type}
                              onChange={(e) => setSpec({ pack_type: e.target.value as NewSpec["pack_type"] })}>
                              {PACK_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </label>
                          <label>Units per pack
                            <input inputMode="numeric" className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-2" value={spec.units_per_pack}
                              onChange={(e) => setSpec({ units_per_pack: Math.round(Number(e.target.value) || 0) })} />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 text-lg font-semibold">Will change ({preview.updated.length})</h2>
            {preview.updated.length === 0 && <p className="text-sm text-slate-500">Nothing.</p>}
            {preview.updated.map((u) => (
              <div key={u.id} className="border-b border-slate-100 py-2">
                <p className="font-medium">{u.name}</p>
                {u.changes.map((c) => (
                  <p key={c.field} className="text-sm text-slate-600">
                    {FIELD_LABEL[c.field]}: <span className="text-slate-400 line-through">{show(c.field, c.from)}</span> → <b>{show(c.field, c.to)}</b>
                  </p>
                ))}
              </div>
            ))}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold">Will add ({preview.added.length})</h2>
            {preview.added.length === 0 && <p className="text-sm text-slate-500">Nothing.</p>}
            {preview.added.map((a) => (
              <p key={a.sku} className="border-b border-slate-100 py-2 text-sm">
                <b>{a.name}</b> · {a.sku} · <span className="capitalize">{a.spec.units_per_pack > 1 ? `${a.spec.pack_type} of ${a.spec.units_per_pack} × ` : ""}{sizeLabel(a.spec.volume_ml)}{a.spec.units_per_pack > 1 ? "" : ` ${a.spec.pack_type}`}</span>
                {a.hsn ? ` · HSN ${a.hsn}` : ""}
              </p>
            ))}
          </Card>

          {preview.warnings.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">To check</h2>
              {preview.warnings.map((w, i) => <p key={i} className="text-sm text-amber-800">{w.sku}: {w.text}</p>)}
            </Card>
          )}

          <Card>
            <p className="text-sm text-slate-600">
              Already the same: {preview.unchanged.length}. Not in Zoho, kept as they are: {preview.kept.length}
              {preview.kept.length ? ` (${preview.kept.map((k) => k.name).join(", ")})` : ""}.
            </p>
            {preview.skipped.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-slate-600">Skipped: {preview.skipped.length}</summary>
                {preview.skipped.map((s) => <p key={s.line} className="text-slate-500">Line {s.line}: {s.name}: {s.reason}</p>)}
              </details>
            )}
          </Card>

          <Button className="w-full" disabled={busy || needed > 0 || preview.to_choose.length > 0} onClick={confirm}>
            {busy ? "Saving..." : needed > 0 ? `Match ${needed} more first` : "Confirm and save"}
          </Button>
        </>
      )}
    </div>
  );
}

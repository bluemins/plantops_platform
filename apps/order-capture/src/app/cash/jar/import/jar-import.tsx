"use client";

// Owner: the 20 L pending report (Excel) → preview → confirm (cash book step C2). The Excel is read in the browser; only
// the rows are sent. The server works the plan out again and saves all or nothing.
import { useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { paise, rupees, signedMoney } from "@/lib/cash";
import { commonPlace, readJarSheet, type JarChoice, type JarSheet } from "@/lib/jar-import";
import type { JarPreview } from "@/server/collections";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const rs = (s: string) => signedMoney(paise(s));

export function JarImport() {
  const [sheet, setSheet] = useState<JarSheet>();
  const [fileName, setFileName] = useState("");
  const [place, setPlace] = useState("");
  const [choices, setChoices] = useState<Record<string, JarChoice>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<JarPreview>();
  const [done, setDone] = useState<Record<string, string | number>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const body = (c = choices) => ({ file_name: fileName, rows: sheet!.rows, file_total: sheet!.file_total, choices: c, place: place.trim().length >= 2 ? place.trim() : "Not set" }); // confirm checks the place first

  async function check(c = choices, s = sheet) {
    if (!s) return;
    setError(undefined);
    setBusy(true);
    const r = await api<JarPreview>("/api/cash/jar/preview", { body: { ...body(c), rows: s.rows, file_total: s.file_total } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
  }

  async function pick(file: File | undefined) {
    setError(undefined);
    setPreview(undefined);
    setDone(undefined);
    setChoices({});
    setTyped({});
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets["Remaining Payment"] ?? wb.Sheets[wb.SheetNames[0]!]!;
      const s = readJarSheet(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }));
      setSheet(s);
      setFileName(file.name.slice(0, 200));
      const p = place || commonPlace(s.rows);
      setPlace(p);
      setBusy(true);
      const r = await api<JarPreview>("/api/cash/jar/preview", { body: { file_name: file.name.slice(0, 200), rows: s.rows, file_total: s.file_total, choices: {}, place: p.length >= 2 ? p : "Not set" } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setPreview(r.data);
    } catch (e) {
      setBusy(false);
      setSheet(undefined);
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    }
  }

  function choose(ref: string, c: JarChoice) {
    const next = { ...choices, [ref]: c };
    setChoices(next);
    void check(next);
  }

  async function confirm() {
    if (!preview) return;
    setError(undefined);
    if (place.trim().length < 2) return setError("Place for new customers: at least 2 letters");
    setBusy(true);
    const r = await api<Record<string, string | number>>("/api/cash/jar/import", { body: { ...body(), expect: { create: preview.counts.create, add: preview.counts.add, imported: preview.totals.imported } } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
  }

  if (done)
    return (
      <Card className="space-y-2">
        <p className="font-semibold text-green-800">Imported.</p>
        <p className="text-sm">
          {done.customers_new} new customers, {done.added_to_existing} added to customers already in Sales, {done.opening_bills} opening balances ({rs(String(done.imported))}).
          {Number(done.left_out) > 0 && <> {done.left_out} left out ({rs(String(done.left_out_due))}): they stay in the other app.</>}
        </p>
        <a href="/cash/jar" className="font-semibold text-(--brand)">See the 20 L list →</a>
      </Card>
    );

  const rows = preview?.rows ?? [];
  const existing = rows.filter((r) => r.kind === "existing");
  const noMobile = rows.filter((r) => r.kind === "no_mobile");
  const fresh = rows.filter((r) => r.kind === "new");
  const already = rows.filter((r) => r.kind === "already");

  const mobileFix = (r: (typeof rows)[number]) => (
    <div className="flex gap-2">
      <input
        inputMode="tel"
        value={typed[r.ref] ?? (choices[r.ref]?.action === "mobile" ? (choices[r.ref] as { mobile: string }).mobile : "")}
        onChange={(e) => setTyped({ ...typed, [r.ref]: e.target.value })}
        className={field}
        placeholder="Type a mobile"
      />
      <Button variant="secondary" disabled={busy || !(typed[r.ref] ?? "").trim()} onClick={() => choose(r.ref, { action: "mobile", mobile: (typed[r.ref] ?? "").trim() })}>Use</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm text-slate-600">
          Choose the <b>20 L pending report</b> (Excel, sheet &ldquo;Remaining Payment&rdquo;). Each customer comes into Sales with a <b>20 L</b> mark, and what they owe
          (&ldquo;Total Due&rdquo;) becomes an <b>opening balance</b> on their account. Nothing is saved until you press Import. The same file again adds nothing.
        </p>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => pick(e.target.files?.[0])} className="block w-full text-sm" />
        {sheet && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Place for new customers (you can change each one later)</span>
            <input value={place} onChange={(e) => setPlace(e.target.value)} onBlur={() => check()} maxLength={200} className={field} />
          </label>
        )}
      </Card>
      {error && <ErrorText>{error}</ErrorText>}

      {preview && (
        <>
          <Card className="space-y-2">
            <p className="font-semibold">What will happen</p>
            <ul className="space-y-1 text-sm">
              <li><b>{preview.counts.create}</b> new customers</li>
              <li><b>{preview.counts.add}</b> added to customers already in Sales</li>
              <li><b>{preview.counts.opening_bills}</b> opening balances, together <b>{rs(preview.totals.imported)}</b></li>
              {preview.counts.skip > 0 && <li><b>{preview.counts.skip}</b> left out ({rs(preview.totals.left_out)}): they stay in the other app</li>}
              {preview.counts.already > 0 && <li><b>{preview.counts.already}</b> already imported ({rs(preview.totals.already)})</li>}
            </ul>
            <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${preview.total_mismatch ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
              {preview.totals.file === null
                ? `File has no Total row. Rows add up to ${rs(preview.totals.rows)}.`
                : preview.total_mismatch
                  ? `The file's Total ${rs(preview.totals.file)} is not its rows added up (${rs(preview.totals.rows)}).`
                  : `File total ${rs(preview.totals.file)} = imported ${rs(preview.totals.imported)} + left out ${rs(preview.totals.left_out)}${preview.counts.already ? ` + already ${rs(preview.totals.already)}` : ""} ✓`}
            </p>
          </Card>

          {existing.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Mobile already in Sales · {existing.length}</h2>
              <p className="text-sm text-slate-600">The due is added to that customer, unless you type another mobile (then it&apos;s another person).</p>
              <ul className="space-y-2">
                {existing.map((r) => (
                  <li key={r.ref} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-sm"><b>{r.name}</b> · {r.mobile_typed} · {rs(r.due)}</p>
                    <p className="text-sm text-slate-600">{r.result === "add" && r.customer ? <>→ added to <b>{r.customer.name}</b></> : r.result === "create" ? `→ new customer with ${r.use_phone}` : "→ left out"}</p>
                    <div className="flex flex-wrap gap-3 text-sm font-semibold">
                      {choices[r.ref] && <button type="button" className="text-(--brand)" onClick={() => choose(r.ref, { action: "add" })}>Add to the Sales customer</button>}
                      <button type="button" className="text-slate-600" onClick={() => choose(r.ref, { action: "skip" })}>Leave out</button>
                    </div>
                    {mobileFix(r)}
                    {r.error && <ErrorText>{r.error}</ErrorText>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {noMobile.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">No real mobile · {noMobile.length} · {rs(rupees(noMobile.reduce((s, r) => s + paise(r.due), 0n)))}</h2>
              <p className="text-sm text-slate-600">Left out unless you type a mobile (numbers like 1730445774 are the other app&apos;s placeholders).</p>
              <ul className="space-y-2">
                {noMobile.map((r) => (
                  <li key={r.ref} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-sm"><b>{r.name}</b>{r.mobile_typed ? ` · ${r.mobile_typed}` : ""} · {rs(r.due)}</p>
                    <p className="text-sm text-slate-600">{r.result === "skip" ? "→ left out" : r.result === "add" ? <>→ added to <b>{r.customer?.name}</b></> : `→ new customer with ${r.use_phone}`}</p>
                    {mobileFix(r)}
                    {r.result !== "skip" && <button type="button" className="text-sm font-semibold text-slate-600" onClick={() => choose(r.ref, { action: "skip" })}>Leave out</button>}
                    {r.error && <ErrorText>{r.error}</ErrorText>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {fresh.length > 0 && (
            <details className="rounded-2xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">New customers · {fresh.length}</summary>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {fresh.map((r) => (
                  <li key={r.ref} className="flex justify-between gap-2 py-1.5">
                    <span className="min-w-0 break-words">{r.name} · {r.use_phone}{r.group ? ` · ${r.group}` : ""}</span>
                    <span className="shrink-0">{r.result === "skip" ? "left out" : rs(r.due)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {already.length > 0 && <p className="text-sm text-slate-500">{already.length} customers in this file were imported before; they are not added again.</p>}

          <Button className="w-full" onClick={confirm} disabled={busy || preview.total_mismatch || preview.counts.errors > 0 || preview.counts.create + preview.counts.add === 0}>
            {busy ? "Working…" : `Import ${preview.counts.create + preview.counts.add} customers (${rs(preview.totals.imported)})`}
          </Button>
        </>
      )}
    </div>
  );
}

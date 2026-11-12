"use client";

// Owner: the 20 L month update (cash book step C5). The other app's Remaining Payment report (Excel) is read in the
// browser; only the rows are sent. Preview → confirm; the server works the plan out again and saves all or nothing.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { paise, signedMoney } from "@/lib/cash";
import { readJarSheet, type JarSheet, type MonthChoice } from "@/lib/jar-import";
import type { MonthPreview } from "@/server/jar-month";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const rs = (s: string) => signedMoney(paise(s));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function MonthUpdate({ defaultMonth, maxMonth }: { defaultMonth: string; maxMonth: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [sheet, setSheet] = useState<JarSheet>();
  const [fileName, setFileName] = useState("");
  const [choices, setChoices] = useState<Record<string, MonthChoice>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MonthPreview>();
  const [done, setDone] = useState<Record<string, string | number>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function check(c = choices, s = sheet, m = month, f = fileName) {
    if (!s) return;
    setError(undefined);
    setBusy(true);
    const r = await api<MonthPreview>("/api/cash/jar/month/preview", { body: { file_name: f, month: m, rows: s.rows, file_total: s.file_total, choices: c } });
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
      const s = readJarSheet(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }), { negative: true });
      setSheet(s);
      setFileName(file.name.slice(0, 200));
      await check({}, s, month, file.name.slice(0, 200));
    } catch (e) {
      setSheet(undefined);
      setError(e instanceof Error ? e.message : "Couldn't read that file");
    }
  }

  function choose(ref: string, c: MonthChoice | null) {
    const next = { ...choices };
    if (c) next[ref] = c;
    else delete next[ref];
    setChoices(next);
    void check(next);
  }

  async function confirm() {
    if (!preview || !sheet) return;
    setError(undefined);
    setBusy(true);
    const r = await api<Record<string, string | number>>("/api/cash/jar/month/import", {
      body: { file_name: fileName, month, rows: sheet.rows, file_total: sheet.file_total, choices, expect: { billed: preview.counts.billed, total: preview.totals.billed } },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    router.refresh();
  }

  if (done)
    return (
      <Card className="space-y-2">
        <p className="font-semibold text-green-800">{monthName(String(done.month))} brought in.</p>
        <p className="text-sm">
          {done.billed} month bills ({rs(String(done.billed_total))}), {done.matches} already matching, {done.flagged} flagged, {done.left} left for you.
          {Number(done.new_refs) > 0 && <> {done.new_refs} new customers in the file: <a href="/cash/jar/import" className="font-semibold text-(--brand)">Import list</a> adds them (same file).</>}
        </p>
        <a href="/cash/jar" className="font-semibold text-(--brand)">See the 20 L list →</a>
      </Card>
    );

  const rows = preview?.rows ?? [];
  const billed = rows.filter((r) => r.action === "billed" && r.reason !== "typed");
  const flagged = rows.filter((r) => r.action === "flagged");
  const mixed = rows.filter((r) => r.mixed);
  const left = rows.filter((r) => r.action === "left" && !r.mixed);
  const matches = rows.filter((r) => r.action === "matches");

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-sm text-slate-600">
          Choose the month and the other app&apos;s <b>Remaining Payment</b> report (same Excel as Import list). For each 20 L customer, what the report shows
          <b> more</b> than PlantOps becomes that month&apos;s <b>20 L month bill</b> (due the same day). Nothing is saved until you press the button.
        </p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Month</span>
          <input
            type="month"
            value={month}
            max={maxMonth}
            onChange={(e) => {
              setMonth(e.target.value);
              void check(choices, sheet, e.target.value);
            }}
            className={field}
          />
        </label>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => pick(e.target.files?.[0])} className="block w-full text-sm" />
      </Card>
      {error && <ErrorText>{error}</ErrorText>}

      {preview && (
        <>
          {preview.already && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              {monthName(preview.month)} was already brought in by {preview.already.by} ({preview.already.bills} month bills). Undo that month below to bring it in again.
            </p>
          )}
          <Card className="space-y-2">
            <p className="font-semibold">What will happen for {monthName(preview.month)}</p>
            <ul className="space-y-1 text-sm">
              <li><b>{preview.counts.billed}</b> month bills, together <b>{rs(preview.totals.billed)}</b> (dated {preview.bill_date})</li>
              <li><b>{preview.counts.matches}</b> already match: nothing to do</li>
              {preview.counts.flagged > 0 && <li className="text-red-800"><b>{preview.counts.flagged}</b> flagged: the report shows less than PlantOps (nothing saved for them)</li>}
              {preview.counts.left > 0 && <li><b>{preview.counts.left}</b> left for you (also buy boxes / share a customer, or unticked)</li>}
              {preview.counts.new_refs > 0 && <li><b>{preview.counts.new_refs}</b> new in the file: <a href="/cash/jar/import" className="font-semibold text-(--brand)">Import list</a> adds them</li>}
              {preview.counts.missing > 0 && <li>{preview.counts.missing} 20 L customers are not in this file: nothing changes for them</li>}
            </ul>
            <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${preview.total_mismatch ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
              {preview.totals.file === null ? `File has no Total row. Rows add up to ${rs(preview.totals.rows)}.` : preview.total_mismatch ? `The file's Total ${rs(preview.totals.file)} is not its rows added up (${rs(preview.totals.rows)}).` : `File total ${rs(preview.totals.file)} ✓`}
            </p>
          </Card>

          {flagged.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-red-700 uppercase">Flagged · {flagged.length}</h2>
              <p className="text-sm text-slate-600">PlantOps shows more due than the report: usually a payment collected outside the cash book. Post it (To post / Receive payment) if so.</p>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm">
                {flagged.map((r) => (
                  <li key={r.ref} className="px-3 py-2">
                    <b>{r.name}</b> · ref {r.ref} · report {rs(r.sheet)} · PlantOps {rs(r.plantops)} <span className="text-red-700">({rs(r.difference)})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {mixed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-amber-800 uppercase">For you to decide · {mixed.length}</h2>
              <p className="text-sm text-slate-600">These also buy boxes (or share the customer with another 20 L ref), so a payment may sit on another bill. Type this month&apos;s 20 L amount to bill it, or leave it.</p>
              <ul className="space-y-2">
                {mixed.map((r) => (
                  <li key={r.ref} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                    <p><b>{r.name}</b> · ref {r.ref} · {r.mixed === "boxes" ? "also buys boxes" : "shares the customer"} · Sales: {r.customer_name}</p>
                    <p className="text-slate-600">Report {rs(r.sheet)} · PlantOps 20 L due {rs(r.plantops)} · difference {rs(r.difference)}</p>
                    <div className="flex gap-2">
                      <input inputMode="decimal" value={typed[r.ref] ?? ""} onChange={(e) => setTyped({ ...typed, [r.ref]: e.target.value })} className={field} placeholder="Amount to bill (₹)" />
                      <Button variant="secondary" disabled={busy || !(typed[r.ref] ?? "").trim()} onClick={() => choose(r.ref, { action: "bill", amount: (typed[r.ref] ?? "").trim() })}>Bill</Button>
                    </div>
                    <p className="font-semibold">
                      {r.action === "billed" ? <>→ bill {rs(r.bill!)} <button type="button" className="ml-2 text-slate-600 underline" onClick={() => { setTyped({ ...typed, [r.ref]: "" }); choose(r.ref, null); }}>Leave it instead</button></> : "→ left as it is"}
                    </p>
                    {r.error && <ErrorText>{r.error}</ErrorText>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {billed.length > 0 && (
            <details className="rounded-2xl border border-slate-200 bg-white p-3" open={billed.length <= 20}>
              <summary className="cursor-pointer text-sm font-semibold">Month bills · {billed.length} · {rs(preview.totals.billed)}</summary>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {billed.map((r) => (
                  <li key={r.ref} className="flex items-start justify-between gap-2 py-1.5">
                    <span className="min-w-0 break-words">{r.name} · report {rs(r.sheet)} − PlantOps {rs(r.plantops)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <b>{rs(r.bill!)}</b>
                      <button type="button" className="text-xs text-slate-600 underline" onClick={() => choose(r.ref, { action: "leave" })}>Leave</button>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {left.length > 0 && (
            <p className="text-sm text-slate-600">
              Left by you: {left.map((r) => (
                <button key={r.ref} type="button" className="mr-2 font-semibold text-(--brand) underline" onClick={() => choose(r.ref, null)}>{r.name} (bill again)</button>
              ))}
            </p>
          )}
          {matches.length > 0 && <p className="text-sm text-slate-500">{matches.length} customers already match the report.</p>}

          <Button className="w-full" onClick={confirm} disabled={busy || !!preview.already || preview.total_mismatch || preview.counts.errors > 0 || preview.rows.length === 0}>
            {busy ? "Working…" : `Bring in ${monthName(preview.month)}: ${preview.counts.billed} bills (${rs(preview.totals.billed)})`}
          </Button>
        </>
      )}
    </div>
  );
}

/** Owner: cancel a month's month bills (none may have a payment yet) so it can be brought in again. */
export function UndoMonth({ month, label }: { month: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(undefined);
    if (reason.trim().length < 3) return setError("Please give a reason");
    setBusy(true);
    const r = await api(`/api/cash/jar/month/${month}/undo`, { body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open) return <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => setOpen(true)}>Undo {label}</button>;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-xs text-red-900">Cancels this month&apos;s 20 L month bills. Refused if any of them already has a payment.</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={field} placeholder="Why? e.g. wrong file" />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Keep it</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Undoing…" : `Undo ${label}`}</Button>
      </div>
    </div>
  );
}

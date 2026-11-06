"use client";

import { useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { parseCsv } from "@/lib/csv-read";
import { money } from "@/lib/money";
import { readContacts, readInvoices, readPayments, type ZohoFiles } from "@/lib/zoho-import";
import type { ZohoImportPreview } from "@/server/zoho-import";

type Kind = keyof ZohoFiles;
const FILES: { kind: Kind; label: string; where: string; read: (rows: string[][]) => ZohoFiles[Kind] }[] = [
  { kind: "contacts", label: "Contacts", where: "Sales → Customers → ⋯ → Export Customers", read: readContacts },
  { kind: "invoices", label: "Invoices", where: "Sales → Invoices → ⋯ → Export Invoices", read: readInvoices },
  { kind: "payments", label: "Payments received", where: "Sales → Payments Received → ⋯ → Export", read: readPayments },
];
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const rs = (s: string) => money(s.startsWith("-") ? s.slice(1) : s);

/** Pick the three Zoho exports → preview (nothing saved; must match Zoho) → Confirm. */
export function ZohoImport() {
  const [data, setData] = useState<Partial<ZohoFiles>>({});
  const [names, setNames] = useState<Partial<Record<Kind, string>>>({});
  const [exportDate, setExportDate] = useState(istToday());
  const [preview, setPreview] = useState<ZohoImportPreview>();
  const [done, setDone] = useState<Record<string, string | number>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ready = FILES.every((f) => data[f.kind]);
  const body = () => ({ files: names, export_date: exportDate, contacts: data.contacts, invoices: data.invoices, payments: data.payments });

  async function pick(kind: Kind, file: File | undefined) {
    setError(undefined);
    setPreview(undefined);
    setDone(undefined);
    if (!file) return;
    try {
      const rows = FILES.find((f) => f.kind === kind)!.read(parseCsv(await file.text()));
      setData((d) => ({ ...d, [kind]: rows }));
      setNames((n) => ({ ...n, [kind]: file.name }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function check() {
    setBusy(true);
    setError(undefined);
    const r = await api<ZohoImportPreview>("/api/zoho-import/preview", { body: body() });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    const r = await api<Record<string, string | number>>("/api/zoho-import/confirm", { body: { ...body(), fingerprint: preview.fingerprint } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    setPreview(undefined);
    setData({});
    setNames({});
  }

  const c = preview?.counts;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-600">
          Export these three CSV files from Zoho Books and pick them here. The files stay on this phone or computer; only what is needed is
          sent. Nothing is saved until you press Confirm, and importing newer files again adds only what is new.
        </p>
        <div className="mt-3 space-y-3">
          {FILES.map((f) => (
            <div key={f.kind}>
              <label className="inline-block cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                {data[f.kind] ? "✓ " : ""}{f.label} CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(f.kind, e.target.files?.[0])} />
              </label>
              <span className="ml-2 text-sm text-slate-500">{names[f.kind] ? `${names[f.kind]}: ${data[f.kind]!.length}` : f.where}</span>
            </div>
          ))}
          <label className="block text-sm text-slate-700">
            Exported from Zoho on
            <input type="date" value={exportDate} max={istToday()} onChange={(e) => { setExportDate(e.target.value); setPreview(undefined); }}
              className="ml-2 min-h-10 rounded-lg border border-slate-300 px-2" />
          </label>
        </div>
        <Button className="mt-3 w-full" disabled={!ready || busy} onClick={check}>{busy && !preview ? "Checking..." : "Check (nothing is saved)"}</Button>
        <ErrorText>{error}</ErrorText>
      </Card>

      {done && (
        <Card>
          <p className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
            Saved: {done.bills_new} bills ({done.opening_balances} opening balances), {done.payments_new} payments, {done.contacts_linked} Zoho contacts
            linked to your customers, {done.orders_linked} orders linked to their bill. Next: match the other {done.contacts_unmatched} contacts.
          </p>
          <a href="/customers/match" className="mt-3 inline-block font-medium text-(--brand)">Match Zoho customers →</a>
        </Card>
      )}

      {preview && c && (
        <>
          <Card>
            <h2 className="mb-2 text-lg font-semibold">Money (must match Zoho)</h2>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt>Bills added</dt><dd className="text-right font-medium">{rs(preview.totals.billed)}</dd>
              <dt>Payments added</dt><dd className="text-right font-medium">{rs(preview.totals.received)}</dd>
              <dt>Closed in Zoho without a payment</dt><dd className="text-right font-medium">{rs(preview.totals.adjusted)}</dd>
              <dt>Still due, here</dt><dd className="text-right font-medium">{rs(preview.totals.due_after)}</dd>
              <dt>Still due, Zoho</dt><dd className="text-right font-medium">{rs(preview.totals.zoho_due)}</dd>
            </dl>
            <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${preview.matches_zoho ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {preview.matches_zoho ? "✓ Every bill's due matches Zoho." : `✗ ${preview.mismatches.length} bills don't match Zoho. Nothing can be saved until the files agree.`}
            </p>
            {preview.mismatches.map((m) => <p key={m.number} className="text-sm text-red-700">{m.number}: here {rs(m.ours)}, Zoho {rs(m.zoho)}</p>)}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold">What comes in</h2>
            <ul className="space-y-1 text-sm text-slate-700">
              <li><b>{c.bills_new}</b> bills ({c.opening_balances} opening balances){c.bills_already ? `, ${c.bills_already} already here` : ""}</li>
              <li><b>{c.payments_new}</b> payments ({Object.entries(preview.modes).map(([m, n]) => `${n} ${m}`).join(", ")}){c.payments_already ? `, ${c.payments_already} already here` : ""}</li>
              <li><b>{c.contacts_new}</b> Zoho contacts: {c.contacts_linked} linked to your customers (same mobile), {c.contacts_unmatched} for you to match after the import ({c.contacts_no_phone} have no mobile in Zoho){c.contacts_already ? `; ${c.contacts_already} already here` : ""}. No new customers are made here.</li>
              <li><b>{c.orders_linked}</b> delivered orders linked to their bill; {c.orders_to_check} to check later</li>
            </ul>
            {preview.unknown_skus.length > 0 && <p className="mt-2 text-sm text-amber-800">SKU codes not in your products (lines kept with Zoho's name): {preview.unknown_skus.join(", ")}</p>}
          </Card>

          {preview.shared_mobiles.length > 0 && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold">One mobile on several Zoho contacts ({preview.shared_mobiles.length})</summary>
                <p className="mt-1 text-sm text-slate-500">Not linked automatically: you match each of these on the Match screen.</p>
                {preview.shared_mobiles.map((s) => (
                  <p key={s.mobile} className="text-sm text-slate-600">{s.mobile}: {s.names.join(", ")}</p>
                ))}
              </details>
            </Card>
          )}

          {preview.check_orders.length > 0 && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold">Delivered orders to check later ({preview.check_orders.length})</summary>
                <p className="mt-1 text-sm text-slate-500">No single bill with the same products and quantities near the delivery day. You can link them after the import.</p>
                {preview.check_orders.map((o) => (
                  <p key={o.ref} className="text-sm text-slate-600">{o.ref}, delivered {o.delivered_on}{o.candidates.length ? `: maybe ${o.candidates.join(", ")}` : ""}</p>
                ))}
              </details>
            </Card>
          )}

          {preview.skipped.length > 0 && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold">Skipped ({preview.skipped.length})</summary>
                {preview.skipped.map((s, i) => <p key={i} className="text-sm text-slate-600">{s.what} {s.ref}: {s.reason}</p>)}
              </details>
            </Card>
          )}

          <Button className="w-full" disabled={busy || !preview.matches_zoho} onClick={confirm}>{busy ? "Saving..." : "Confirm and save"}</Button>
        </>
      )}
    </div>
  );
}

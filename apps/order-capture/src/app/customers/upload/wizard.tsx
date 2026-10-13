"use client";

import { useState, type ChangeEvent } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { guessColumns, parseCsv, TEMPLATE_CSV, type Column } from "@/lib/csv-read";
import { rejectedCsv, UPLOAD_MAX_ROWS, type UploadRow } from "@/lib/upload";
import type { UploadPreview } from "@/server/upload";

const MAX_BYTES = 2 * 1024 * 1024;
const fmt = (p: string) => (/^\d{10}$/.test(p) ? `${p.slice(0, 5)} ${p.slice(5)}` : p);
const COLUMNS: [Column, string][] = [
  ["name", "Name"],
  ["phone", "Phone"],
  ["place", "Place"],
];
const select = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";

/** Offers a file made here in the browser (template, rejected rows): nothing goes to the server. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Choose file → which column is which → preview (nothing saved) → save. Mock-up "Upload customers". */
export function UploadWizard() {
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [cols, setCols] = useState<Record<Column, number>>({ name: -1, phone: -1, place: -1 });
  const [preview, setPreview] = useState<UploadPreview>();
  const [done, setDone] = useState<{ added: number; updated: number }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const header = table[0] ?? [];

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(undefined);
    setPreview(undefined);
    setDone(undefined);
    setTable([]);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("This file is larger than 2 MB. Split it into smaller files.");
    if (/\.(xlsx?|ods)$/i.test(file.name)) return setError("This is a spreadsheet file. In Excel or Google Sheets use File → Save as / Download → CSV, then choose that file.");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setError("The file has no rows under the header line.");
    if (rows.length - 1 > UPLOAD_MAX_ROWS) return setError(`The file has more than ${UPLOAD_MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`);
    setFileName(file.name);
    setTable(rows);
    setCols(guessColumns(rows[0]!));
  }

  const rows = (): UploadRow[] =>
    table.slice(1).map((r, i) => ({ line: i + 2, name: r[cols.name] ?? "", phone: r[cols.phone] ?? "", place: r[cols.place] ?? "" }));
  const chosen = cols.name >= 0 && cols.phone >= 0 && cols.place >= 0 && new Set([cols.name, cols.phone, cols.place]).size === 3;

  async function check() {
    setBusy(true);
    setError(undefined);
    const r = await api<UploadPreview>("/api/customers/upload/preview", { body: { file_name: fileName, rows: rows() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    const r = await api<{ added: number; updated: number }>("/api/customers/upload/confirm", { body: { file_name: fileName, rows: rows(), fingerprint: preview.fingerprint } });
    setBusy(false);
    if (r.status === 409) {
      setPreview(undefined);
      return setError(r.error);
    }
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    setPreview(undefined);
  }

  if (done) {
    return (
      <Card>
        <p className="text-lg font-semibold">Saved.</p>
        <p className="mt-1 text-slate-600">
          {done.added} new customer{done.added === 1 ? "" : "s"} added, {done.updated} updated.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/customers" className="inline-flex min-h-12 items-center rounded-xl bg-(--brand) px-5 font-semibold text-(--brand-contrast)">
            See the customers
          </a>
        </div>
      </Card>
    );
  }

  const saveCount = preview ? preview.counts.added + preview.counts.updated : 0;
  return (
    <div className="space-y-4">
      {!preview && (
        <Card className="space-y-3">
          <p className="text-slate-700">
            A CSV file with the customer&apos;s <b>name</b>, <b>phone</b> and <b>place</b>. Google Sheets, Excel and Zoho can all save one. Other columns are ignored.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>
              In Excel, format the phone column as <b>Text</b> first, or long numbers turn into 9.18E+11.
            </li>
            <li>Names in Hindi or Odia: save as &quot;CSV UTF-8&quot;.</li>
            <li>Any phone format works: +91, 0, spaces.</li>
          </ul>
          <button type="button" className="min-h-11 text-sm font-semibold text-(--brand) underline-offset-2 hover:underline" onClick={() => download("customers-template.csv", TEMPLATE_CSV)}>
            Download template
          </button>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Choose the file</span>
            <input type="file" accept=".csv,text/csv" onChange={pick} className="block w-full text-base file:mr-3 file:min-h-12 file:rounded-xl file:border-0 file:bg-(--brand) file:px-4 file:font-semibold file:text-(--brand-contrast)" />
          </label>
        </Card>
      )}

      {table.length > 1 && !preview && (
        <Card className="space-y-3">
          <p className="font-semibold">
            {fileName} · {table.length - 1} row{table.length === 2 ? "" : "s"}
          </p>
          <p className="text-sm text-slate-600">Which column is which?</p>
          {COLUMNS.map(([c, label]) => (
            <label key={c} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
              <select className={select} value={cols[c]} onChange={(e) => setCols({ ...cols, [c]: Number(e.target.value) })}>
                <option value={-1}>Choose…</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {h.trim() || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {!chosen && <p className="text-sm text-amber-800">Choose a different column for each of Name, Phone and Place.</p>}
          <Button className="w-full" onClick={check} disabled={!chosen || busy}>
            {busy ? "Checking…" : "Check the file"}
          </Button>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>

      {preview && (
        <div className="space-y-4">
          <div>
            <p className="font-semibold">
              {fileName} · {table.length - 1} row{table.length === 2 ? "" : "s"}
            </p>
            <p className="text-sm text-slate-600">
              Columns: Name → {header[cols.name]}, Phone → {header[cols.phone]}, Place → {header[cols.place]}. Nothing is saved yet.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Count n={preview.counts.added} label="New" className="bg-green-100 text-green-900" />
            <Count n={preview.counts.unchanged} label="Unchanged" className="bg-slate-100 text-slate-800" />
            <Count n={preview.counts.updated} label="Update" className="bg-blue-100 text-blue-900" />
            <Count n={preview.counts.rejected} label="Rejected" className="bg-red-100 text-red-900" />
          </div>

          {preview.updated.length > 0 && (
            <Section title="Update (same phone, details changed)">
              {preview.updated.map((u) => (
                <li key={u.line} className="py-2 text-sm">
                  <p className="text-slate-500">
                    Line {u.line} · {fmt(u.phone)}
                    {!u.from.active && " · switched off now, will be switched back on"}
                  </p>
                  {(u.from.name !== u.to.name || u.from.place !== u.to.place) && (
                    <>
                      <p className="text-slate-500 line-through">
                        {u.from.name}, {u.from.place}
                      </p>
                      <p className="font-semibold">
                        {u.to.name}, {u.to.place}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </Section>
          )}

          {preview.rejected.length > 0 && (
            <Section title="Rejected (not saved)">
              {preview.rejected.map((r) => (
                <li key={r.lines.join(",")} className="py-2 text-sm">
                  <p className="font-semibold">
                    {r.lines.length === 1 ? `Line ${r.lines[0]}` : `Lines ${r.lines.join(", ")}`}
                    {r.phone ? ` · "${fmt(r.phone)}"` : ""}
                  </p>
                  <p className="text-slate-600">{r.reason}</p>
                </li>
              ))}
            </Section>
          )}

          {preview.added
            .filter((a) => a.possibleDuplicate)
            .map((a) => (
              <div key={a.line} className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-semibold">Line {a.line} · possible duplicate</p>
                <p>{a.possibleDuplicate}. Added as new; check it later.</p>
              </div>
            ))}

          {preview.repeated.length > 0 && (
            <p className="text-sm text-slate-600">
              Repeated rows ignored (same phone, same details):{" "}
              {preview.repeated.map((r) => `lines ${r.lines.join(", ")}`).join("; ")}.
            </p>
          )}

          {preview.counts.rejected > 0 && (
            <button
              type="button"
              className="min-h-11 text-sm font-semibold text-(--brand) underline-offset-2 hover:underline"
              onClick={() => download(fileName.replace(/\.csv$/i, "") + "-rejected.csv", rejectedCsv(table, preview.rejected))}
            >
              Download the {preview.counts.rejected} rejected row{preview.counts.rejected === 1 ? "" : "s"} (CSV)
            </button>
          )}

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
            {saveCount > 0 ? (
              <Button className="w-full min-h-14 text-lg" onClick={save} disabled={busy}>
                {busy ? "Saving…" : `Save ${saveCount} customer${saveCount === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <p className="text-center font-semibold">Nothing to save: every customer in this file is already in your list.</p>
            )}
            <p className="text-center text-sm text-slate-500">
              {preview.counts.added} new + {preview.counts.updated} updated. Rejected rows are not saved.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => setPreview(undefined)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Count({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <div className={`rounded-xl px-1 py-2 ${className}`}>
      <p className="text-2xl font-bold">{n}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <Card className="p-3">
        <ul className="divide-y divide-slate-100">{children}</ul>
      </Card>
    </div>
  );
}

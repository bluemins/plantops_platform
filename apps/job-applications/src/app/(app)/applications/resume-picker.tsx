"use client";

import { useRef, useState } from "react";
import { shrink } from "@plantops/module-kit/photo";
import { MAX_FILE_BYTES } from "@/lib/apply";

type Page = { key: number; blob: Blob; preview: string };
let pageKeys = 0;

/**
 * Pick a resume for an applicant added by hand: one PDF, or photos (shrunk on the phone) up to `room`. `pdfAllowed`
 * is false once the application already has photos. Reports the chosen files with onChange.
 */
export function ResumePicker({ room, pdfAllowed, onChange, disabled }: { room: number; pdfAllowed: boolean; onChange: (files: Blob[]) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<"photos" | "pdf">("photos");
  const [pages, setPages] = useState<Page[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const report = (m: typeof mode, p: Page[], f: File | null) => onChange(m === "pdf" ? (f ? [f] : []) : p.map((x) => x.blob));

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    setError(undefined);
    setReading(true);
    const free = room - pages.length;
    const added: Page[] = [];
    for (const file of Array.from(list).slice(0, free)) {
      try {
        const blob = await shrink(file);
        added.push({ key: ++pageKeys, blob, preview: URL.createObjectURL(blob) });
      } catch {
        setError("One photo could not be read. Please take it again.");
      }
    }
    if (list.length > free) setError(`At most ${room} photo${room === 1 ? "" : "s"} more.`);
    const next = [...pages, ...added];
    setPages(next);
    report("photos", next, pdf);
    setReading(false);
    if (photoInput.current) photoInput.current.value = "";
  }

  function pickPdf(list: FileList | null) {
    const file = list?.[0] ?? null;
    setError(undefined);
    const ok = file && file.size <= MAX_FILE_BYTES ? file : null;
    if (file && !ok) setError("The PDF is bigger than 5 MB. Take photos of the CV instead.");
    setPdf(ok);
    report("pdf", pages, ok);
    if (pdfInput.current) pdfInput.current.value = "";
  }

  function switchTo(m: typeof mode) {
    setMode(m);
    report(m, pages, pdf);
  }

  function removePage(key: number) {
    const next = pages.filter((x) => x.key !== key);
    setPages(next);
    report("photos", next, pdf);
  }

  const toggle = (on: boolean) => `min-h-11 rounded-xl border px-3 text-[15px] font-semibold ${on ? "border-(--brand) bg-(--brand-soft) text-slate-900" : "border-slate-300 bg-white text-slate-700"}`;
  return (
    <div className="flex flex-col gap-2.5">
      {pdfAllowed && (
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={disabled} aria-pressed={mode === "photos"} onClick={() => switchTo("photos")} className={toggle(mode === "photos")}>
            Take photos
          </button>
          <button type="button" disabled={disabled} aria-pressed={mode === "pdf"} onClick={() => switchTo("pdf")} className={toggle(mode === "pdf")}>
            Upload PDF
          </button>
        </div>
      )}
      {mode === "photos" || !pdfAllowed ? (
        <div className="flex flex-wrap gap-2.5">
          {pages.map((p, i) => (
            <div key={p.key} className="relative h-[110px] w-[84px] overflow-hidden rounded-[10px] border border-slate-300 bg-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- a photo just taken, shown from memory */}
              <img src={p.preview} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
              <button type="button" disabled={disabled} onClick={() => removePage(p.key)} aria-label={`Remove page ${i + 1}`} className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm font-bold text-slate-800">
                ×
              </button>
            </div>
          ))}
          {pages.length < room && (
            <button type="button" disabled={disabled || reading} onClick={() => photoInput.current?.click()} className="h-[110px] w-[84px] rounded-[10px] border-2 border-dashed border-slate-400 bg-white text-[13px] font-semibold text-slate-700">
              {reading ? "Reading…" : pages.length ? "+ Add page" : "+ Add photo"}
            </button>
          )}
          <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" disabled={disabled} onClick={() => pdfInput.current?.click()} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-semibold">
            {pdf ? "Choose another PDF" : "Choose PDF"}
          </button>
          {pdf && <span className="min-w-0 truncate text-sm text-slate-700">{pdf.name}</span>}
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pickPdf(e.target.files)} />
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Sends the pages one by one (the file itself as the body); stops at the first error. `sent` = pages that arrived. */
export async function uploadResume(id: string, files: Blob[]): Promise<{ sent: number; error?: string }> {
  let sent = 0;
  for (const file of files) {
    try {
      const res = await fetch(`/api/app/applications/${id}/resume`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      if (res.status === 401) window.location.reload();
      if (!res.ok) return { sent, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The resume could not be saved" };
    } catch {
      return { sent, error: "No connection. Check the internet and try again." };
    }
    sent++;
  }
  return { sent };
}

/** On an application's page: add the resume later (when the CV arrives), or more photos up to 3. */
export function AddResume({ id, room, pdfAllowed }: { id: string; room: number; pdfAllowed: boolean }) {
  const [files, setFiles] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    const { sent, error } = await uploadResume(id, files);
    if (error && !sent) {
      setBusy(false);
      return setError(error);
    }
    // a fresh picker and the pages that arrived (the page then offers what is still missing)
    window.location.href = `/applications/${id}${error ? "?resume=failed" : ""}`;
  }
  return (
    <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-3">
      <h3 className="text-[15px] font-semibold">{pdfAllowed ? "Add the resume" : "Add more photos"}</h3>
      <ResumePicker room={room} pdfAllowed={pdfAllowed} onChange={setFiles} disabled={busy} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {files.length > 0 && (
        <button type="button" onClick={save} disabled={busy} className="self-end rounded-xl bg-(--brand) px-5 py-2.5 text-[15px] font-bold text-(--brand-contrast) disabled:opacity-50">
          {busy ? "Saving…" : "Save resume"}
        </button>
      )}
    </div>
  );
}

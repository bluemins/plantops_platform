"use client";

// Bill copy on purchase bills (owner, 2026-11-20): pick one PDF or up to 3 photos (shrunk on the phone), sent one file at
// a time after the bill is saved; on the bill's page, "+ Add bill copy". Copies are never deleted.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { shrink } from "@plantops/module-kit/photo";

export const MAX_PHOTOS = 3;
const MAX_PDF = 10 * 1024 * 1024;

export type CopyPick = { kind: "none" } | { kind: "pdf"; file: File } | { kind: "photos"; files: File[] };
export const NO_COPY: CopyPick = { kind: "none" };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** Sends the picked copy to a saved bill; returns an error text for the first file that failed, else null. */
export async function sendCopy(billId: string, pick: CopyPick): Promise<string | null> {
  const parts: { body: Blob; name: string; type: string }[] = [];
  if (pick.kind === "pdf") parts.push({ body: pick.file, name: pick.file.name, type: "application/pdf" });
  if (pick.kind === "photos") {
    for (const [i, f] of pick.files.entries()) {
      try {
        parts.push({ body: await shrink(f), name: `${f.name.replace(/\.[^.]+$/, "") || `photo-${i + 1}`}.jpg`, type: "image/jpeg" });
      } catch {
        return `Photo ${i + 1} could not be read. Take it again.`;
      }
    }
  }
  for (const p of parts) {
    const res = await fetch(`/api/purchases/bills/${billId}/files?name=${encodeURIComponent(p.name.slice(0, 200))}`, { method: "POST", headers: { "content-type": p.type }, body: p.body }).catch(() => null);
    if (!res) return "No connection. The bill is saved; add the copy again on this page.";
    if (res.status === 401) {
      window.location.reload();
      return "Please log in again";
    }
    if (!res.ok) return ((await res.json().catch(() => null))?.error as string | undefined) ?? "The copy could not be sent";
  }
  return null;
}

/** The two buttons and the previews. Controlled: the parent keeps the pick. */
export function CopyPicker({ value, onChange, disabled }: { value: CopyPick; onChange: (v: CopyPick) => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const photos = value.kind === "photos" ? value.files : [];
  const urls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  function add(list: FileList | null) {
    setError(undefined);
    const files = [...(list ?? [])];
    if (!files.length) return;
    const pdf = files.find(isPdf);
    if (pdf) {
      if (pdf.size > MAX_PDF) return setError("A PDF can be at most 10 MB");
      if (files.length > 1) setError("Only the PDF was taken: send one PDF, or photos.");
      return onChange({ kind: "pdf", file: pdf });
    }
    const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!imgs.length) return setError("Only a PDF or photos can be added");
    const next = [...photos, ...imgs];
    if (next.length > MAX_PHOTOS) setError(`At most ${MAX_PHOTOS} photos at a time; the first ${MAX_PHOTOS} were taken.`);
    onChange({ kind: "photos", files: next.slice(0, MAX_PHOTOS) });
  }

  const full = photos.length >= MAX_PHOTOS;
  return (
    <div className="space-y-2">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={chooser} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || full} className="min-h-12 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 disabled:opacity-50" onClick={() => camera.current?.click()}>Take photo</button>
        <button type="button" disabled={disabled || full} className="min-h-12 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 disabled:opacity-50" onClick={() => chooser.current?.click()}>Choose PDF / photo</button>
      </div>
      {value.kind === "pdf" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-semibold">{value.file.name}</span><span className="block text-xs text-slate-500">PDF · {kb(value.file.size)}</span></span>
          <button type="button" aria-label="Remove the PDF" disabled={disabled} className="min-h-10 min-w-10 rounded-full border border-slate-300 text-sm" onClick={() => onChange(NO_COPY)}>✕</button>
        </div>
      )}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {urls.map((u, i) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
              <img src={u} alt={`Photo ${i + 1}`} className="h-24 w-20 rounded-lg object-cover" />
              <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={disabled} className="absolute -top-2 -right-2 h-7 w-7 rounded-full border border-slate-300 bg-white text-xs" onClick={() => onChange(photos.length === 1 ? NO_COPY : { kind: "photos", files: photos.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
        </div>
      )}
      {photos.length > 0 && <p className="text-xs text-slate-500">{photos.length} photo{photos.length > 1 ? "s" : ""} ready (made smaller on the phone before sending).</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** "+ Add bill copy" on a saved bill's page (owner, Accounts). */
export function AddBillCopy({ billId, startOpen, failed }: { billId: string; startOpen?: boolean; failed?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!startOpen);
  const [pick, setPick] = useState<CopyPick>(NO_COPY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!open) return <button type="button" className="min-h-12 w-full rounded-xl border border-dashed border-slate-400 text-sm font-semibold text-slate-700" onClick={() => setOpen(true)}>+ Add bill copy</button>;
  async function send() {
    setBusy(true);
    setError(undefined);
    const err = await sendCopy(billId, pick);
    setBusy(false);
    if (err) return setError(err);
    setPick(NO_COPY);
    setOpen(false);
    router.replace(`/purchases/bills/${billId}`);
    router.refresh();
  }
  return (
    <div className="space-y-2">
      {failed && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">The bill is saved, but its copy didn&apos;t go through. Add it again here.</p>}
      <p className="text-sm text-slate-600">A PDF (up to 10 MB) or up to {MAX_PHOTOS} photos of the vendor&apos;s bill.</p>
      <CopyPicker value={pick} onChange={setPick} disabled={busy} />
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || pick.kind === "none"} onClick={send}>{busy ? "Sending..." : "Add copy"}</Button>
        <button type="button" disabled={busy} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-semibold" onClick={() => { setOpen(false); setPick(NO_COPY); setError(undefined); }}>Cancel</button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

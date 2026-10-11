"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import { MAX_PHOTOS, MAX_VIDEO_BYTES, nextKey, photoPicks, uploadPicks, type Pick } from "@/lib/upload";

type Item = { id: string; name: string };
const blank = { customer_name: "", phone: "", place: "", item_id: "", batch_text: "", description: "" };

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function ComplaintForm({ items }: { items: Item[] }) {
  const [form, setForm] = useState(blank);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ id: string; ref: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof blank) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const photos = picks.filter((p) => p.kind === "photo");
  const video = picks.find((p) => p.kind === "video");

  useEffect(() => () => picks.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - photos.length;
    if (list.length > room) setError(`At most ${MAX_PHOTOS} photos per complaint`);
    const added = await photoPicks([...list].slice(0, room));
    setPicks((ps) => [...ps, ...added]);
  }
  function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) return setError("Videos can be at most 30 MB (about 20–30 seconds). Please record a shorter clip.");
    setError(undefined);
    setPicks((ps) => [...ps.filter((p) => p.kind !== "video"), { key: nextKey(), kind: "video", blob: file, preview: null, state: "waiting" }]);
  }
  const remove = (key: string) => setPicks((ps) => ps.filter((p) => p.key !== key));

  const update = (key: string, change: Partial<Pick>) => setPicks((ps) => ps.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const upload = (complaintId: string, list: Pick[]) => uploadPicks(`/api/complaints/${complaintId}/files`, list, update);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    const r = await api<{ id: string; ref: string; error?: string }>("/api/complaints", { body: { ...form, batch_text: form.batch_text || null } });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    setSaved(r.data);
    await upload(r.data.id, picks);
    setBusy(false);
  }
  async function retry() {
    if (!saved) return;
    setBusy(true);
    await upload(saved.id, picks);
    setBusy(false);
  }

  if (saved) return <Saved saved={saved} picks={picks} busy={busy} onRetry={retry} />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-4">
        <TextField label="Customer name" value={form.customer_name} onChange={(e) => set("customer_name")(e.target.value)} maxLength={100} required autoComplete="off" />
        <TextField label="Customer mobile" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} maxLength={30} required placeholder="98765 43210" autoComplete="off" />
        <TextField label="Place (area / address)" value={form.place} onChange={(e) => set("place")(e.target.value)} maxLength={200} required autoComplete="off" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">What is it about?</span>
          <select value={form.item_id} onChange={(e) => set("item_id")(e.target.value)} required className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
            <option value="">Choose an item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Batch / date printed on the bottle (optional)" value={form.batch_text} onChange={(e) => set("batch_text")(e.target.value)} maxLength={60} autoComplete="off" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">What went wrong?</span>
          <textarea
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            minLength={10}
            maxLength={2000}
            required
            rows={4}
            placeholder="e.g. Jar leaking from the cap, customer noticed this morning"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base"
          />
        </label>
      </Card>

      <Card className="space-y-3">
        <p className="font-semibold">Photos and video (optional)</p>
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <li key={p.key} className="relative">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of the shrunk photo
                  <img src={p.preview} alt="" className="aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <div className="grid aspect-square place-items-center rounded-lg bg-red-50 p-1 text-center text-xs text-red-700">{p.error}</div>
                )}
                <RemoveButton onClick={() => remove(p.key)} />
              </li>
            ))}
          </ul>
        )}
        {video && (
          <p className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <span>🎬 Video, {sizeText(video.blob?.size ?? 0)}</span>
            <RemoveButton onClick={() => remove(video.key)} inline />
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {photos.length < MAX_PHOTOS && (
            <Button type="button" variant="secondary" onClick={() => photoInput.current?.click()}>
              📷 Add photos
            </Button>
          )}
          {!video && (
            <Button type="button" variant="secondary" onClick={() => videoInput.current?.click()}>
              🎬 Add a video
            </Button>
          )}
        </div>
        <p className="text-sm text-slate-500">Up to {MAX_PHOTOS} photos and one short video (at most 30 MB, about 20–30 seconds).</p>
        <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
        <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/*" hidden onChange={(e) => { addVideo(e.target.files); e.target.value = ""; }} />
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Save complaint"}
      </Button>
    </form>
  );
}

/** After saving: the reference and every file's state. A failed upload is said plainly, with Try again. */
function Saved({ saved, picks, busy, onRetry }: { saved: { id: string; ref: string }; picks: Pick[]; busy: boolean; onRetry: () => void }) {
  const failed = picks.filter((p) => p.state === "failed");
  const working = picks.some((p) => p.state === "waiting" || p.state === "uploading");
  const retryable = failed.filter((p) => p.blob);
  const photoNo = new Map(picks.filter((p) => p.kind === "photo").map((p, i) => [p.key, i + 1]));
  const what = (n: number, video: boolean) => (video && n === 1 ? "the video" : `${n} file${n === 1 ? "" : "s"}`);
  return (
    <Card className="space-y-4">
      <p className="text-2xl font-bold">Saved {saved.ref}</p>
      {failed.length > 0 && !working && (
        <p className="rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-800">
          Saved {saved.ref}, but {what(failed.length, failed.every((f) => f.kind === "video"))} did not upload.
        </p>
      )}
      {picks.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {picks.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-3 py-2">
              <span className="shrink-0 whitespace-nowrap">{p.kind === "video" ? "Video" : `Photo ${photoNo.get(p.key)}`}</span>
              <State p={p} />
            </li>
          ))}
        </ul>
      )}
      {picks.length === 0 && <p className="text-slate-600">No photos or video were added.</p>}
      <div className="flex flex-wrap gap-2">
        {retryable.length > 0 && !working && (
          <Button onClick={onRetry} disabled={busy}>
            {busy ? "Trying…" : "Try again"}
          </Button>
        )}
        <a href="/new" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
          Log another complaint
        </a>
        <a href="/" className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
          Home
        </a>
      </div>
    </Card>
  );
}

function State({ p }: { p: Pick }): ReactNode {
  if (p.state === "done") return <span className="font-semibold text-green-700">✓ Uploaded</span>;
  if (p.state === "uploading") return <span className="text-slate-600">Uploading…</span>;
  if (p.state === "waiting") return <span className="text-slate-500">Waiting…</span>;
  return <span className="text-right text-sm font-semibold text-red-700">✗ {p.error ?? "Did not upload"}</span>;
}

function RemoveButton({ onClick, inline }: { onClick: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      className={inline ? "min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white font-bold" : "absolute top-1 right-1 h-9 w-9 rounded-full bg-black/60 font-bold text-white"}
    >
      ✕
    </button>
  );
}

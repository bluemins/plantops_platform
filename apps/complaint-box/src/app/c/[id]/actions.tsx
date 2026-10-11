"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { MAX_PHOTOS, photoPicks, uploadPicks, type Pick } from "@/lib/upload";

type Status = "open" | "in_progress" | "resolved";
type Can = { note: boolean; in_progress: boolean; resolve: boolean; reopen: boolean; add_files: boolean };
type Mode = null | "note" | "resolve" | "reopen";

/** The owner's quick picks on the Resolve sheet: they only fill the note, which can still be changed. */
const QUICK_PICKS = ["Replaced", "Refund given", "Not valid", "Entered by mistake"];

const reload = () => window.location.reload();

/** The buttons on a complaint page - only the ones this person may use (the server checks again). */
export function ComplaintActions({ complaint, can }: { complaint: { id: string; ref: string; status: Status }; can: Can }) {
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean }>();

  if (!can.note && !can.in_progress && !can.resolve && !can.reopen) return null;

  async function setStatus(to: Status, text?: string) {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/complaints/${complaint.id}/status`, { body: { to, expected: complaint.status, text } });
    setBusy(false);
    if (!r.ok) return setError({ text: r.error ?? "Something went wrong", stale: r.status === 409 });
    reload();
  }

  return (
    <Card className="space-y-3">
      {error && (
        <div className="space-y-2">
          <ErrorText>{error.text}</ErrorText>
          {error.stale && (
            <Button variant="secondary" onClick={reload}>
              Reload
            </Button>
          )}
        </div>
      )}
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {can.note && <Button onClick={() => setMode("note")}>Add note</Button>}
          {can.in_progress && (
            <Button variant="secondary" disabled={busy} onClick={() => void setStatus("in_progress")}>
              {busy ? "Saving…" : "Set in progress"}
            </Button>
          )}
          {can.resolve && (
            <Button variant="secondary" onClick={() => setMode("resolve")}>
              Resolve
            </Button>
          )}
          {can.reopen && (
            <Button variant="secondary" onClick={() => setMode("reopen")}>
              Reopen
            </Button>
          )}
        </div>
      )}
      {mode === "note" && <NoteForm complaintId={complaint.id} onClose={() => setMode(null)} />}
      {mode === "resolve" && (
        <TextSheet
          title={`Resolve ${complaint.ref}`}
          label="How was it resolved?"
          placeholder="e.g. Jar replaced at the customer's home"
          picks={QUICK_PICKS}
          submit="Resolve"
          busy={busy}
          onSubmit={(text) => setStatus("resolved", text)}
          onClose={() => setMode(null)}
        />
      )}
      {mode === "reopen" && (
        <TextSheet
          title={`Reopen ${complaint.ref}`}
          label="Why is it reopened?"
          placeholder="e.g. Customer called again, still leaking"
          submit="Reopen"
          busy={busy}
          onSubmit={(text) => setStatus("open", text)}
          onClose={() => setMode(null)}
        />
      )}
    </Card>
  );
}

/** Resolve / Reopen: a required note (at least 3 characters); quick picks fill it and stay editable. */
function TextSheet(props: { title: string; label: string; placeholder: string; picks?: string[]; submit: string; busy: boolean; onSubmit: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const ok = text.trim().length >= 3;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) props.onSubmit(text.trim());
      }}
      className="space-y-3"
    >
      <p className="text-lg font-semibold">{props.title}</p>
      {props.picks && (
        <div className="flex flex-wrap gap-2">
          {props.picks.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setText(text.trim() && !props.picks!.includes(text.trim()) ? `${p}. ${text.trim()}` : p)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${text.trim() === p ? "border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <Field label={props.label}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder={props.placeholder} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base" />
      </Field>
      {!ok && text.length > 0 && <p className="text-sm text-slate-500">At least 3 characters.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ok || props.busy}>
          {props.busy ? "Saving…" : props.submit}
        </Button>
        <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A note (required text) with up to 5 photos; each photo's upload is shown, with Try again for failures. */
function NoteForm({ complaintId, onClose }: { complaintId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [noteId, setNoteId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const update = (key: string, change: Partial<Pick>) => setPicks((ps) => ps.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const failed = picks.filter((p) => p.state === "failed");

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const room = MAX_PHOTOS - picks.length;
    if (list.length > room) setError(`At most ${MAX_PHOTOS} photos per note`);
    const added = await photoPicks([...list].slice(0, room));
    setPicks((ps) => [...ps, ...added]);
  }
  async function save() {
    setBusy(true);
    setError(undefined);
    let id = noteId;
    if (!id) {
      const r = await api<{ id: string }>(`/api/complaints/${complaintId}/notes`, { body: { text } });
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
      id = r.data.id;
      setNoteId(id);
    }
    await uploadPicks(`/api/complaints/${complaintId}/files?note=${id}`, picks, update);
    setBusy(false);
  }
  // the note is saved and every photo went up (or there were none): show the page again
  const allDone = Boolean(noteId) && !busy && picks.every((p) => p.state === "done");
  useEffect(() => {
    if (allDone) reload();
  }, [allDone]);

  return (
    <div className="space-y-3">
      <p className="text-lg font-semibold">{noteId ? "Note saved" : "Add a note"}</p>
      {!noteId && (
        <Field label="Note">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="e.g. Called the customer, replacement jar sent today" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base" autoFocus />
        </Field>
      )}
      {picks.length > 0 && (
        <ul className="space-y-2">
          {picks.map((p, i) => (
            <li key={p.key} className="flex items-center gap-3">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the shrunk photo
                <img src={p.preview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-red-50 text-xs text-red-700">?</span>
              )}
              <span className="min-w-0 flex-1 text-sm">
                Photo {i + 1}
                {p.state === "done" && <span className="ml-2 font-semibold text-green-700">✓ Uploaded</span>}
                {p.state === "uploading" && <span className="ml-2 text-slate-600">Uploading…</span>}
                {p.state === "failed" && <span className="ml-2 font-semibold text-red-700">✗ {p.error}</span>}
              </span>
              {!noteId && (
                <button type="button" aria-label="Remove" onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} className="min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white font-bold">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {noteId && failed.length > 0 && !busy && (
        <p className="rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-800">
          Note saved, but {failed.length} photo{failed.length === 1 ? "" : "s"} did not upload.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        {!noteId && (
          <>
            <Button onClick={save} disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save note"}
            </Button>
            {picks.length < MAX_PHOTOS && (
              <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
                📷 Add photos
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {noteId && failed.some((p) => p.blob) && !busy && <Button onClick={save}>Try again</Button>}
        {noteId && !busy && (
          <Button variant="secondary" onClick={reload}>
            Done
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { NOTE_MAX, STATUSES } from "@/lib/status";
import type { ApplicationStatus } from "@/server/schema";

/** Status buttons (any order, also back). Sends the status this screen showed: changed meanwhile → "Just changed by …". */
export function StatusButtons({ id, status, canEdit }: { id: string; status: ApplicationStatus; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function set(to: ApplicationStatus) {
    if (to === status) return;
    setBusy(true);
    setError(undefined);
    const res = await api(`/api/app/applications/${id}/status`, { body: { to, expected: status } });
    setBusy(false);
    if (!res.ok) setError(res.error);
    router.refresh();
  }
  return (
    <section className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-bold">Status</h2>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === status}
            disabled={!canEdit || busy}
            onClick={() => set(s.id)}
            className={`min-h-11 rounded-xl border px-3.5 text-[15px] font-semibold disabled:cursor-default ${s.id === status ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-900 disabled:opacity-60"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

export function NoteBox({ id }: { id: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    const res = await api(`/api/app/applications/${id}/notes`, { body: { text } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setText("");
    router.refresh();
  }
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white p-4">
      <label htmlFor="note" className="text-base font-bold">
        Add a note
      </label>
      <textarea id="note" rows={3} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Called, coming for interview on Monday 10 am" className="resize-y rounded-xl border border-slate-300 p-3 text-[15px]" />
      <ErrorText>{error}</ErrorText>
      <button type="button" onClick={save} disabled={busy || !text.trim()} className="self-end rounded-xl bg-(--brand) px-5 py-2.5 text-[15px] font-bold text-(--brand-contrast) disabled:opacity-50">
        {busy ? "Saving…" : "Save note"}
      </button>
    </section>
  );
}

/** Owner: "Remove this application now", with a reason; asks once more before removing. */
export function RemoveNow({ id, refText }: { id: string; refText: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    setBusy(true);
    setError(undefined);
    const res = await api(`/api/app/applications/${id}/remove`, { body: { reason } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push("/applications");
    router.refresh();
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 self-center px-3 text-sm font-semibold text-red-700">
        Remove this application now (owner)
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-red-200 bg-white p-4">
      <h2 className="text-base font-bold text-red-800">Remove {refText} now?</h2>
      <p className="text-sm text-slate-700">The details, notes and resume are deleted for good (also from the backup within a day). Only a line &quot;{refText} removed&quot; with your reason stays in Recent changes.</p>
      <label htmlFor="reason" className="text-sm font-semibold">
        Why? (e.g. the applicant asked)
      </label>
      <input id="reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-[15px]" />
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold">
          Cancel
        </button>
        <button type="button" onClick={remove} disabled={busy || reason.trim().length < 3} className="min-h-11 rounded-xl bg-red-700 px-4 font-bold text-white disabled:opacity-50">
          {busy ? "Removing…" : "Remove for good"}
        </button>
      </div>
    </section>
  );
}

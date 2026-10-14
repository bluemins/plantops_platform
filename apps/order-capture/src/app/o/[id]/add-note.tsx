"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const area = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** "+ Add a note" on a saved order (owner and Order desk, any status; the server checks again). A note is never changed. */
export function AddNote({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${orderId}/notes`, { body: { text: text.trim() } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }

  if (!open) {
    return (
      <button type="button" className="min-h-12 w-full rounded-xl border border-dashed border-(--brand) font-semibold text-(--brand)" onClick={() => setOpen(true)}>
        + Add a note
      </button>
    );
  }
  return (
    <section aria-label="Add a note" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-sm font-semibold">
        Note
        <textarea className={`${area} mt-1`} rows={3} maxLength={300} autoFocus placeholder="e.g. customer paid cash, call before coming" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="text-sm text-slate-500">Shown with your name and the time. Can&apos;t be changed after saving.</p>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full min-h-12" disabled={busy || !text.trim()} onClick={save}>
        {busy ? "Saving…" : "Save note"}
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          setOpen(false);
          setError(undefined);
        }}
      >
        Not now
      </Button>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Button, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";

async function change(body: unknown, setError: (e?: string) => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  setError(undefined);
  const r = await api("/api/calls/ignored", { body }).catch(() => null);
  setBusy(false);
  if (!r) return setError("Not saved: no connection. Check the internet and try again.");
  if (!r.ok) return setError(r.error);
  window.location.reload();
}

/** + Add number: the number (any spelling) and who it is. */
export function AddIgnored() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="min-h-12 w-full rounded-xl border border-dashed border-(--brand) font-semibold text-(--brand)" onClick={() => setOpen(true)}>
        + Add number
      </button>
    );
  }
  return (
    <section aria-label="Add number" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <TextField label="Phone number" inputMode="tel" value={phone} maxLength={40} autoFocus onChange={(e) => setPhone(e.target.value)} />
      <TextField label="Who is this? (only you see it)" placeholder="e.g. Brother, supplier" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      <Button className="w-full" disabled={busy || !phone.trim() || !label.trim()} onClick={() => change({ action: "add", phone, label: label.trim() }, setError, setBusy)}>
        {busy ? "Saving…" : "Add"}
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>
        Not now
      </Button>
    </section>
  );
}

/** Remove: that number's calls are recorded and shown again (also the earlier ones). */
export function RemoveIgnored({ phone, label }: { phone: string; label: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <Button
        variant="danger"
        className="w-full"
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Remove ${label} from the list? Their calls will be recorded and shown again, also the earlier ones.`)) void change({ action: "remove", phone }, setError, setBusy);
        }}
      >
        Remove
      </Button>
    </>
  );
}

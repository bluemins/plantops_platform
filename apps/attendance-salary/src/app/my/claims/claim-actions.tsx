"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { photoPicks, uploadPicks } from "@/lib/upload";

const small = "min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold disabled:opacity-60";

/** Withdraw your own waiting claim (asks first). */
export function Withdraw({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    if (!window.confirm("Withdraw this claim? The owner won't see it as waiting any more.")) return;
    setBusy(true);
    const r = await api("/api/claims/withdraw", { body: { claim_id: claimId } });
    setBusy(false);
    if (!r.ok) setError(r.error);
    router.refresh();
  }
  return (
    <>
      <button type="button" onClick={go} disabled={busy} className={small}>
        Withdraw
      </button>
      {error && <ErrorText>{error}</ErrorText>}
    </>
  );
}

/** Add bill photos to your own waiting expense (within 24 hours, up to 3 in all). */
export function AddPhoto({ claimId, left }: { claimId: string; left: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function picked(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(undefined);
    const picks = await photoPicks([...files].slice(0, left));
    let failed: string | undefined = picks.find((p) => p.state === "failed")?.error;
    await uploadPicks(`/api/claims/photo?claim=${claimId}`, picks, (_key, change) => {
      if (change.state === "failed") failed = change.error;
    });
    setBusy(false);
    if (failed) setError(failed);
    router.refresh();
  }
  return (
    <>
      <input ref={input} type="file" accept="image/*" multiple={left > 1} className="hidden" onChange={(e) => picked(e.target.files)} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className={small}>
        {busy ? "Sending photo…" : "+ Photo"}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
    </>
  );
}

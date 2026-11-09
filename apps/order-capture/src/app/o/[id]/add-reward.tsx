"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

/** "Add the free box asked" on a pending order (owner, Order desk; the server checks again). */
export function AddReward({ orderId, reward }: { orderId: string; reward: { id: string; label: string } }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/drop/rewards/${reward.id}/add`, { body: { order_id: orderId } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }

  return (
    <section aria-label="Free box asked" className="space-y-2 rounded-2xl border border-violet-300 bg-violet-50 p-4">
      <p className="font-semibold">🎁 This shop asked for a free box: {reward.label} × 1</p>
      <p className="text-sm text-slate-700">Points reward from the Drop app. It goes with this order, not charged and not on the bill.</p>
      <ErrorText>{error}</ErrorText>
      <Button variant="secondary" onClick={add} disabled={busy}>
        {busy ? "Adding…" : "Add to this order"}
      </Button>
    </section>
  );
}

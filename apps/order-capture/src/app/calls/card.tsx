"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText, TextField } from "@plantops/ui";
import { api } from "@/lib/api";
import type { WaitingCard } from "@/server/calls-tab";

/** Reloads the page's numbers every `seconds` while it is open (typed names stay: the cards keep their state). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

const GREEN = "min-h-12 rounded-xl bg-green-700 px-4 text-base font-semibold text-white hover:bg-green-800 disabled:opacity-50";
const telHref = (phone: string) => (phone.length === 10 ? `tel:+91${phone}` : `tel:${phone}`);

/**
 * One waiting number (mock-up screen 4): its rings, the customer or "New number", the last delivered order without
 * amounts, call, and Attended. A new mobile needs name + place, which saves the caller to the customer list. The owner
 * can also put the number on "Not an order number". The server checks every rule again.
 */
export function CallCard({ card, canAttend, canIgnore, plain }: { card: WaitingCard; canAttend: boolean; canIgnore: boolean; plain: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [label, setLabel] = useState("");
  const [ignoring, setIgnoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const missedAll = card.rings.every((r) => r.missed);
  const callable = card.phone !== "hidden" && !plain;

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(undefined);
    const r = await api(path, { body }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409) router.refresh(); // someone else attended it: show the page as it is now
      return;
    }
    router.refresh();
  }
  const attend = (extra: Record<string, unknown> = {}) => send("/api/calls/attend", { phone: card.phone, ...extra });

  return (
    <section aria-label={card.customer?.name ?? card.number} className={`space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${card.rings.length > 1 ? "border-l-4 border-l-amber-500" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-bold">{card.customer?.name ?? (card.phone === "hidden" ? "Hidden number" : "New number")}</span>
        {card.rings.length > 1 ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">rang {card.rings.length} times</span>
        ) : missedAll ? (
          <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">missed</span>
        ) : null}
      </div>
      <p className="text-sm text-slate-500">
        {card.customer ? `${card.customer.place} · ` : ""}
        {card.phone !== "hidden" && <span className="font-mono">{card.number}</span>}
      </p>
      <div className="flex flex-wrap gap-1">
        {card.rings.map((r) => (
          <span key={r.at} className={`rounded-md border px-1.5 py-0.5 font-mono text-xs ${r.missed ? "border-red-200 text-red-700" : "border-slate-200 text-slate-600"}`}>
            {r.label}
            {r.missed ? " missed" : ""}
          </span>
        ))}
      </div>
      {card.last_order && <p className="rounded-lg bg-(--brand-soft) px-2 py-1.5 text-sm">Last order: {card.last_order}</p>}

      {canAttend && card.action === "new" && (
        <div className="space-y-2">
          <TextField label="Name" value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <TextField label="Place (village / area)" value={place} maxLength={200} autoComplete="off" onChange={(e) => setPlace(e.target.value)} />
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className={`grid gap-2 ${callable ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}>
        {callable && (
          <a href={telHref(card.phone)} aria-label={`Call ${card.number}`} className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-lg">
            📞
          </a>
        )}
        {canAttend &&
          (card.action === "new" ? (
            <button type="button" className={GREEN} disabled={busy || name.trim().length < 2 || place.trim().length < 2} onClick={() => attend({ name, place })}>
              {busy ? "Saving…" : "✓ Attended · save customer"}
            </button>
          ) : (
            <button type="button" className={GREEN} disabled={busy} onClick={() => attend()}>
              {busy ? "Saving…" : "✓ Attended"}
            </button>
          ))}
      </div>
      {canAttend && card.action === "new" && (
        <button type="button" className="min-h-11 w-full text-sm text-slate-500 underline" disabled={busy} onClick={() => attend({ wrong_number: true })}>
          Wrong number, don&apos;t save
        </button>
      )}

      {canIgnore && card.phone !== "hidden" && !ignoring && (
        <button type="button" className="min-h-11 w-full text-sm text-slate-500 underline" onClick={() => setIgnoring(true)}>
          Not a customer, never show again
        </button>
      )}
      {ignoring && (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
          <TextField label="Who is this? (only you see it)" placeholder="e.g. Brother, supplier" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          <p className="text-sm text-slate-500">Calls from this number won&apos;t be recorded or shown any more. You can undo it on Not an order number.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setIgnoring(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !label.trim()} onClick={() => send("/api/calls/ignored", { action: "add", phone: card.phone, label: label.trim() })}>
              Never show again
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

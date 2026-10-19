"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { bestLocation, type Reading } from "@/lib/locate";
import { fmtTime, MAX_ACCURACY_M } from "@/lib/punch";
import type { DeskPerson } from "@/server/desk";

type Kind = "in" | "out";
const field = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** Mock-up 1: search, one card per person with their state and one big button; yourself greyed out. */
export function DeskList({ people: first }: { people: DeskPerson[] }) {
  const [people, setPeople] = useState(first);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const shown = useMemo(() => people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [people, q]);

  async function mark(p: DeskPerson) {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      return setMsg({ id: p.userId, ok: false, text: "Location only works on the secure app address (https)." });
    }
    setBusy(p.userId);
    setAccuracy(null);
    setMsg(null);
    let location: Reading | null = null;
    try {
      location = await bestLocation(navigator.geolocation, setAccuracy); // waits up to 20 s for good GPS (B-04)
    } catch {
      location = null; // the server refuses with a plain message
    }
    if (location && location.accuracy > MAX_ACCURACY_M) {
      setBusy(null);
      return setMsg({ id: p.userId, ok: false, text: `Not saved: this phone's location is too rough (±${Math.round(location.accuracy)} m). Turn on precise location (Android: Google Location Accuracy; iPhone: Precise Location), step near a window and try again.` });
    }
    const r = await api<{ kind: Kind; at: string; next?: Kind; state?: string }>("/api/desk/mark", { body: { user_id: p.userId, expect: p.next, location } });
    setBusy(null);
    if (r.ok) {
      const k = r.data.kind;
      setPeople((all) => all.map((x) => (x.userId === p.userId ? { ...x, next: k === "in" ? "out" : "in", state: k === "in" ? `IN since ${fmtTime(r.data.at)} · by you` : `OUT at ${fmtTime(r.data.at)}` } : x)));
      return setMsg({ id: p.userId, ok: true, text: `${p.name}: ${k.toUpperCase()} at ${fmtTime(r.data.at)} saved.` });
    }
    const { next, state } = r.data ?? {};
    if (next && state) setPeople((all) => all.map((x) => (x.userId === p.userId ? { ...x, next, state } : x)));
    setMsg({ id: p.userId, ok: false, text: r.error ?? "Something went wrong" });
  }

  return (
    <div className="space-y-3">
      <input className={field} type="search" placeholder="🔍 Search a name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a name" />
      {shown.length === 0 && <p className="text-slate-600">Nobody found.</p>}
      <ul className="space-y-2.5">
        {shown.map((p) => (
          <li key={p.userId} className={`space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 ${p.self ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold break-words">{p.self ? `${p.name} (you)` : p.name}</p>
                <p className="text-sm text-slate-600">{p.self ? "Scan the QR for your own attendance" : p.state}</p>
              </div>
              {!p.self && (
                <button
                  type="button"
                  onClick={() => mark(p)}
                  disabled={busy !== null}
                  className={`min-h-12 shrink-0 rounded-xl px-4 font-bold disabled:opacity-60 ${p.next === "in" ? "bg-(--brand) text-(--brand-contrast) hover:bg-(--brand-hover)" : "bg-amber-700 text-white"}`}
                >
                  {busy === p.userId ? (accuracy !== null ? `Finding… ±${Math.round(accuracy)} m` : "Finding location…") : p.next === "in" ? "Mark IN" : "Mark OUT"}
                </button>
              )}
            </div>
            {msg?.id === p.userId && <p className={`text-sm font-semibold ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">The time is set by the server. This phone&apos;s location must be inside the plant circle, as for a scan. Only the distance is kept.</p>
    </div>
  );
}

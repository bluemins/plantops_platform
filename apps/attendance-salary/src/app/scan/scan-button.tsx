"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { bestLocation, type Reading } from "@/lib/locate";
import { fmtTime as time, MAX_ACCURACY_M } from "@/lib/punch";

type Kind = "in" | "out";
type Result =
  | { panel: "saved"; kind: Kind; at: string; distance_m: number }
  | { panel: "outside" | "too_rough" | "double" | "key" | "error" | "no_location_set"; text: string }
  | { panel: "no_location"; text: string }
  | { panel: "insecure" };

const dist = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const panelCls = {
  red: "border-red-200 bg-red-50 text-red-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  slate: "border-slate-200 bg-slate-50 text-slate-800",
};
const again = "mt-2 min-h-12 rounded-xl border bg-white px-5 text-base font-semibold";

/** How to turn on precise location (B-04): shown whenever the phone only gives a rough position. */
export function PreciseLocationSteps() {
  return (
    <>
      <p>
        <strong>Android:</strong> Settings → Location → Location services → <strong>Google Location Accuracy: ON</strong>.
      </p>
      <p>
        <strong>iPhone:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → <strong>Precise Location: ON</strong>.
      </p>
      <p>Then step near a window or outside and try again.</p>
    </>
  );
}

/** One big Mark IN / Mark OUT button; the tap asks for the location, then the server decides and saves. */
export function ScanButton({ k, name, date, next: firstNext, state: firstState }: { k: string; name: string; date: string; next: Kind; state: string }) {
  const [next, setNext] = useState(firstNext);
  const [state, setState] = useState(firstState);
  const [busy, setBusy] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function tap() {
    if (!window.isSecureContext || !("geolocation" in navigator)) return setResult({ panel: "insecure" });
    setBusy(true);
    setAccuracy(null);
    setResult(null);
    let location: Reading | null = null;
    try {
      location = await bestLocation(navigator.geolocation, setAccuracy); // waits up to 20 s for good GPS
    } catch {
      location = null; // blocked, not found or too slow: the server refuses and we show the steps
    }
    if (location && location.accuracy > MAX_ACCURACY_M) {
      // too rough to tell whether you are at the plant: don't send it, show how to turn on precise location
      setBusy(false);
      return setResult({ panel: "too_rough", text: `Location too rough (±${dist(Math.round(location.accuracy))}).` });
    }
    const r = await api<{ kind: Kind; at: string; distance_m: number; code?: string; next?: Kind; state?: string }>("/api/punch", { body: { k, expect: next, location } });
    setBusy(false);
    if (r.ok) return setResult({ panel: "saved", kind: r.data.kind, at: r.data.at, distance_m: r.data.distance_m });
    const code = r.data?.code;
    if (r.data?.next && r.data?.state) {
      setNext(r.data.next);
      setState(r.data.state);
    }
    if (code === "no_location") return setResult({ panel: "no_location", text: r.error! });
    if (code === "outside" || code === "too_rough" || code === "double" || code === "key" || code === "no_location_set") return setResult({ panel: code, text: r.error! });
    if (code === "changed") return setResult({ panel: "error", text: `${r.error} Check the button below and tap again.` });
    setResult({ panel: "error", text: r.error ?? "Something went wrong" });
  }

  const reset = () => setResult(null);

  if (result?.panel === "saved") {
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-7 text-center text-emerald-900">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Saved">
          <circle cx="12" cy="12" r="10" />
          <path d="m8 12 3 3 5-6" />
        </svg>
        <p className="text-2xl font-bold">
          {result.kind.toUpperCase()} at {time(result.at)}
        </p>
        <p>{dist(result.distance_m)} from the plant · saved</p>
        <a href="/" className={`${again} flex items-center border-emerald-200 text-emerald-900`}>
          See my attendance
        </a>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-6 text-center">
        <p className="text-slate-500">{name}</p>
        <p className="text-3xl font-bold">{state}</p>
        <p className="text-slate-500">{date}</p>
        <button
          type="button"
          onClick={tap}
          disabled={busy}
          className="min-h-22 w-full rounded-2xl bg-(--brand) text-3xl font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60"
        >
          {busy ? (
            <span className="flex flex-col items-center text-xl leading-tight">
              Finding your location…
              {accuracy !== null && <span className="text-base font-semibold opacity-80">±{dist(Math.round(accuracy))}</span>}
            </span>
          ) : next === "in" ? (
            "Mark IN"
          ) : (
            "Mark OUT"
          )}
        </button>
        <p className="text-sm text-slate-500">Your phone&apos;s location is checked once to make sure you are at the plant. Only the distance is kept.</p>
      </section>

      {result?.panel === "insecure" && (
        <section className={`space-y-2 rounded-2xl border p-5 ${panelCls.amber}`}>
          <h2 className="text-lg font-bold">Location can&apos;t be checked on this address</h2>
          <p>Phones only share their location with the secure app address (https). Open the app from the QR or from PlantOps.</p>
        </section>
      )}
      {result?.panel === "no_location" && (
        <section className={`space-y-2 rounded-2xl border p-5 ${panelCls.amber}`}>
          <h2 className="text-lg font-bold">{result.text}</h2>
          <p>
            <strong>Android (Chrome):</strong> tap the lock icon next to the address → Permissions → Location → Allow. Also turn on Location in the phone&apos;s quick settings.
          </p>
          <p>
            <strong>iPhone (Safari):</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using.
          </p>
          <button type="button" onClick={reset} className={`${again} border-amber-200`}>
            Try again
          </button>
        </section>
      )}
      {result && (result.panel === "outside" || result.panel === "key" || result.panel === "error") && (
        <section className={`space-y-2 rounded-2xl border p-5 ${panelCls.red}`}>
          <h2 className="text-lg font-bold">Not saved</h2>
          <p>{result.text}</p>
          <button type="button" onClick={reset} className={`${again} border-red-200`}>
            Try again
          </button>
        </section>
      )}
      {result && (result.panel === "too_rough" || result.panel === "no_location_set") && (
        <section className={`space-y-2 rounded-2xl border p-5 ${panelCls.amber}`}>
          <h2 className="text-lg font-bold">Not saved</h2>
          <p>{result.text}</p>
          {result.panel === "too_rough" && <PreciseLocationSteps />}
          <button type="button" onClick={reset} className={`${again} border-amber-200`}>
            Try again
          </button>
        </section>
      )}
      {result?.panel === "double" && (
        <section className={`space-y-1 rounded-2xl border p-5 ${panelCls.slate}`}>
          <h2 className="text-lg font-bold">{result.text}</h2>
          <p>Nothing more to do.</p>
        </section>
      )}
      <a href="/" className="flex min-h-11 items-center justify-center font-semibold text-(--brand)">
        My attendance this month
      </a>
    </div>
  );
}

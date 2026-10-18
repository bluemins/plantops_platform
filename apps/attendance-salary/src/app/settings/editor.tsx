"use client";

import { useState } from "react";
import { Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { parseLatLng } from "@/lib/geo";
import { bestLocation } from "@/lib/locate";
import type { SettingsView } from "@/server/settings";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const primary = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-(--brand) px-4 text-base font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60";
const secondary = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-base font-semibold";
/** The plant pin should be set from a GPS reading at least this good (B-04). */
const PIN_GOOD_M = 50;
const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/** Plant location, circle size and the QR (mock-up "Owner · Settings"). Support: read-only. */
export function SettingsEditor({ initial, canEdit }: { initial: SettingsView; canEdit: boolean }) {
  const [s, setS] = useState(initial);
  const [point, setPoint] = useState(initial.lat == null ? "" : `${initial.lat}, ${initial.lng}`);
  const [radius, setRadius] = useState(initial.radius_m);
  const [found, setFound] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmQr, setConfirmQr] = useState(false);
  const parsed = parseLatLng(point);
  const changed = !!parsed && (parsed.lat !== s.lat || parsed.lng !== s.lng || radius !== s.radius_m);

  function useMine() {
    setError(undefined);
    setSaved(undefined);
    if (!window.isSecureContext || !("geolocation" in navigator)) return setError("Location only works on the secure app address (https).");
    setFound("Finding your location…");
    // waits up to 20 s for good GPS (B-04): a rough pin would put every mark in the wrong place
    bestLocation(navigator.geolocation, (acc) => setFound(`Finding your location… ±${Math.round(acc)} m`)).then(
      (r) => {
        setPoint(`${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`);
        setFound(
          r.accuracy <= PIN_GOOD_M
            ? `Found, within about ${Math.round(r.accuracy)} m. Press Save.`
            : `Only rough (±${Math.round(r.accuracy)} m): stand outside in the open, turn on precise location (Android: Google Location Accuracy; iPhone: Precise Location) and tap again before saving.`,
        );
      },
      () => {
        setFound(undefined);
        setError("The phone didn't give its location. Allow location for this site and try again.");
      },
    );
  }

  async function save() {
    if (!parsed) return setError("Type the point as \"21.347, 83.627\" (copy it from Google Maps), or use your current location.");
    setBusy(true);
    setError(undefined);
    const r = await api<SettingsView>("/api/settings", { method: "PUT", body: { lat: parsed.lat, lng: parsed.lng, radius_m: radius } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setS(r.data);
    setFound(undefined);
    setSaved("Saved.");
  }

  async function makeQr() {
    setBusy(true);
    setError(undefined);
    const r = await api<SettingsView>("/api/settings/qr", { method: "POST", body: {} });
    setBusy(false);
    setConfirmQr(false);
    if (!r.ok) return setError(r.error);
    setS(r.data);
    setSaved("New QR made. Print it and put it up at the scan spot: the old one no longer works.");
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Plant location</h2>
          {s.lat != null && s.updated_at ? (
            <p className="text-sm font-semibold text-emerald-700">
              Set{s.updated_by_name ? ` by ${s.updated_by_name}` : ""} · last change {day(s.updated_at)}
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-700">Not set yet: nobody can mark attendance until it is.</p>
          )}
          {canEdit && (
            <>
              <button type="button" onClick={useMine} className={primary}>
                Use my current location
              </button>
              <p className="text-sm text-slate-500">Stand inside the plant when you tap it.</p>
              {found && <p className="text-sm font-semibold text-slate-700">{found}</p>}
            </>
          )}
          <label className="block space-y-1 text-sm text-slate-700">
            <span>{canEdit ? "Or paste from Google Maps" : "Point"}</span>
            <input className={field} value={point} placeholder="lat, lng" readOnly={!canEdit} onChange={(e) => (setPoint(e.target.value), setSaved(undefined))} />
          </label>
          {point && !parsed && <p className="text-sm text-red-700">Not a point. It looks like &quot;21.347, 83.627&quot;.</p>}
        </div>
      </Card>

      <Card>
        <div className="space-y-2">
          <label htmlFor="radius" className="flex justify-between text-lg font-bold">
            Circle size <span className="text-(--brand)">{radius.toLocaleString("en-IN")} m</span>
          </label>
          <input id="radius" type="range" min={50} max={2000} step={50} value={radius} disabled={!canEdit} onChange={(e) => (setRadius(Number(e.target.value)), setSaved(undefined))} className="w-full accent-(--brand)" />
          <div className="flex justify-between text-xs text-slate-500">
            <span>50 m</span>
            <span>2,000 m</span>
          </div>
          <p className="text-sm text-slate-500">Marks are accepted only inside this circle. Phones indoors can be 20–50 m off, so keep at least 200 m.</p>
        </div>
      </Card>

      {canEdit && (
        <button type="button" onClick={save} disabled={busy || !changed} className={primary}>
          Save location and circle
        </button>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="font-semibold text-emerald-700">{saved}</p>}

      <Card>
        <div className="space-y-3">
          <h2 className="text-lg font-bold">QR code</h2>
          <p className="text-sm text-slate-600">
            {s.qr_made_at ? `Made on ${day(s.qr_made_at)}. Print as many copies as you like (gate, godown).` : "No QR yet. Make it, print it and put it up where staff come in."}
          </p>
          {canEdit && s.qr_made_at && (
            <a href="/settings/print" className={secondary}>
              Print QR
            </a>
          )}
          {canEdit &&
            (confirmQr ? (
              <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-900">Every QR printed so far stops working at once. You must print the new one and put it up again.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirmQr(false)} className={secondary}>
                    Keep the old one
                  </button>
                  <button type="button" onClick={makeQr} disabled={busy} className="min-h-12 rounded-xl bg-red-700 px-3 font-bold text-white">
                    Make a new QR
                  </button>
                </div>
              </div>
            ) : s.qr_made_at ? (
              <button type="button" onClick={() => setConfirmQr(true)} className="min-h-12 w-full rounded-xl border border-red-200 bg-white font-semibold text-red-700">
                Make a new QR…
              </button>
            ) : (
              <button type="button" onClick={makeQr} disabled={busy} className={primary}>
                Make the QR
              </button>
            ))}
          {canEdit && s.qr_made_at && <p className="text-sm text-slate-500">A new QR stops every old print at once. Use it if a photo of the QR has gone outside the plant.</p>}
        </div>
      </Card>
    </div>
  );
}

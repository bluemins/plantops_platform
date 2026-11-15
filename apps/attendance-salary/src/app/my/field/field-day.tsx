"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtKm, mapsUrl, ROUGH_M, type FieldDayView, type TimelineItem } from "@/lib/field";
import { bestLocation, type Reading } from "@/lib/locate";
import { fmtTime } from "@/lib/punch";
import { shrink } from "@/lib/upload";
import { FieldTimeline, type LocationStates } from "../../field-bits";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-[17px] focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "block space-y-1.5 text-[15px] font-semibold text-slate-800";
const hint = "block text-sm font-normal text-slate-600";
const big = "min-h-13 w-full rounded-xl bg-(--brand) px-3 text-[17px] font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60";
const dark = "min-h-13 w-full rounded-xl bg-slate-900 px-3 text-[17px] font-bold text-white disabled:opacity-60";
const ghost = "min-h-10 rounded-lg border border-(--brand) bg-white px-3 text-sm font-semibold text-(--brand)";

interface View {
  today: string;
  day: FieldDayView;
  canStart: boolean;
  locations: LocationStates;
}

type Mode = { kind: "home" } | { kind: "start" } | { kind: "end" } | { kind: "visit" } | { kind: "fix"; item: TimelineItem };

// ---------- location ----------

/** The phone's best reading within 20 s (bestLocation), started when the form opens; "Try again" restarts it. */
function useLocation() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(true);
  const run = useCallback(() => {
    setWaiting(true);
    setError(null);
    setReading(null);
    if (!("geolocation" in navigator)) {
      setWaiting(false);
      setError("This phone can't give a location.");
      return;
    }
    bestLocation(navigator.geolocation, (a) => setLive(Math.round(a)))
      .then((r) => setReading(r))
      .catch(() => setError("No location. Allow location for this site in the phone's settings, switch location on, and try again."))
      .finally(() => setWaiting(false));
  }, []);
  useEffect(run, [run]);
  return { reading, live, error, waiting, retry: run };
}

function LocationCard({ loc }: { loc: ReturnType<typeof useLocation> }) {
  const r = loc.reading;
  const rough = !!r && r.accuracy > ROUGH_M;
  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${rough ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${rough || loc.error ? "bg-amber-100" : "bg-green-100"}`} aria-hidden="true">
        📍
      </span>
      <div className="min-w-0 text-sm">
        {loc.waiting ? (
          <p>
            <strong>Finding your location…</strong> {loc.live !== null && <span className="text-slate-600">±{loc.live} m</span>}
          </p>
        ) : r ? (
          <>
            <p>
              <strong>{rough ? "Rough location" : "Location found"}</strong>{" "}
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${rough ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"}`}>±{Math.round(r.accuracy)} m</span>
            </p>
            <p className="text-slate-600">
              {rough ? "Weak GPS here. It is saved with a note for the owner. " : ""}
              <a className="font-semibold text-(--brand)" href={mapsUrl(r.lat, r.lng)} target="_blank" rel="noreferrer">
                Open map
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="text-amber-900">{loc.error}</p>
            <button type="button" className="mt-1 font-semibold text-(--brand)" onClick={loc.retry}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const where = (r: Reading | null) => (r ? { lat: r.lat, lng: r.lng, accuracy_m: Math.round(r.accuracy) } : { lat: null, lng: null, accuracy_m: null });

// ---------- the meter photo ----------

function MeterPhoto({ blob, onPick, busy }: { blob: Blob | null; onPick: (b: Blob | null, error?: string) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setPreview(null);
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-semibold text-slate-800">Photo of the meter</p>
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="relative grid h-32 w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed border-slate-400 bg-white text-sm font-semibold text-(--brand)">
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Meter photo" className="h-full w-full object-cover" />
            <span className="absolute right-2 bottom-2 rounded-full bg-white/90 px-2 py-0.5 text-xs text-slate-800">Retake</span>
          </>
        ) : (
          "📷 Take photo"
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            onPick(await shrink(f));
          } catch {
            onPick(null, "This photo could not be read. Take it again.");
          }
        }}
      />
      <span className={hint}>The photo is made smaller on your phone before sending.</span>
    </div>
  );
}

/** Sends the shrunk photo; its id, or the reason it failed. */
async function sendPhoto(blob: Blob): Promise<{ id?: string; error?: string }> {
  try {
    const res = await fetch("/api/field/photo", { method: "POST", headers: { "content-type": blob.type || "image/jpeg" }, body: blob });
    const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (res.ok && data?.id) return { id: data.id };
    if (res.status === 401) window.location.reload();
    return { error: data?.error ?? `The photo wasn't sent (${res.status})` };
  } catch {
    return { error: "No connection. Check the internet and try again." };
  }
}

// ---------- forms ----------

function Back({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <div>
      <button type="button" onClick={onClick} className="text-sm font-semibold text-(--brand)">
        ← Field day
      </button>
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
    </div>
  );
}

function StartEndForm({ kind, day, onDone, onBack }: { kind: "start" | "end"; day: FieldDayView; onDone: () => void; onBack: () => void }) {
  const loc = useLocation();
  const [place, setPlace] = useState("");
  const [km, setKm] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const startKm = day.start?.kmTenths ?? null;
  const typed = Number(km.replace(/,/g, ""));
  const todayKm = kind === "end" && startKm !== null && km && Number.isFinite(typed) ? Math.round(typed * 10) - startKm : null;

  async function save() {
    setError(undefined);
    if (!loc.reading) return setError("Wait for the location, or tap Try again.");
    if (!km.trim()) return setError("Type the km reading on the meter.");
    if (!blob) return setError("Take a photo of the meter.");
    setBusy(true);
    const p = await sendPhoto(blob);
    if (!p.id) {
      setBusy(false);
      return setError(`${p.error} Nothing was saved yet: tap Save again.`);
    }
    const r = await api(`/api/field/${kind}`, { body: { ...where(loc.reading), place, km, photo_id: p.id } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }

  return (
    <div className="space-y-4">
      <Back onClick={onBack} title={kind === "start" ? "Start my day" : "End my day"} />
      <LocationCard loc={loc} />
      <label className={label}>
        <span>
          Place <span className="font-normal text-slate-600">(optional)</span>
        </span>
        <input className={field} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Plant gate" />
      </label>
      <label className={label}>
        <span>Km reading on the meter</span>
        <input className={`${field} tabular-nums`} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 45210.5" />
        {kind === "end" && startKm !== null && <span className={hint}>Started at {fmtKm(startKm)} km</span>}
      </label>
      <MeterPhoto blob={blob} busy={busy} onPick={(b, e) => (setBlob(b), setError(e))} />
      {todayKm !== null && todayKm >= 0 && (
        <div className="flex justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px]">
          <strong>Today by meter</strong>
          <strong className="tabular-nums">{fmtKm(todayKm)} km</strong>
        </div>
      )}
      <button type="button" onClick={save} disabled={busy || loc.waiting} className={kind === "start" ? big : dark}>
        {busy ? "Saving…" : kind === "start" ? "Save start" : "Save end"}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

interface Customer {
  id: string;
  name: string;
  place: string;
  location: { at: string; by: string; source: string } | null;
}

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

function VisitForm({ onDone, onBack }: { onDone: (message?: string) => void; onBack: () => void }) {
  const loc = useLocation();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [available, setAvailable] = useState(true);
  const [picked, setPicked] = useState<Customer | null>(null);
  const [typing, setTyping] = useState(false);
  const [shop, setShop] = useState("");
  const [phone, setPhone] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const typed = typing || !available;
  const rough = !!loc.reading && loc.reading.accuracy > ROUGH_M;

  useEffect(() => {
    if (typed || picked || q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; customers: Customer[] }>(`/api/field/customers?q=${encodeURIComponent(q.trim())}`);
      if (!r.ok || !r.data.available) {
        setAvailable(false);
        setShop(q.trim());
        return;
      }
      setResults(r.data.customers);
    }, 300);
    return () => clearTimeout(t);
  }, [q, typed, picked]);

  function pick(c: Customer) {
    setPicked(c);
    setSave(!c.location); // no shop location yet: ticked; one saved already: "Replace", unticked
  }

  async function send() {
    setError(undefined);
    if (!loc.reading) return setError("Wait for the location, or tap Try again.");
    const body = picked
      ? { ...where(loc.reading), customer_id: picked.id, customer_name: picked.name, customer_place: picked.place || null, phone: null, note, save_location: save && !rough }
      : { ...where(loc.reading), customer_id: null, customer_name: shop, customer_place: place || null, phone: phone || null, note, save_location: false };
    if (!picked && !shop.trim()) return setError(typed ? "Type the shop's name." : "Pick the customer, or tap “Not in the list”.");
    setBusy(true);
    const r = await api<{ location: { state: string; message?: string } | null }>("/api/field/visit", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(r.data.location?.state === "not_saved" ? r.data.location.message : undefined);
  }

  return (
    <div className="space-y-4">
      <Back onClick={onBack} title="Shop visited" />
      <LocationCard loc={loc} />
      {!available && <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-950">Customer list can&apos;t be reached right now. Type the shop name.</p>}
      {typed ? (
        <>
          <label className={label}>
            <span>Shop name</span>
            <input className={field} value={shop} maxLength={100} onChange={(e) => setShop(e.target.value)} placeholder="e.g. New shop near bus stand" />
          </label>
          <label className={label}>
            <span>
              Shop&apos;s phone number <span className="font-normal text-slate-600">(optional)</span>
            </span>
            <input className={`${field} tabular-nums`} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
          </label>
          <label className={label}>
            <span>
              Place <span className="font-normal text-slate-600">(optional)</span>
            </span>
            <input className={field} value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />
          </label>
          {available && (
            <button type="button" className="text-sm font-semibold text-(--brand)" onClick={() => setTyping(false)}>
              ← Search the customer list
            </button>
          )}
        </>
      ) : picked ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2 rounded-xl border border-(--brand) bg-(--brand-soft) px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-semibold break-words">{picked.name}</p>
              <p className="text-sm text-slate-600">
                {picked.place}
                {picked.location ? ` · shop location saved ${shortDate(picked.location.at)} by ${picked.location.by}` : " · no shop location yet"}
              </p>
            </div>
            <button type="button" className="shrink-0 text-sm font-semibold text-(--brand)" onClick={() => (setPicked(null), setQ(""))}>
              Change
            </button>
          </div>
          {rough ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">Location too rough to save as the shop&apos;s location. The visit is still saved.</p>
          ) : (
            <label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-(--brand)" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span className="text-[15px] font-semibold text-slate-800">
                {picked.location ? "Replace the shop's location" : "Save this location as the shop's location"}
                <span className={hint}>
                  {picked.location ? `Saved ${shortDate(picked.location.at)} by ${picked.location.by}. The old one stays on record.` : `Kept on ${picked.name} in Sales for later visits and deliveries.`}
                </span>
              </span>
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className={label}>
            <span>Customer: name, place or phone number</span>
            <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type 2 letters or 6 digits" autoComplete="off" />
          </label>
          {results.length > 0 && (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)} className="block w-full px-3 py-2.5 text-left">
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-sm text-slate-600">
                      {c.place}
                      {c.location ? "" : " · no shop location yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="text-sm font-semibold text-(--brand)" onClick={() => (setTyping(true), setShop(q.trim()))}>
            Not in the list? Type the shop name
          </button>
        </div>
      )}
      <label className={label}>
        <span>
          Meeting notes <span className="font-normal text-slate-600">(optional)</span>
        </span>
        <textarea className={`${field} min-h-24 py-2`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What did you talk about?" />
        <span className={`${hint} text-right`}>{note.length} / 300 · can&apos;t be changed after saving</span>
      </label>
      <button type="button" onClick={send} disabled={busy || loc.waiting} className={big}>
        {busy ? "Saving…" : "Save visit"}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

function FixForm({ item, day, onDone, onBack }: { item: TimelineItem; day: FieldDayView; onDone: () => void; onBack: () => void }) {
  const [km, setKm] = useState(item.kmTenths !== null ? (item.kmTenths / 10).toFixed(1) : "");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const visit = item.kind === "visit";

  async function send() {
    setError(undefined);
    setBusy(true);
    let photoId: string | undefined;
    if (blob) {
      const p = await sendPhoto(blob);
      if (!p.id) {
        setBusy(false);
        return setError(p.error);
      }
      photoId = p.id;
    }
    const r = visit ? await api("/api/field/remove", { body: { event_id: item.id, reason } }) : await api("/api/field/correct", { body: { event_id: item.id, km, photo_id: photoId ?? null, reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }

  return (
    <div className="space-y-4">
      <Back onClick={onBack} title={visit ? `Remove visit` : `Correct ${item.kind} km`} />
      <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px]">
        <strong>{visit ? item.customerName : item.kind === "start" ? "Start" : "End"}</strong> · {fmtTime(item.at)}
        {!visit && item.kmTenths !== null && <> · {fmtKm(item.kmTenths)} km</>}
      </p>
      {!visit && (
        <>
          <label className={label}>
            <span>Right km reading</span>
            <input className={`${field} tabular-nums`} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
            {item.kind === "end" && day.start && <span className={hint}>Started at {fmtKm(day.start.kmTenths!)} km</span>}
          </label>
          <MeterPhoto blob={blob} busy={busy} onPick={(b, e) => (setBlob(b), setError(e))} />
          <span className={hint}>A new photo is optional: without one the first photo stays.</span>
        </>
      )}
      <label className={label}>
        <span>{visit ? "Why remove it?" : "Why correct it?"}</span>
        <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={visit ? "e.g. Wrong shop picked" : "e.g. Typed the reading wrong"} />
      </label>
      <button type="button" onClick={send} disabled={busy} className={visit ? "min-h-13 w-full rounded-xl bg-red-700 px-3 text-[17px] font-bold text-white disabled:opacity-60" : big}>
        {busy ? "Saving…" : visit ? "Remove visit" : "Save correction"}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
      <p className="text-sm text-slate-600">
        It stays on record, crossed out, with your reason. You can do this on the same day only; the owner can do it any day.
        {visit && " A shop location already saved stays in Sales; the owner or Order desk clears it there."}
      </p>
    </div>
  );
}

// ---------- the screen ----------

/** My field day: the day's timeline with Start / Shop visited / End, and fixes on the same day. */
export function FieldDayScreen({ v, dayLabel, lastNight }: { v: View; dayLabel: string; lastNight: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "home" });
  const [notice, setNotice] = useState<string>();
  const [retrying, setRetrying] = useState<string | null>(null);
  const day = v.day;
  const started = !!day.start;
  const ended = !!day.end;
  const home = (message?: string) => {
    setMode({ kind: "home" });
    setNotice(message);
    router.refresh();
    window.scrollTo(0, 0);
  };

  async function retry(visitId: string) {
    setRetrying(visitId);
    const r = await api<{ state: string; message?: string }>("/api/field/location", { body: { visit_id: visitId } });
    setRetrying(null);
    setNotice(r.ok ? (r.data.state === "saved" ? "Shop location saved." : r.data.message) : r.error);
    router.refresh();
  }

  if (mode.kind === "start" || mode.kind === "end") return <StartEndForm kind={mode.kind} day={day} onDone={() => home()} onBack={() => setMode({ kind: "home" })} />;
  if (mode.kind === "visit") return <VisitForm onDone={(m) => home(m)} onBack={() => setMode({ kind: "home" })} />;
  if (mode.kind === "fix") return <FixForm item={mode.item} day={day} onDone={() => home()} onBack={() => setMode({ kind: "home" })} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          Field day{" "}
          {started && !ended && <span className="rounded-full bg-green-100 px-2.5 py-0.5 align-middle text-sm font-semibold text-green-800">On round</span>}
          {ended && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 align-middle text-sm font-semibold text-slate-700">Ended</span>}
        </h1>
        <p className="text-sm text-slate-600">
          {dayLabel}
          {lastNight && " · last night's round, not ended yet"}
        </p>
      </div>
      {notice && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">{notice}</p>}
      {!started ? (
        <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-5 text-center">
          <p className="text-3xl" aria-hidden="true">
            🛵
          </p>
          <p className="font-bold">Not started yet</p>
          <p className="text-sm text-slate-600">Start when you leave for your round. You&apos;ll need the bike&apos;s km reading and a photo of the meter.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-3 pt-3.5">
          <FieldTimeline
            day={day}
            locations={v.locations}
            actions={(t) => {
              if (t.replaced || t.removed) return null;
              const tryAgain = t.kind === "visit" && t.saveLocation && v.locations[t.id] === "not_saved";
              return (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {tryAgain && (
                    <button type="button" className={ghost} disabled={retrying === t.id} onClick={() => retry(t.id)}>
                      {retrying === t.id ? "Sending…" : "Try again"}
                    </button>
                  )}
                  <button type="button" className="min-h-10 px-1 text-sm font-semibold text-slate-600 underline" onClick={() => setMode({ kind: "fix", item: t })}>
                    {t.kind === "visit" ? "Remove" : "Correct km"}
                  </button>
                </div>
              );
            }}
          />
        </div>
      )}
      {ended && day.kmTenths !== null && (
        <div className="space-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px]">
          <p className="flex justify-between">
            <strong>Today by meter</strong>
            <strong className="tabular-nums">{fmtKm(day.kmTenths)} km</strong>
          </p>
          <p className="flex justify-between text-slate-600">
            <span>Shops visited</span>
            <span>{day.visits.length}</span>
          </p>
        </div>
      )}
      {started && !ended && (
        <div className="space-y-2.5">
          <button type="button" className={big} onClick={() => setMode({ kind: "visit" })}>
            ＋ Shop visited
          </button>
          <button type="button" className={dark} onClick={() => setMode({ kind: "end" })}>
            ■&nbsp; End my day
          </button>
        </div>
      )}
      {v.canStart && (!started || lastNight) && (
        <button type="button" className={`${big} min-h-16 text-lg`} onClick={() => setMode({ kind: "start" })}>
          ▶&nbsp; Start my day
        </button>
      )}
      <p className="text-center text-sm text-slate-600">Your location is saved only when you tap Start, Shop visited or End.</p>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { MAX_PHOTOS, photoPicks, uploadPicks, type Pick } from "@/lib/upload";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-[17px] focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "block space-y-1.5 text-[15px] font-semibold text-slate-800";
const hint = "block text-sm font-normal text-slate-600";

/**
 * A claim from the phone: the worker's own, or - with `person` - the owner entering one for someone (approved at once). Field duty: date, km (0 = DA only), "Ask for DA" (ticked; untick = TA only), where / what for. Expense: date, amount,
 * what for, up to 3 bill photos (shrunk on the phone first). The claim is saved first, then each photo is sent; a photo
 * that fails can be sent again from My claims within 24 hours.
 */
export function ClaimForm({ kind, today, earliest, person }: { kind: "field_duty" | "expense"; today: string; earliest: string; person?: { userId: string; name: string } }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(today);
  const [km, setKm] = useState("");
  const [wantsDa, setWantsDa] = useState(true);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const duty = kind === "field_duty";
  const back = person ? `/staff/${person.userId}` : "/my/claims";

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_PHOTOS - photos.length;
    const picks = await photoPicks([...files].slice(0, room));
    setPhotos((p) => [...p, ...picks]);
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    const claim = { kind, on_date: date, km: duty ? km : null, wants_da: duty ? wantsDa : null, amount: duty ? null : amount, note };
    const r = await api<{ id: string }>(person ? "/api/claims/enter" : "/api/claims", { body: person ? { ...claim, user_id: person.userId } : claim });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    let failed: string | undefined;
    if (!duty && photos.length) {
      await uploadPicks(`/api/claims/photo?claim=${r.data.id}`, photos, (key, change) => {
        if (change.state === "failed") failed = change.error;
        setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));
      });
    }
    if (failed) {
      setBusy(false);
      setError(`The claim was saved, but a photo wasn't: ${failed}${person ? "" : " Add it again from My claims within 24 hours."}`);
      return;
    }
    router.push(`${back}?m=${date.slice(0, 7)}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <a href={back} className="text-sm font-semibold text-(--brand)">
          ← {person ? person.name : "My claims"}
        </a>
        <h1 className="mt-1 text-2xl font-bold">{duty ? "Field duty" : "Money spent for the plant"}</h1>
        {person && <p className="text-sm text-slate-600">For {person.name}, entered by you: approved at once.</p>}
      </div>
      <label className={label}>
        <span>Date</span>
        <input className={field} type="date" value={date} min={earliest} max={today} onChange={(e) => setDate(e.target.value)} />
        <span className={hint}>{person ? "Any day from the first salary month to today" : duty ? "One field-duty entry per day · up to 31 days back" : "Up to 31 days back"}</span>
      </label>
      {duty ? (
        <label className={label}>
          <span>Km travelled</span>
          <input className={field} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 42" />
          <span className={hint}>Put 0 if you were on field duty without travelling</span>
        </label>
      ) : null}
      {duty ? (
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2.5">
          <input type="checkbox" className="h-6 w-6 shrink-0 accent-(--brand)" checked={wantsDa} onChange={(e) => setWantsDa(e.target.checked)} />
          <span className="text-[15px] font-semibold text-slate-800">
            Ask for DA (food allowance) for this day
            <span className={hint}>{wantsDa ? "Untick if you ate at home" : "No DA for this day: only TA for the km"}</span>
          </span>
        </label>
      ) : (
        <label className={label}>
          <span>Amount (₹)</span>
          <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 450" />
        </label>
      )}
      <label className={label}>
        <span>{duty ? "Where / what for?" : "What was it for?"}</span>
        <input className={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={duty ? "e.g. Cuttack delivery" : "e.g. Diesel for generator"} />
      </label>
      {!duty && (
        <div className="space-y-2">
          <p className="text-[15px] font-semibold text-slate-800">
            Bill photo <span className="font-normal text-slate-600">(optional, up to {MAX_PHOTOS})</span>
          </p>
          <div className="flex flex-wrap gap-2.5">
            {photos.map((p, i) => (
              <div key={p.key} className="relative h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {p.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt={`Bill photo ${i + 1}`} className="h-full w-full object-cover" />
                )}
                {p.state !== "waiting" && (
                  <span className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-center text-xs font-semibold ${p.state === "failed" ? "bg-red-600 text-white" : "bg-white/90 text-slate-800"}`}>
                    {p.state === "uploading" ? "Sending…" : p.state === "done" ? "Sent ✓" : "Not sent"}
                  </span>
                )}
                {!busy && p.state !== "done" && (
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos((list) => list.filter((x) => x.key !== p.key))} className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm font-bold">
                    ×
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" onClick={() => pick.current?.click()} disabled={busy} className="h-24 w-24 rounded-xl border-2 border-dashed border-slate-400 bg-white text-sm font-semibold text-(--brand)">
                + Photo
              </button>
            )}
          </div>
          <input ref={pick} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (addPhotos(e.target.files), (e.target.value = ""))} />
          <p className={hint}>Photos are made smaller on your phone before sending.</p>
        </div>
      )}
      <button type="button" onClick={send} disabled={busy} className="min-h-13 w-full rounded-xl bg-(--brand) text-[17px] font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60">
        {busy ? "Sending…" : person ? "Save (approved)" : "Send to owner"}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
      {person ? null : duty ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950">Field duty doesn&apos;t mark you present. Scan the QR as usual when you come to or leave the plant.</p>
      ) : (
        <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">The owner approves it. Approved expenses are paid with that month&apos;s salary.</p>
      )}
    </div>
  );
}

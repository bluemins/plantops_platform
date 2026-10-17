"use client";

import { useRef, useState } from "react";
import { shrink } from "@plantops/module-kit/photo";
import { LIMITS, MAX_FILE_BYTES, MAX_PHOTOS, newRequestKey } from "@/lib/apply";

type Page = { key: number; blob: Blob; preview: string };
type Sent = { ref: string; name: string; phone: string };

const input = "w-full rounded-xl border border-slate-300 bg-white px-3 py-[13px] text-base text-slate-900 focus:border-(--brand) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none";
const label = "text-[15px] font-semibold";
let pageKeys = 0;

/**
 * Mock-ups 3 (apply) and 4 (sent). The sent screen is shown here, not on a new address, so the phone number never
 * appears in a link. Checks repeat the server's, so a typo never costs one of the 5 sends an hour.
 */
export function ApplyForm(props: {
  plantName: string;
  /** where the send goes: /api/apply/<code> */
  action: string;
  /** "" for the bare address, "/<code>" otherwise */
  base: string;
  openings: { id: string; title: string }[];
  preselect: string;
  consent: string;
  turnstileSiteKey: string;
}) {
  const [requestKey] = useState(newRequestKey);
  const [mode, setMode] = useState<"photos" | "pdf">("photos");
  const [pages, setPages] = useState<Page[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<Sent | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  async function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    setError(undefined);
    setReading(true);
    const room = MAX_PHOTOS - pages.length;
    const added: Page[] = [];
    for (const file of Array.from(list).slice(0, room)) {
      try {
        const blob = await shrink(file);
        added.push({ key: ++pageKeys, blob, preview: URL.createObjectURL(blob) });
      } catch {
        setError("One photo could not be read. Please take it again.");
      }
    }
    if (list.length > room) setError(`At most ${MAX_PHOTOS} photos.`);
    setPages((p) => [...p, ...added]);
    setReading(false);
    if (photoInput.current) photoInput.current.value = "";
  }

  function pickPdf(list: FileList | null) {
    const file = list?.[0] ?? null;
    setError(undefined);
    if (file && file.size > MAX_FILE_BYTES) {
      setPdf(null);
      setError("The PDF is bigger than 5 MB. Take photos of your CV instead.");
    } else setPdf(file);
    if (pdfInput.current) pdfInput.current.value = "";
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone") ?? "").replace(/[\s\-.()]/g, "").replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) return setError("Mobile number: 10 digits, starting with 6, 7, 8 or 9.");
    if (mode === "photos" && !pages.length) return setError("Please add a photo of your CV (or switch to Upload PDF).");
    if (mode === "pdf" && !pdf) return setError("Please choose your PDF (or switch to Take photos).");
    form.delete("photos");
    form.delete("pdf");
    if (mode === "pdf") form.append("resume", pdf!, "resume.pdf");
    else pages.forEach((p, i) => form.append("resume", p.blob, `page-${i + 1}.jpg`));
    form.set("request_key", requestKey);
    setBusy(true);
    try {
      const res = await fetch(props.action, { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (Sent & { error?: string }) | null;
      if (!res.ok || !data) setError(data?.error ?? "Something went wrong. Please try again.");
      else {
        setSent(data);
        window.scrollTo(0, 0);
      }
    } catch {
      setError("No connection. Check the internet and try again.");
    }
    setBusy(false);
  }

  if (sent) {
    const first = sent.name.trim().split(/\s+/)[0];
    const phone = sent.phone ? `${sent.phone.slice(0, 5)} ${sent.phone.slice(5)}` : "";
    return (
      <div className="flex min-h-screen flex-col p-4">
        <div className="pt-3 text-sm font-semibold text-slate-600">{props.plantName}</div>
        <div className="flex grow flex-col justify-center gap-5">
          <div className="flex flex-col items-center gap-3.5 rounded-[20px] border border-slate-200 bg-white px-5 py-7 text-center">
            <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-green-100 text-green-800">
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-[26px] font-bold">Application sent</h1>
            <div className="text-[15px] text-slate-600">Your reference</div>
            <div className="text-[32px] font-bold tracking-[0.04em] text-slate-900">{sent.ref}</div>
            <p className="text-base leading-normal">
              Thank you{first ? `, ${first}` : ""}. {props.plantName} will call you{phone ? (
                <>
                  {" "}
                  on <strong>{phone}</strong>
                </>
              ) : null}{" "}
              if there is a match.
            </p>
            <p className="text-sm leading-[1.45] text-slate-600">Keep this reference if you call the plant. You don&apos;t need to apply again for the same job.</p>
          </div>
          <a href={props.base || "/"} className="block rounded-[14px] border-2 border-(--brand) p-[13px] text-center text-base font-bold text-slate-900">
            See other positions
          </a>
        </div>
      </div>
    );
  }

  const toggle = (on: boolean) =>
    `min-h-12 rounded-xl px-3 text-[15px] ${on ? "border-2 border-(--brand) bg-(--brand-soft) font-bold text-slate-900" : "border border-slate-300 bg-white font-semibold text-slate-900"}`;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <a href={props.base || "/"} className="flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-slate-900">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </a>
        <span className="ml-auto truncate text-sm font-semibold text-slate-600">{props.plantName}</span>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-[18px] px-4 py-5" noValidate>
        <h1 className="text-2xl font-bold">Apply for a job</h1>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pos" className={label}>
            Position
          </label>
          <select id="pos" name="position" defaultValue={props.preselect} className={`${input} min-h-[50px]`}>
            <option value="any">Any job (just send my resume)</option>
            {props.openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className={label}>
            Full name
          </label>
          <input id="name" name="name" required minLength={LIMITS.name[0]} maxLength={LIMITS.name[1]} autoComplete="name" className={input} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className={label}>
            Mobile number
          </label>
          <div className="flex overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-(--brand) focus-within:ring-2 focus-within:ring-(--brand-ring)">
            <span className="border-r border-slate-300 bg-slate-100 px-3 py-[13px] text-base text-slate-700">+91</span>
            <input id="phone" name="phone" type="tel" inputMode="numeric" required maxLength={16} autoComplete="tel-national" aria-describedby="phone-hint" className="min-w-0 grow px-3 py-[13px] text-base text-slate-900 outline-none" />
          </div>
          <span id="phone-hint" className="text-[13px] text-slate-600">
            We call you on this number.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="place" className={label}>
            Where do you live now?
          </label>
          <input id="place" name="place" required minLength={LIMITS.place[0]} maxLength={LIMITS.place[1]} placeholder="Village / town, district" className={input} />
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className={`${label} mb-1.5`}>Resume</legend>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" aria-pressed={mode === "pdf"} onClick={() => setMode("pdf")} className={toggle(mode === "pdf")}>
              Upload PDF
            </button>
            <button type="button" aria-pressed={mode === "photos"} onClick={() => setMode("photos")} className={toggle(mode === "photos")}>
              Take photos
            </button>
          </div>
          {mode === "photos" ? (
            <div className="flex flex-wrap gap-2.5">
              {pages.map((p, i) => (
                <div key={p.key} className="relative h-[110px] w-[84px] overflow-hidden rounded-[10px] border border-slate-300 bg-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a photo the applicant just took, shown from memory */}
                  <img src={p.preview} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-1 left-1.5 rounded bg-white/85 px-1 text-xs text-slate-700">Page {i + 1}</span>
                  <button type="button" onClick={() => setPages(pages.filter((x) => x.key !== p.key))} aria-label={`Remove page ${i + 1}`} className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm font-bold text-slate-800">
                    ×
                  </button>
                </div>
              ))}
              {pages.length < MAX_PHOTOS && (
                <button type="button" disabled={reading} onClick={() => photoInput.current?.click()} className="h-[110px] w-[84px] rounded-[10px] border-2 border-dashed border-slate-400 bg-white text-[13px] font-semibold text-slate-700">
                  {reading ? "Reading…" : pages.length ? "+ Add page" : "+ Add photo"}
                </button>
              )}
              <input ref={photoInput} type="file" name="photos" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => pdfInput.current?.click()} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-semibold">
                {pdf ? "Choose another PDF" : "Choose PDF"}
              </button>
              {pdf && <span className="min-w-0 truncate text-sm text-slate-700">{pdf.name}</span>}
              <input ref={pdfInput} type="file" name="pdf" accept="application/pdf,.pdf" hidden onChange={(e) => pickPdf(e.target.files)} />
            </div>
          )}
          <span className="text-[13px] text-slate-600">A PDF up to 5 MB, or up to 3 photos of a paper CV.</span>
        </fieldset>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm leading-[1.45]">
          <input type="checkbox" name="consent" value="yes" required className="mt-0 h-[22px] w-[22px] shrink-0" />
          <span>{props.consent}</span>
        </label>

        {/* the trap: hidden from people (and screen readers); a bot that fills it gets "sent" and nothing is saved */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        {props.turnstileSiteKey && (
          <>
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div className="cf-turnstile" data-sitekey={props.turnstileSiteKey} />
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || reading} className="rounded-[14px] bg-(--brand) p-[15px] text-[17px] font-bold text-(--brand-contrast) disabled:opacity-60">
          {busy ? "Sending…" : "Send application"}
        </button>
        <span className="text-center text-xs text-slate-600">Protected against spam. Your details are seen only by {props.plantName}.</span>
      </form>
    </div>
  );
}

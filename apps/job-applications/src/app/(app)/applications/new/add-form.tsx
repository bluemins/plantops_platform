"use client";

import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { LIMITS, MAX_PHOTOS, newRequestKey } from "@/lib/apply";
import { NOTE_MAX } from "@/lib/status";
import { ResumePicker, uploadResume } from "../resume-picker";

const input = "w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base focus:border-(--brand) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none";
const label = "text-[15px] font-semibold";

/** "+ Add applicant": someone who phoned or walked in. Saves the details, then the resume pages if any were picked. */
export function AddForm({ plantName, openings }: { plantName: string; openings: { id: string; title: string; status: string }[] }) {
  const [requestKey] = useState(newRequestKey);
  const [files, setFiles] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const phone = String(f.get("phone") ?? "").replace(/[\s\-.()]/g, "").replace(/^(\+91|91(?=\d{10}$)|0(?=\d{10}$))/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) return setError("Mobile number: 10 digits, starting with 6, 7, 8 or 9.");
    setBusy(true);
    const res = await api<{ id: string; ref: string }>("/api/app/applications", {
      body: {
        position: f.get("position"),
        name: f.get("name"),
        phone,
        place: f.get("place"),
        note: String(f.get("note") ?? "").trim() || undefined,
        consent: f.get("consent") === "yes",
        request_key: requestKey,
      },
    });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    const sent = files.length ? await uploadResume(res.data.id, files) : { sent: 0 };
    window.location.href = `/applications/${res.data.id}${sent.error ? "?resume=failed" : ""}`;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="position" className={label}>
            Position
          </label>
          <select id="position" name="position" defaultValue="any" className={input}>
            <option value="any">Any job</option>
            {openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
                {o.status === "off" ? " (switched off)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className={label}>
            Full name
          </label>
          <input id="name" name="name" required minLength={LIMITS.name[0]} maxLength={LIMITS.name[1]} autoComplete="off" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className={label}>
            Mobile number
          </label>
          <input id="phone" name="phone" type="tel" inputMode="numeric" required maxLength={16} placeholder="10 digits" autoComplete="off" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="place" className={label}>
            Where they live
          </label>
          <input id="place" name="place" required minLength={LIMITS.place[0]} maxLength={LIMITS.place[1]} placeholder="Village / town, district" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className={label}>
            Note <span className="font-normal text-slate-600">(optional)</span>
          </label>
          <textarea id="note" name="note" rows={3} maxLength={NOTE_MAX} placeholder="e.g. Called on phone, 2 years in an RO plant, can join in a week" className={`${input} resize-y`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>
            Resume <span className="font-normal text-slate-600">(optional, can be added later)</span>
          </span>
          <ResumePicker room={MAX_PHOTOS} pdfAllowed onChange={setFiles} disabled={busy} />
          <span className="text-[13px] text-slate-600">A PDF up to 5 MB, or up to 3 photos of a paper CV.</span>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm leading-[1.45]">
          <input type="checkbox" name="consent" value="yes" required className="mt-0 h-[22px] w-[22px] shrink-0" />
          <span>They agreed that {plantName} may keep their details for 12 months to contact them about jobs.</span>
        </label>
      </fieldset>
      <ErrorText>{error}</ErrorText>
      <button type="submit" disabled={busy} className="w-full rounded-[14px] bg-(--brand) p-[14px] text-base font-bold text-(--brand-contrast) disabled:opacity-50">
        {busy ? "Saving…" : "Add applicant"}
      </button>
    </form>
  );
}

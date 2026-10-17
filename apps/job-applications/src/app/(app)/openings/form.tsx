"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { GROUPS, LIMITS } from "@/lib/groups";
import type { OpeningInput } from "@/server/openings";

const input = "w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base focus:border-(--brand) focus:ring-2 focus:ring-(--brand-ring) focus:outline-none";
const label = "text-[15px] font-semibold";

/** Mock-up 8: add or edit a position (owner). Support sees the same fields read-only. */
export function OpeningForm({ id, initial, received, canEdit }: { id: string | null; initial: OpeningInput; received: number; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ ...initial, tag: initial.tag ?? "", goodToHave: initial.goodToHave ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = id ? await api(`/api/app/openings/${id}`, { method: "PATCH", body: v }) : await api("/api/app/openings", { body: v });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push("/openings");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <fieldset disabled={!canEdit || busy} className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="t" className={label}>
            Position
          </label>
          <input id="t" required minLength={2} maxLength={LIMITS.title} value={v.title} onChange={set("title")} className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="grp" className={label}>
            Group on the public page
          </label>
          <select id="grp" value={v.grp} onChange={set("grp")} className={input}>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tag" className={label}>
            Short tag <span className="font-normal text-slate-600">(shown on the job list)</span>
          </label>
          <input id="tag" maxLength={LIMITS.tag} value={v.tag} onChange={set("tag")} placeholder="e.g. 10th · 3-wheeler licence" className={input} />
        </div>
        <Area id="d" label="Job description" value={v.description} max={LIMITS.description} rows={8} onChange={set("description")} required />
        <Area id="m" label="Minimum qualification" value={v.minQualification} max={LIMITS.minQualification} rows={3} onChange={set("minQualification")} required />
        <Area id="g" label="Good to have" optional value={v.goodToHave} max={LIMITS.goodToHave} rows={4} onChange={set("goodToHave")} />
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <span id="show-label" className="grow text-[15px] font-semibold">
            Show on the public page
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={v.status === "active"}
            aria-labelledby="show-label"
            onClick={() => setV({ ...v, status: v.status === "active" ? "off" : "active" })}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${v.status === "active" ? "bg-(--brand)" : "bg-slate-300"}`}
          >
            <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all ${v.status === "active" ? "right-[3px]" : "left-[3px]"}`} />
          </button>
        </div>
      </fieldset>
      {id && received > 0 && (
        <p className="text-sm text-slate-600">
          The {received === 1 ? "application" : `${received} applications`} already received keep{received === 1 ? "s" : ""} the name &quot;{initial.title}&quot; {received === 1 ? "it" : "they"} applied for.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {canEdit && (
        <button type="submit" disabled={busy} className="min-h-13 w-full rounded-2xl bg-(--brand) py-3.5 text-[17px] font-bold text-(--brand-contrast) disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      )}
    </form>
  );
}

function Area(p: { id: string; label: string; value: string; max: number; rows: number; required?: boolean; optional?: boolean; onChange: (e: { target: { value: string } }) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={p.id} className={label}>
        {p.label} {p.optional && <span className="font-normal text-slate-600">(optional)</span>}
      </label>
      <textarea id={p.id} rows={p.rows} required={p.required} maxLength={p.max} value={p.value} onChange={p.onChange} className={`${input} resize-y text-[15px] leading-snug`} />
      <span className="self-end text-xs text-slate-600">
        {p.value.length.toLocaleString("en-IN")} / {p.max.toLocaleString("en-IN")}
      </span>
    </div>
  );
}

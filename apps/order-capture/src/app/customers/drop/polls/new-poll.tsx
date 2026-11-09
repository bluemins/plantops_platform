"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const box = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const SAMPLE = { question: "Which size sells most in your shop?", choices: ["20 L jar", "1 L bottle", "500 ml bottle", "250 ml bottle"] } as const;
const plusDays =(ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Owner: a new poll. It can't be edited after publishing (a new poll corrects it). */
export function NewPoll({ brands, main, today }: { brands: string[]; main: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const [other, setOther] = useState(false);
  const [picked, setPicked] = useState<string[]>([main]);
  const [opens, setOpens] = useState(today);
  const [closes, setCloses] = useState(plusDays(today, 6));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function publish() {
    setBusy(true);
    setError(undefined);
    const body = { question: question.trim(), choices: choices.map((c) => c.trim()).filter(Boolean), other_allowed: other, brands: picked, opens_on: opens, closes_on: closes };
    const r = await api<{ id: string }>("/api/drop/polls", { body }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.href = `/customers/drop/polls/${r.data.id}`;
  }

  /** A ready-made example; nothing is saved until the owner taps Publish. */
  function fillSample() {
    setQuestion(SAMPLE.question);
    setChoices([...SAMPLE.choices]);
    setOther(true);
    setOpen(true);
  }

  if (!open)
    return (
      <div className="space-y-2">
        <button type="button" className="min-h-12 w-full rounded-xl border border-dashed border-(--brand) font-semibold text-(--brand)" onClick={() => setOpen(true)}>
          + New poll
        </button>
        <button type="button" className="min-h-11 w-full text-sm font-semibold text-(--brand)" onClick={fillSample}>
          Fill in a sample poll
        </button>
      </div>
    );
  return (
    <section aria-label="New poll" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" className="text-sm font-semibold text-(--brand)" onClick={fillSample}>
        Fill in a sample poll
      </button>
      <label className="block text-sm font-semibold">
        Question
        <input className={`${box} mt-1`} maxLength={150} placeholder="e.g. Which size sells most in your shop?" value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Choices (2 to 6)</legend>
        {choices.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={box} maxLength={60} placeholder={`Choice ${i + 1}`} value={c} onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} />
            {choices.length > 2 && (
              <button type="button" className="min-h-12 px-2 text-sm text-red-700" onClick={() => setChoices((cs) => cs.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        {choices.length < 6 && (
          <button type="button" className="text-sm font-semibold text-(--brand)" onClick={() => setChoices((cs) => [...cs, ""])}>
            + Add a choice
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={other} onChange={(e) => setOther(e.target.checked)} /> Also an &quot;Other&quot; box the shop types into
        </label>
      </fieldset>
      {brands.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">For shops of</legend>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <label key={b} className={`min-h-11 cursor-pointer rounded-full px-3 py-2.5 text-sm font-semibold ${picked.includes(b) ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-300 bg-white"}`}>
                <input type="checkbox" className="sr-only" checked={picked.includes(b)} onChange={() => setPicked((ps) => (ps.includes(b) ? ps.filter((x) => x !== b) : [...ps, b]))} />
                {b}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-semibold">
          Opens on
          <input type="date" className={`${box} mt-1`} min={today} value={opens} onChange={(e) => setOpens(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Closes after
          <input type="date" className={`${box} mt-1`} min={opens} value={closes} onChange={(e) => setCloses(e.target.value)} />
        </label>
      </div>
      <p className="text-sm text-slate-500">After publishing it can&apos;t be changed (you can close it early). Shops never see the answers.</p>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full" onClick={publish} disabled={busy}>
        {busy ? "Publishing…" : "Publish poll"}
      </Button>
    </section>
  );
}

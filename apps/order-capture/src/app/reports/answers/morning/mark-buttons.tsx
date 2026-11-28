"use client";
import { useState } from "react";

type Mark = "useful" | "not_useful";

/** Useful / Not useful on one action (owner). Saved at once; tapping the other one changes it (the latest counts). */
export function MarkButtons({ date, no, initial }: { date: string; no: number; initial: Mark | null }) {
  const [mark, setMark] = useState<Mark | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(m: Mark) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/answers/morning/mark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, action_no: no, mark: m }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Not saved");
      setMark(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  }
  const btn = (m: Mark, label: string) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={mark === m}
      onClick={() => save(m)}
      className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${mark === m ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-800"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      {btn("useful", "Useful")}
      {btn("not_useful", "Not useful")}
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

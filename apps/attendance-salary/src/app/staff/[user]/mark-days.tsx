"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const MAX_DAYS = 31; // MAX_DAYS_PER_SAVE in server/day-marks.ts
const LABEL = { on: "ON", off: "OFF", clear: "Clear" } as const;
type Next = keyof typeof LABEL;

/** "4 Oct" */
const short = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/**
 * Owner only, the person's month (owner 2026-10-20, mock-up https://claude.ai/artifact/GZKHK5ovwTPFjtoEL6fihw): "Mark
 * days" turns the calendar into a picker; tapped days (today or earlier, any weekday) get a tick, and the bar at the
 * bottom marks them all ON, OFF or Clear in one save (`POST /api/day-marks`). Outside picking, a tap opens the day as
 * before. The picked days survive moving to another month (kept in this tab's sessionStorage).
 */
export function MarkDays({ personId, name, children }: { personId: string; name: string; children: ReactNode }) {
  const router = useRouter();
  const key = `mark-days:${personId}`;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  // picking carries over when the owner moves to the previous / next month
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { days?: unknown } | null;
      if (saved && Array.isArray(saved.days)) {
        setPicking(true);
        setPicked(saved.days.filter((d): d is string => typeof d === "string").slice(0, MAX_DAYS));
      }
    } catch {
      // no storage: start fresh
    }
  }, [key]);

  useEffect(() => {
    try {
      if (picking) sessionStorage.setItem(key, JSON.stringify({ days: picked }));
      else sessionStorage.removeItem(key);
    } catch {
      // no storage: picking just ends when the month changes
    }
  }, [key, picking, picked]);

  function toggleMode() {
    setPicking((p) => !p);
    setPicked([]);
    setError(undefined);
    setDone(undefined);
  }

  // while picking, a tap on a day picks it instead of opening it (future days are not links, so never picked)
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (!picking) return;
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (!a) return;
    e.preventDefault();
    const day = a.dataset.day!;
    if (picked.includes(day)) {
      setError(undefined);
      return setPicked(picked.filter((d) => d !== day));
    }
    if (picked.length >= MAX_DAYS) return setError(`At most ${MAX_DAYS} days at once`);
    setError(undefined);
    setPicked([...picked, day]);
  }

  async function save(mark: Next) {
    setBusy(true);
    setError(undefined);
    const r = await api<{ changed: number }>("/api/day-marks", { body: { user_id: personId, days: picked, mark } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const n = r.data.changed;
    const skipped = picked.length - n;
    setDone(`${n} day${n === 1 ? "" : "s"} marked ${LABEL[mark]}${skipped ? ` (${skipped} already ${LABEL[mark]})` : ""}.`);
    setPicking(false);
    setPicked([]);
    router.refresh();
  }

  const sorted = [...picked].sort();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{name}</h1>
        <button
          type="button"
          onClick={toggleMode}
          aria-pressed={picking}
          className={`min-h-11 rounded-xl border-2 border-(--brand) px-4 font-semibold ${picking ? "bg-(--brand) text-(--brand-contrast)" : "bg-white text-(--brand)"}`}
        >
          {picking ? "Done" : "Mark days"}
        </button>
      </div>
      {done && !picking && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {done}
        </p>
      )}
      {picking && <p className="text-center text-sm font-semibold text-(--brand)">Tap the days to mark</p>}
      <div onClickCapture={onClickCapture} className={picking ? "mark-days-picking" : undefined}>
        {/* the picked days get a tick and a thick outline */}
        {picking && sorted.length > 0 && (
          <style>{`${sorted.map((d) => `.mark-days-picking [data-day="${d}"]`).join(",")}{outline:3px solid var(--brand);outline-offset:-2px;position:relative}${sorted
            .map((d) => `.mark-days-picking [data-day="${d}"]::after`)
            .join(",")}{content:"✓";position:absolute;top:2px;right:4px;font-size:12px;font-weight:800;color:var(--brand)}`}</style>
        )}
        {children}
      </div>
      {picking && (
        <>
          <div className="h-36" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-6px_24px_rgba(15,23,42,0.12)]">
            <div className="mx-auto max-w-2xl space-y-2">
              <p className="text-sm font-semibold" aria-live="polite">
                {sorted.length === 0 ? (
                  <>
                    No days picked <span className="font-normal text-slate-500">· tap dates in the calendar</span>
                  </>
                ) : (
                  <>
                    {sorted.length} day{sorted.length === 1 ? "" : "s"} picked <span className="font-normal text-slate-500">· {sorted.map(short).join(", ")}</span>
                  </>
                )}
              </p>
              <div className="flex gap-2">
                {(["on", "off", "clear"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={busy || sorted.length === 0}
                    onClick={() => save(m)}
                    className="min-h-12 flex-1 rounded-xl border-2 border-(--brand) bg-white font-semibold text-slate-800 hover:bg-(--brand) hover:text-(--brand-contrast) disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-slate-800"
                  >
                    {LABEL[m]}
                  </button>
                ))}
                <button type="button" disabled={busy} onClick={toggleMode} className="min-h-12 px-3 font-semibold text-slate-500">
                  Cancel
                </button>
              </div>
              <p className="text-xs text-slate-500">ON = present · OFF = day off, not paid · Clear = back to the IN / OUT marks</p>
              <ErrorText>{error}</ErrorText>
            </div>
          </div>
        </>
      )}
    </>
  );
}

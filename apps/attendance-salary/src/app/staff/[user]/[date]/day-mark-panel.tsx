"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { DayMark } from "@/lib/salary";

const LABEL: Record<DayMark, string> = { on: "ON · present", off: "OFF · day off, not paid" };

/**
 * The owner's whole-day mark (docs/DAY_MARKS_PLAN.md): ON = a full present day, OFF = a day off without pay (rule 22,
 * owner 2026-10-23; paid leave covers it like an absent day; it was a paid day off before v0.29.3), Clear = back to
 * the IN / OUT marks. No times, no reason; saved at once and listed in Recent
 * changes. Others (Office staff, PlantOps support) only see the current mark.
 */
export function DayMarkPanel({ personId, name, day, mark, canMark }: { personId: string; name: string; day: string; mark: DayMark | null; canMark: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!canMark) {
    if (!mark) return null;
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="font-semibold">Owner marked this day {LABEL[mark]}</p>
      </section>
    );
  }

  async function set(next: DayMark | "clear") {
    setBusy(true);
    setError(undefined);
    const r = await api("/api/day-mark", { body: { user_id: personId, day, mark: next } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  const button = (value: DayMark | "clear", text: string, active: boolean) => (
    <button
      type="button"
      disabled={busy}
      aria-pressed={active}
      onClick={() => !active && set(value)}
      className={`min-h-12 flex-1 rounded-xl border-2 px-3 font-semibold disabled:opacity-60 ${
        active ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-800 hover:border-(--brand)"
      }`}
    >
      {text}
    </button>
  );

  return (
    <section aria-labelledby="day-mark" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <h2 id="day-mark" className="font-semibold">
          Mark the whole day
        </h2>
        <p className="text-sm text-slate-600">
          {mark ? `${name}: ${LABEL[mark]}. ` : ""}ON counts as present, OFF as a day off without pay (paid leave covers it for monthly staff). No times needed. Clear goes back to the IN / OUT marks.
        </p>
      </div>
      <div className="flex gap-2">
        {button("on", "ON", mark === "on")}
        {button("off", "OFF", mark === "off")}
        {button("clear", "Clear", mark === null)}
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

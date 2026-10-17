"use client";

import { useState } from "react";
import { Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { SettingsView } from "@/server/settings";

const CHOICES: [number | null, string][] = [
  [8, "08:00"],
  [9, "09:00"],
  [10, "10:00"],
  [11, "11:00"],
  [null, "Off"],
];

/**
 * "Not-marked alert" (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 10): one phone alert to the owners and supervisors
 * listing who hasn't marked by the chosen hour. Saved at once; support sees it read-only.
 */
export function NotMarkedCard({ initial, canEdit }: { initial: number | null; canEdit: boolean }) {
  const [hour, setHour] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  async function pick(h: number | null) {
    if (h === hour) return;
    setBusy(true);
    setError(undefined);
    setSaved(undefined);
    const r = await api<SettingsView>("/api/settings/not-marked", { method: "PUT", body: { hour: h } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setHour(r.data.not_marked_hour);
    setSaved("Saved.");
  }

  return (
    <Card>
      <div className="space-y-3">
        <h2 className="text-lg font-bold">Not-marked alert</h2>
        <p className="text-sm text-slate-700">One phone alert to you and the supervisors, listing who hasn&apos;t marked by:</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Not-marked alert hour">
          {CHOICES.map(([h, text]) => (
            <button
              key={text}
              type="button"
              disabled={!canEdit || busy}
              aria-pressed={hour === h}
              onClick={() => pick(h)}
              className={`min-h-11 min-w-16 rounded-xl border px-3 font-semibold disabled:cursor-default ${hour === h ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-800"} ${!canEdit && hour !== h ? "opacity-50" : ""}`}
            >
              {text}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600">Counts every active Plant staff person with no mark today. Weekly offs and leave aren&apos;t built yet, so a day off shows here too.</p>
        {error && <ErrorText>{error}</ErrorText>}
        {saved && <p className="font-semibold text-emerald-700">{saved}</p>}
      </div>
    </Card>
  );
}

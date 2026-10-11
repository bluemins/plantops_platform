"use client";

import { useState } from "react";
import { Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const CHOICES = [
  ["17:00", "5 pm"],
  ["18:00", "6 pm"],
  ["19:00", "7 pm"],
  ["20:00", "8 pm"],
  ["21:00", "9 pm"],
  ["22:00", "10 pm"],
  ["23:00", "11 pm"],
  ["off", "Off"],
] as const;

/** When "Today's stock count is not done yet" goes out (owner chooses; others see it). */
export function ReminderSetting({ value, canChange }: { value: string; canChange: boolean }) {
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string>();
  const label = CHOICES.find(([v]) => v === current)?.[1] ?? current;

  async function change(next: string) {
    setError(undefined);
    const r = await api("/api/settings", { method: "PUT", body: { count_reminder: next } });
    if (!r.ok) return setError(r.error);
    setCurrent(next);
  }

  return (
    <Card>
      <label className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block font-semibold">Evening reminder</span>
          <span className="block text-sm text-slate-500">
            &quot;Today&apos;s stock count is not done yet&quot;, if nobody has counted by then.
          </span>
        </span>
        {canChange ? (
          <select value={current} onChange={(e) => change(e.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base">
            {CHOICES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-semibold">{label}</span>
        )}
      </label>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

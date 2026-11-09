"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { pointsSettingsView } from "@/server/drop/points";

type View = Awaited<ReturnType<typeof pointsSettingsView>>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const box = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** Owner: points settings, saved as a new row from a date (earlier days keep their settings). */
export function PointsSettingsForm({ view }: { view: View }) {
  const c = view.current;
  const [from, setFrom] = useState(view.today);
  const [start, setStart] = useState(c.start_date ?? "");
  const [rpp, setRpp] = useState(String(Number(c.rupees_per_point)));
  const [late, setLate] = useState(String(c.late_days));
  const [poll, setPoll] = useState(String(c.poll_points));
  const [months, setMonths] = useState<number[]>(c.redeem_months);
  const [rewards, setRewards] = useState(c.rewards.map((r) => ({ sku_id: r.sku_id, points: String(r.points) })));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const toggle = (m: number) => setMonths((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]));
  const unused = view.products.filter((p) => !rewards.some((r) => r.sku_id === p.id));

  async function save() {
    setBusy(true);
    setError(undefined);
    setDone(false);
    const body = {
      effective_from: from,
      start_date: start || null,
      rupees_per_point: rpp.trim(),
      late_days: Number(late),
      poll_points: Number(poll),
      redeem_months: months,
      rewards: rewards.map((r) => ({ sku_id: r.sku_id, points: Number(r.points) })),
    };
    const r = await api("/api/drop/points", { body }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    setDone(true);
    window.location.reload();
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-sm font-semibold">
        Points start on <span className="font-normal text-slate-500">(empty = points off; bills from this date earn)</span>
        <input type="date" className={`${box} mt-1`} value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm font-semibold">
          ₹ per point
          <input inputMode="decimal" className={`${box} mt-1`} value={rpp} onChange={(e) => setRpp(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Paid within (days)
          <input inputMode="numeric" className={`${box} mt-1`} value={late} onChange={(e) => setLate(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Poll points
          <input inputMode="numeric" className={`${box} mt-1`} value={poll} onChange={(e) => setPoll(e.target.value)} />
        </label>
      </div>
      <p className="text-sm text-slate-600">A payment made more than {late || "N"} days after the delivery earns no points.</p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Months shops can ask for free boxes</legend>
        <div className="flex flex-wrap gap-2">
          {MONTHS.map((m, i) => (
            <label key={m} className={`min-h-11 cursor-pointer rounded-full px-3 py-2.5 text-sm font-semibold ${months.includes(i + 1) ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-300 bg-white"}`}>
              <input type="checkbox" className="sr-only" checked={months.includes(i + 1)} onChange={() => toggle(i + 1)} />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Free boxes and their points</legend>
        {rewards.map((r, i) => (
          <div key={r.sku_id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 break-words">{view.products.find((p) => p.id === r.sku_id)?.name ?? "Product switched off"}</span>
            <input
              inputMode="numeric"
              aria-label="Points"
              className="min-h-12 w-28 rounded-xl border border-slate-300 bg-white px-3 text-right"
              value={r.points}
              onChange={(e) => setRewards((rs) => rs.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))}
            />
            <button type="button" className="min-h-12 rounded-xl px-3 text-sm text-red-700" onClick={() => setRewards((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        {unused.length > 0 && (
          <select className={box} value="" onChange={(e) => e.target.value && setRewards((rs) => [...rs, { sku_id: e.target.value, points: "800" }])}>
            <option value="">+ Add a free box…</option>
            {unused.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.brand ? ` (${p.brand})` : ""}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <label className="block text-sm font-semibold">
        These settings apply from
        <input type="date" className={`${box} mt-1`} min={view.today} value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <ErrorText>{error}</ErrorText>
      {done && <p className="text-sm text-green-800">Saved.</p>}
      <Button className="w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save points settings"}
      </Button>
    </section>
  );
}

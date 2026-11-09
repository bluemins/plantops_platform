"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtDayLong, fmtMonth } from "@/lib/days";
import { HOLIDAY_GROUP_MAX, HOLIDAY_NAME_MAX, parseHolidayPaste, type HolidayRow } from "@/lib/holidays";
import type { HolidayList } from "@/server/holidays";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "block space-y-1 text-sm font-semibold text-slate-800";
const btn = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold disabled:opacity-50";
const dayShort = (ymd: string) => fmtDayLong(ymd).replace(/,? \d{4}$/, "");

/**
 * The owner's Holidays box on a person's page (rule 24, owner 2026-11-09): the person's own holiday list for one year,
 * Paid holidays and festivals by choice group, "Take as choice leave" (one per group), Remove, and adding one holiday
 * or pasting the rows of a holiday sheet ("Start from" leaves earlier rows out). Months already marked paid can't
 * change (the server refuses). `editable` = false for PlantOps support (the list only).
 */
export function HolidaysBox({ personId, name, list, thisMonth, editable }: { personId: string; name: string; list: HolidayList; thisMonth: string; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [adding, setAdding] = useState<"one" | "paste" | null>(null);
  const [one, setOne] = useState({ day: "", name: "", paid: true, group: "" });
  const [paste, setPaste] = useState("");
  const [from, setFrom] = useState(thisMonth);
  const paid = new Set(list.paidMonths);
  const parsed = useMemo(() => (paste.trim() ? parseHolidayPaste(paste) : null), [paste]);
  const toSave: HolidayRow[] = parsed ? parsed.rows.filter((r) => r.day.slice(0, 7) >= from) : [];
  const left = parsed ? parsed.rows.length - toSave.length : 0;
  const paidHit = toSave.find((r) => paid.has(r.day.slice(0, 7)));

  async function send(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const r = await api<{ changed?: number | boolean }>(path, { body: { user_id: personId, ...body } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409) router.refresh();
      return false;
    }
    setDone(ok);
    router.refresh();
    return true;
  }

  async function addOne() {
    if (!one.day) return setError("Pick the date");
    if (!one.name.trim()) return setError("Write the holiday's name");
    if (await send("/api/holidays", { rows: [{ day: one.day, name: one.name, paid: one.paid, group: one.paid ? null : one.group.trim() || null }] }, "Holiday saved.")) {
      setOne({ day: "", name: "", paid: true, group: "" });
      setAdding(null);
    }
  }

  async function addPasted() {
    if (toSave.length === 0) return setError("No holidays to add from that month on");
    if (await send("/api/holidays", { rows: toSave }, `${toSave.length} ${toSave.length === 1 ? "holiday" : "holidays"} checked and saved.`)) {
      setPaste("");
      setAdding(null);
    }
  }

  // by group, in date order: Paid holidays and festivals without a group first
  const groups = new Map<string, typeof list.entries>();
  for (const e of list.entries) {
    const g = e.group ?? "";
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  const paidCount = list.entries.filter((e) => e.paid).length;

  return (
    <section aria-labelledby="hol-h" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hol-h" className="text-lg font-bold">
          Holidays · {list.year}
        </h2>
        <span className="text-sm text-slate-600">
          {paidCount} paid · {list.entries.length - paidCount} festivals
        </span>
      </div>
      <p className="text-sm text-slate-600">
        {name}&apos;s own list. A <b>Paid</b> holiday is paid without coming in; working on it pays 1 extra day. In each group, one festival can be marked as <b>choice leave</b>: paid if not worked. Choice leave shows on the salary only, not on the calendar.
      </p>

      {list.entries.length === 0 ? (
        <p className="text-sm text-slate-600">No holidays for {list.year} yet.</p>
      ) : (
        [...groups.entries()].map(([g, entries]) => {
          const chosen = entries.find((e) => e.choice);
          return (
            <div key={g || "none"} className="space-y-1">
              {g && (
                <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  Choice group {g} · {chosen ? `choice leave: ${chosen.name}` : "no choice leave yet"}
                </p>
              )}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
                {entries.map((e) => {
                  const locked = paid.has(e.day.slice(0, 7));
                  return (
                    <li key={e.day} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${e.paid ? "bg-sky-50" : e.choice ? "bg-emerald-50" : ""}`}>
                      <span className="w-24 shrink-0 text-slate-600">{dayShort(e.day)}</span>
                      <span className="min-w-0 flex-1 font-semibold break-words">
                        {e.paid ? "🎉 " : ""}
                        {e.name}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${e.paid ? "bg-sky-100 text-sky-900" : e.choice ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>
                        {e.paid ? "Paid" : e.choice ? "Choice leave" : "Festival"}
                      </span>
                      {editable && !locked && (
                        <span className="flex gap-1.5">
                          {!e.paid && e.group && (e.choice || !chosen) && (
                            <button type="button" disabled={busy} className={btn} onClick={() => send("/api/holidays/choice", { day: e.day, choice: !e.choice }, e.choice ? "Choice leave undone." : `${e.name} is the choice leave for ${e.group}.`)}>
                              {e.choice ? "Undo choice" : "Take as choice leave"}
                            </button>
                          )}
                          <button type="button" disabled={busy} aria-label={`Remove ${e.name}`} className={btn} onClick={() => confirm(`Remove ${e.name} (${dayShort(e.day)}) from ${name}'s holidays?`) && send("/api/holidays/remove", { day: e.day }, "Holiday removed.")}>
                            Remove
                          </button>
                        </span>
                      )}
                      {locked && <span className="text-xs text-slate-500">{fmtMonth(e.day.slice(0, 7))} paid</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}

      {editable && (
        <div className="space-y-3">
          {adding === null && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => (setAdding("paste"), setError(undefined), setDone(undefined))}>
                Paste from Excel
              </button>
              <button type="button" className={btn} onClick={() => (setAdding("one"), setError(undefined), setDone(undefined))}>
                + Add one holiday
              </button>
            </div>
          )}

          {adding === "one" && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  <span>Date</span>
                  <input type="date" className={field} value={one.day} onChange={(e) => setOne({ ...one, day: e.target.value })} />
                </label>
                <label className={label}>
                  <span>Name</span>
                  <input className={field} maxLength={HOLIDAY_NAME_MAX} value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} placeholder="Diwali" />
                </label>
              </div>
              <label className="flex min-h-11 items-center gap-2 font-semibold">
                <input type="checkbox" className="h-5 w-5" checked={one.paid} onChange={(e) => setOne({ ...one, paid: e.target.checked })} />
                Paid holiday
              </label>
              {!one.paid && (
                <label className={label}>
                  <span>Choice group (optional)</span>
                  <input className={field} list="hol-groups" maxLength={HOLIDAY_GROUP_MAX} value={one.group} onChange={(e) => setOne({ ...one, group: e.target.value })} placeholder="Oct–Dec 2026" />
                  <datalist id="hol-groups">
                    {list.groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </label>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={addOne} className="min-h-11 rounded-xl bg-(--brand) px-4 font-bold text-(--brand-contrast) disabled:opacity-50">
                  Save holiday
                </button>
                <button type="button" className={btn} onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {adding === "paste" && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-700">
                In Excel, select the rows (with or without the heading) and copy; paste them here. A row with &quot;Paid&quot; becomes a Paid holiday; the numbers in the Choice Leave column mark the choice groups.
              </p>
              <textarea className={`${field} min-h-32 py-2 font-mono text-sm`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Festival\t14-Jan-2026\tWednesday\tMakar Sankranti\t\t\t\nNational Holiday\t26-Jan-2026\tMonday\tRepublic Day\t\tPaid"} />
              <label className={label}>
                <span>Start from</span>
                <input type="month" className={field} value={from} onChange={(e) => setFrom(e.target.value || thisMonth)} />
              </label>
              {parsed && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    {toSave.length} to add{left ? ` · ${left} before ${fmtMonth(from)} left out` : ""}
                    {parsed.skipped.length ? ` · ${parsed.skipped.length} lines without a date skipped` : ""}
                  </p>
                  {toSave.length > 0 && (
                    <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm">
                      {toSave.map((r) => (
                        <li key={r.day} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                          <span className="w-24 shrink-0 text-slate-600">{dayShort(r.day)}</span>
                          <span className="min-w-0 flex-1 break-words">{r.name}</span>
                          <span className="text-xs font-bold text-slate-700">{r.paid ? "Paid" : r.group ? `Festival · ${r.group}` : "Festival"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {paidHit && <p className="text-sm text-amber-800">{fmtMonth(paidHit.day.slice(0, 7))} is already marked paid: move &quot;Start from&quot; past it.</p>}
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy || toSave.length === 0 || !!paidHit} onClick={addPasted} className="min-h-11 rounded-xl bg-(--brand) px-4 font-bold text-(--brand-contrast) disabled:opacity-50">
                  Add {toSave.length || ""} holidays
                </button>
                <button type="button" className={btn} onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {done && (
        <p role="status" className="text-sm font-semibold text-emerald-800">
          {done}
        </p>
      )}
    </section>
  );
}

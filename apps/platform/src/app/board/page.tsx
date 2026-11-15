"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

type BoardCard = {
  id: string;
  text: string;
  by: string;
  by_me: boolean;
  created_at: string;
  edited: boolean;
  edited_at: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  carried_from: string | null;
  removed: boolean;
  removed_by: string | null;
  removed_at: string | null;
  can_edit: boolean;
  can_remove: boolean;
  can_close: boolean;
};
type Day = { date: string; today: string; can_add: boolean; can_close: boolean; carried: BoardCard[]; cards: BoardCard[] };

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const longDate = (day: string) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const shortDate = (day: string) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const indiaHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

/**
 * Plant board (owner, 2026-11-14): a whiteboard every person of the plant sees and writes on, any role. Staff plan
 * the next day here. Opens on Today in the morning and on Tomorrow from noon (India time); `?date=` picks a day.
 */
export default function BoardPage() {
  const [date, setDate] = useState<string>();
  const [day, setDay] = useState<Day>();
  const [error, setError] = useState<string>();

  const load = useCallback((d?: string) => {
    api<Day>(`/api/board${d ? `?date=${d}` : ""}`).then((r) => {
      if (r.status === 401) return window.location.replace(`/login?next=${encodeURIComponent("/board")}`);
      if (r.status === 403) return window.location.replace(`/change-secret?next=${encodeURIComponent("/board")}`);
      if (!r.ok) return setError(r.error);
      setError(undefined);
      setDay(r.data);
      setDate(r.data.date);
    });
  }, []);

  // First load: today's date from the server, then pick the default day.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("date");
    if (asked) return load(asked);
    api<Day>("/api/board").then((r) => {
      if (r.status === 401) return window.location.replace(`/login?next=${encodeURIComponent("/board")}`);
      if (r.status === 403) return window.location.replace(`/change-secret?next=${encodeURIComponent("/board")}`);
      if (!r.ok) return setError(r.error);
      if (indiaHour() >= 12) load(addDays(r.data.today, 1));
      else {
        setDay(r.data);
        setDate(r.data.date);
      }
    });
  }, [load]);

  // Someone else may write meanwhile: refresh every 60 s while the page is open.
  useEffect(() => {
    if (!date) return;
    const t = setInterval(() => load(date), 60_000);
    return () => clearInterval(t);
  }, [date, load]);

  function pick(d: string) {
    window.history.replaceState(null, "", `/board?date=${d}`);
    load(d);
  }

  if (!day) return error ? <ErrorText>{error}</ErrorText> : null;
  const today = day.today;
  const tabs = [
    { d: addDays(today, -1), label: "Yesterday" },
    { d: today, label: "Today" },
    { d: addDays(today, 1), label: "Tomorrow" },
  ];
  const all = [...day.carried, ...day.cards].filter((c) => !c.removed);
  const left = all.filter((c) => !c.done).length;
  const past = day.date < today;

  return (
    <div className="space-y-4">
      <a href="/home?launcher=1" className="inline-flex min-h-11 items-center text-sm font-semibold text-(--brand)">
        ‹ PlantOps home
      </a>
      <div>
        <h1 className="text-2xl font-bold">📝 Plant board</h1>
        <p className="text-slate-500">
          Everyone in the plant can see and write here. Plan the next day. Open cards move on to Today until the owner or a
          supervisor closes them.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.d}
            type="button"
            onClick={() => pick(t.d)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
              t.d === day.date ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          type="date"
          aria-label="Another day"
          value={day.date}
          min={addDays(today, -7)}
          max={addDays(today, 7)}
          onChange={(e) => e.target.value && pick(e.target.value)}
          className="min-h-11 rounded-full border border-slate-300 bg-white px-3 text-sm"
        />
      </div>

      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-900">{longDate(day.date)}</span>
        {all.length > 0 && ` · ${all.length} card${all.length === 1 ? "" : "s"}, ${left} not done`}
      </p>

      <ErrorText>{error}</ErrorText>

      {day.can_add && <AddCard date={day.date} onSaved={() => load(day.date)} onError={setError} />}

      {day.carried.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">From earlier days ({day.carried.filter((c) => !c.done && !c.removed).length} still open)</h2>
          <ul className="space-y-3">
            {day.carried.map((c) => (
              <CardRow key={c.id} card={c} past={false} onChanged={() => load(day.date)} onError={setError} />
            ))}
          </ul>
        </section>
      )}

      {day.carried.length > 0 && day.cards.length > 0 && <h2 className="text-sm font-semibold text-slate-700">For today</h2>}
      {day.cards.length === 0 ? (
        day.carried.length === 0 && <Card className="text-center text-slate-500">Nothing on the board for this day yet.</Card>
      ) : (
        <ul className="space-y-3">
          {day.cards.map((c) => (
            <CardRow key={c.id} card={c} past={past} onChanged={() => load(day.date)} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCard({ date, onSaved, onError }: { date: string; onSaved: () => void; onError: (e?: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api("/api/board", { body: { date, text } });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    onError(undefined);
    setText("");
    onSaved();
  }
  return (
    <Card className="space-y-3 p-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder="e.g. Load 50 box BM 1L in Mini by 9 am"
        aria-label="New card"
        className="w-full rounded-xl border border-slate-300 p-3 text-base focus:border-(--brand) focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{text.length} / 300</span>
        <Button onClick={save} disabled={!text.trim() || busy}>
          {busy ? "Adding…" : "Add to board"}
        </Button>
      </div>
    </Card>
  );
}

function CardRow({ card, past, onChanged, onError }: { card: BoardCard; past: boolean; onChanged: () => void; onError: (e?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.text);
  const [busy, setBusy] = useState(false);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    const r = await api(path, { method, body: body ?? {} });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    onError(undefined);
    setEditing(false);
    onChanged();
  }

  return (
    <li>
      <Card className={`flex gap-3 p-4 ${card.removed ? "bg-slate-50 opacity-70" : card.done ? "bg-slate-50" : "border-l-4 border-l-amber-400"}`}>
        {card.removed ? (
          <span aria-label="Removed" className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 border-slate-300 bg-slate-100 text-lg text-slate-500">
            ✕
          </span>
        ) : card.can_close ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => send(`/api/board/${card.id}`, "PATCH", { done: !card.done })}
            aria-label={card.done ? "Reopen" : "Close (done)"}
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 text-lg font-bold ${
              card.done ? "border-green-700 bg-green-700 text-white" : "border-slate-300 bg-white text-transparent"
            }`}
          >
            ✓
          </button>
        ) : (
          <span
            aria-label={card.done ? "Closed" : "Open"}
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border-2 text-lg font-bold ${
              card.done ? "border-green-700 bg-green-700 text-white" : "border-dashed border-slate-300 bg-white text-transparent"
            }`}
          >
            ✓
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              rows={3}
              aria-label="Change card"
              className="w-full rounded-xl border border-slate-300 p-3 text-base focus:border-(--brand) focus:outline-none"
            />
          ) : (
            <p className={`whitespace-pre-wrap break-words text-base ${card.done || card.removed ? "text-slate-500 line-through" : "text-slate-900"}`}>{card.text}</p>
          )}
          {card.carried_from && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              ↪ From {shortDate(card.carried_from)}
            </span>
          )}
          <div className="space-y-0.5 text-xs text-slate-500">
            <p>
              Added by {card.by_me ? "you" : card.by} · {time(card.created_at)}
            </p>
            {card.edited_at && <p>Changed by {card.by_me ? "you" : card.by} · {time(card.edited_at)}</p>}
            {card.done && card.done_at && (
              <p className="font-semibold text-green-800">
                ✓ Closed by {card.done_by ?? "someone"} · {time(card.done_at)}
              </p>
            )}
            {card.removed && card.removed_at && (
              <p className="font-semibold text-red-800">
                ✕ Removed by {card.removed_by ?? "someone"} · {time(card.removed_at)}
              </p>
            )}
            {past && !card.done && !card.removed && <p className="font-semibold text-amber-800">Still open: also shown on Today</p>}
          </div>
          {(card.can_edit || card.can_remove) && (
            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              {editing ? (
                <>
                  <button type="button" disabled={busy || !text.trim()} onClick={() => send(`/api/board/${card.id}`, "PATCH", { text })} className="min-h-11 text-(--brand)">
                    Save
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setText(card.text); }} className="min-h-11 text-slate-600">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {card.can_edit && (
                    <button type="button" onClick={() => setEditing(true)} className="min-h-11 text-(--brand)">
                      Edit
                    </button>
                  )}
                  {card.can_remove && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirm("Remove this card from the board?") && send(`/api/board/${card.id}`, "DELETE")}
                      className="min-h-11 text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}

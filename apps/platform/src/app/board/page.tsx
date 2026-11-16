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
  priority: Priority;
  for_people: Person[];
  can_edit: boolean;
  can_remove: boolean;
  can_close: boolean;
  can_set_priority: boolean;
};
type Priority = "urgent" | "normal" | "low";
type Person = { id: string; name: string };
type Day = { date: string; today: string; can_add: boolean; can_close: boolean; carried: BoardCard[]; cards: BoardCard[]; people: Person[] };

const PRIORITY: { v: Priority; label: string; on: string }[] = [
  { v: "urgent", label: "Urgent", on: "border-red-700 bg-red-700 text-white" },
  { v: "normal", label: "Normal", on: "border-(--brand) bg-(--brand) text-(--brand-contrast)" },
  { v: "low", label: "Low", on: "border-slate-500 bg-slate-500 text-white" },
];
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, normal: 1, low: 2 };

function PriorityPicker({ value, onChange, disabled }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Priority" className="flex gap-2">
      {PRIORITY.map((p) => (
        <button
          key={p.v}
          type="button"
          role="radio"
          aria-checked={value === p.v}
          disabled={disabled}
          onClick={() => onChange(p.v)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${value === p.v ? p.on : "border-slate-300 bg-white text-slate-800"}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

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
  // One list, open cards first (Urgent, Normal, Low; carried ones from earlier days at the top of each), then closed,
  // then removed (owner, 2026-11-15 / 2026-11-16).
  const rank = (c: BoardCard) => (c.removed ? 2 : c.done ? 1 : 0);
  const list = [...day.carried, ...day.cards]
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        rank(a.c) - rank(b.c) || (rank(a.c) === 0 ? PRIORITY_RANK[a.c.priority] - PRIORITY_RANK[b.c.priority] : 0) || a.i - b.i,
    )
    .map(({ c }) => c);
  const all = list.filter((c) => !c.removed);
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

      {day.can_add && <AddCard date={day.date} people={day.people} onSaved={() => load(day.date)} onError={setError} />}

      {list.length === 0 ? (
        <Card className="text-center text-slate-500">Nothing on the board for this day yet.</Card>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <CardRow key={c.id} card={c} past={past && !c.carried_from} onChanged={() => load(day.date)} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCard({ date, people, onSaved, onError }: { date: string; people: Person[]; onSaved: () => void; onError: (e?: string) => void }) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [forSome, setForSome] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const canPick = people.length > 0; // owner or Supervisor only
  const missingPeople = forSome && picked.length === 0;
  async function save() {
    if (!text.trim() || busy || missingPeople) return;
    setBusy(true);
    const r = await api("/api/board", { body: { date, text, priority, people: forSome ? picked : [] } });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    onError(undefined);
    setText("");
    setPriority("normal");
    setForSome(false);
    setPicked([]);
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
      <PriorityPicker value={priority} onChange={setPriority} />
      {canPick && (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Who sees it" className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">For:</span>
            {[
              { v: false, label: "Everyone" },
              { v: true, label: "🔒 Pick people" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={forSome === o.v}
                onClick={() => setForSome(o.v)}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                  forSome === o.v ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-800"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {forSome && (
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs text-slate-500">Only these people, you and the owner will see this card. You can't change the people later.</p>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => {
                  const on = picked.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${
                        on ? "border-(--brand) bg-(--brand-soft) font-semibold" : "border-slate-300 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked((x) => (on ? x.filter((i) => i !== p.id) : [...x, p.id]))}
                        className="h-4 w-4"
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{missingPeople ? "Pick at least one person" : `${text.length} / 300`}</span>
        <Button onClick={save} disabled={!text.trim() || busy || missingPeople}>
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
  const [settingPriority, setSettingPriority] = useState(false);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    const r = await api(path, { method, body: body ?? {} });
    setBusy(false);
    if (!r.ok) return onError(r.error);
    onError(undefined);
    setEditing(false);
    setSettingPriority(false);
    onChanged();
  }

  return (
    <li>
      <Card
        className={`flex gap-3 p-4 ${
          card.removed
            ? "bg-slate-50 opacity-70"
            : card.done
              ? "bg-slate-50"
              : card.priority === "urgent"
                ? "border-l-4 border-l-red-600"
                : card.priority === "low"
                  ? "border-l-4 border-l-slate-300"
                  : "border-l-4 border-l-amber-400"
        }`}
      >
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
          {(card.priority !== "normal" || card.carried_from || card.for_people.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {card.priority === "urgent" && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Urgent</span>
              )}
              {card.priority === "low" && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Low</span>
              )}
              {card.carried_from && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  ↪ From {shortDate(card.carried_from)}
                </span>
              )}
              {card.for_people.length > 0 && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-900">
                  🔒 For {card.for_people.map((p) => p.name).join(", ")}
                </span>
              )}
            </div>
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
          {card.can_set_priority && settingPriority && (
            <PriorityPicker
              value={card.priority}
              disabled={busy}
              onChange={(p) => (p === card.priority ? setSettingPriority(false) : send(`/api/board/${card.id}`, "PATCH", { priority: p }))}
            />
          )}
          {(card.can_edit || card.can_remove || card.can_set_priority) && (
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
                  {card.can_set_priority && (
                    <button type="button" onClick={() => setSettingPriority((x) => !x)} className="min-h-11 text-(--brand)">
                      {settingPriority ? "Keep priority" : "Priority"}
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

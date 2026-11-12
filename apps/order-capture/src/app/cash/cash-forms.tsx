"use client";

// The cash book's forms (docs/CASHBOOK_PHASE_PLAN.md, step C1): start the cash book (owner), + Expense, + Staff cash,
// + Money in / out, Close the day, cancel an entry (owner), the owner's category / vehicle lists. The server checks
// everything again.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { differenceText, paise, signedMoney } from "@/lib/cash";
import { CollectionForm } from "./collect-forms";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const amountOk = (a: string) => AMOUNT.test(a.trim()) && Number(a) > 0;
const chip = (on: boolean) =>
  `min-h-12 rounded-xl border px-3 text-sm font-semibold ${on ? "border-2 border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`;

export interface Lists {
  categories: { id: string; name: string; active: boolean }[];
  vehicles: { id: string; name: string; active: boolean }[];
  people: { id: string; name: string; employee: boolean }[];
  names: string[];
  /** this plant's advances go to Attendance (C4) */
  link: boolean;
  /** advances against salary with something left, for "Took back" */
  advances: { id: string; ref: string; person: string; date: string; amount: string; left: string; attendance: { status: string; message: string | null } | null }[];
}

type SendStatus = { status: "waiting" | "sent" | "refused"; message: string | null };
/** After a save or a send: what Attendance did, in plain words. */
export const attendanceText = (a: SendStatus) =>
  a.status === "sent" ? "In Attendance ✓" : a.status === "refused" ? `Not in Attendance: ${a.message ?? "refused"}` : `Waiting for Attendance (${a.message ?? "will try again"})`;

/** Owner, Accounts: send a refused / waiting advance to Attendance again. */
export function SendAgain({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  async function send() {
    setBusy(true);
    setMsg(undefined);
    const r = await api<SendStatus>(`/api/cash/entries/${id}/send`, { body: {} });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    setMsg(attendanceText(r.data));
    router.refresh();
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={send} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-(--brand)">{busy ? "Sending…" : "Send again"}</button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </span>
  );
}

/** Owner, first time: the cash counted in the box today is the opening balance. */
export function StartCashBook({ today }: { today: string }) {
  const router = useRouter();
  const [f, setF] = useState({ date: today, counted: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(undefined);
    if (!AMOUNT.test(f.counted.trim())) return setError("Cash counted: rupees, e.g. 14435");
    setBusy(true);
    const r = await api("/api/cash/start", { body: { date: f.date, counted: f.counted.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">Start the cash book</p>
      <p className="text-sm text-slate-600">Count the cash in the box and type it. This is the opening balance; every day after is worked out from it. A starter list of expense types is added (you can change it on Settings).</p>
      <label className="block"><span className={label}>Day</span><input type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} className={field} /></label>
      <label className="block"><span className={label}>Cash in the box (₹)</span><input inputMode="decimal" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} className={field} placeholder="e.g. 14435" /></label>
      {error && <ErrorText>{error}</ErrorText>}
      <Button className="w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Start the cash book"}</Button>
    </div>
  );
}

type Mode = "expense" | "staff" | "money";
type MoneyKind = "owner_in" | "owner_out" | "bank_deposit" | "other_in" | "other_out";
const MONEY: [MoneyKind, string][] = [
  ["owner_in", "Owner added cash"],
  ["owner_out", "Owner took cash"],
  ["bank_deposit", "Deposited to bank"],
  ["other_in", "Other money in"],
  ["other_out", "Other money out"],
];

/** The entry buttons (+ Van report, + Collection, + Expense, + Staff cash, + Money in / out) and the form that opens under them. */
export function EntryButtons({ date, lists }: { date: string; lists: Lists }) {
  const [mode, setMode] = useState<Mode | "collection" | null>(null);
  const [done, setDone] = useState<string>();
  const btn = "min-h-14 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-(--brand)";
  return (
    <div className="space-y-3">
      {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
      <div className="grid grid-cols-2 gap-2">
        <a href={`/cash/van/new?d=${date}`} className={`${btn} col-span-2 flex items-center justify-center`}>+ Van report</a>
        <button type="button" className={btn} onClick={() => { setDone(undefined); setMode("collection"); }}>+ Collection</button>
        <button type="button" className={btn} onClick={() => { setDone(undefined); setMode("expense"); }}>+ Expense</button>
        <button type="button" className={btn} onClick={() => { setDone(undefined); setMode("staff"); }}>+ Staff cash</button>
        <button type="button" className={btn} onClick={() => { setDone(undefined); setMode("money"); }}>+ Money in / out</button>
      </div>
      {mode === "collection" && <CollectionForm date={date} onClose={() => setMode(null)} onDone={(t) => { setDone(t); setMode(null); }} />}
      {mode && mode !== "collection" && <EntryForm key={mode} mode={mode} date={date} lists={lists} onClose={() => setMode(null)} onDone={(t) => { setDone(t); setMode(null); }} />}
    </div>
  );
}

function EntryForm({ mode, date, lists, onClose, onDone }: { mode: Mode; date: string; lists: Lists; onClose: () => void; onDone: (text: string) => void }) {
  const router = useRouter();
  const cats = lists.categories.filter((c) => c.active);
  const vans = lists.vehicles.filter((v) => v.active);
  const [f, setF] = useState({
    amount: "",
    work_date: date,
    category_id: "",
    vehicle_id: "",
    person: "",
    staff_dir: "out" as "out" | "in",
    staff_purpose: "advance" as "advance" | "plant" | "salary",
    back_for: "advance" as "advance" | "plant",
    returns_entry_id: "",
    person_id: "",
    money_kind: "owner_in" as MoneyKind,
    paid_to: "",
    note: "",
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // an advance against salary with the Attendance link on: picked from the plant's employees, never typed
  const pickEmployee = mode === "staff" && lists.link && f.staff_dir === "out" && f.staff_purpose === "advance";
  const employees = lists.people.filter((p) => p.employee);
  const pickAdvance = mode === "staff" && f.staff_dir === "in" && f.back_for === "advance";
  const advance = lists.advances.find((a) => a.id === f.returns_entry_id);

  async function save() {
    setError(undefined);
    if (!amountOk(f.amount)) return setError("Amount: rupees, e.g. 500 or 1250.50");
    const body: Record<string, unknown> = { amount: f.amount.trim(), cash_date: date, note: f.note.trim() || undefined };
    if (f.work_date !== date) body.work_date = f.work_date;
    if (mode === "expense") {
      if (!f.category_id) return setError("Pick what the expense was for");
      Object.assign(body, { kind: "expense", category_id: f.category_id, vehicle_id: f.vehicle_id || undefined, paid_to: f.paid_to.trim() || undefined });
    } else if (mode === "staff") {
      if (pickEmployee) {
        if (!f.person_id) return setError("Pick the person from the list");
        Object.assign(body, { kind: "staff_out", staff_purpose: "advance", person_user_id: f.person_id });
      } else if (f.staff_dir === "in" && f.back_for === "advance") {
        if (!f.returns_entry_id) return setError("Pick which advance the cash was brought back for");
        Object.assign(body, { kind: "staff_in", staff_purpose: "advance", returns_entry_id: f.returns_entry_id });
      } else {
        const name = f.person.trim();
        if (!name) return setError("Who was the cash given to?");
        const known = lists.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
        Object.assign(body, {
          kind: f.staff_dir === "out" ? "staff_out" : "staff_in",
          ...(known ? { person_user_id: known.id } : { person_name: name }),
          staff_purpose: f.staff_dir === "out" ? f.staff_purpose : f.back_for,
        });
      }
    } else Object.assign(body, { kind: f.money_kind });
    setBusy(true);
    const r = await api<{ ref: string; amount: string; attendance?: SendStatus | null }>("/api/cash/entries", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(`${r.data.ref} saved: ${signedMoney(paise(r.data.amount))}.${r.data.attendance ? ` ${attendanceText(r.data.attendance)}` : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">{mode === "expense" ? "Expense" : mode === "staff" ? "Staff cash" : "Money in / out"}</p>

      {mode === "expense" && (
        <>
          <div>
            <span className={label}>What for</span>
            <div className="grid grid-cols-2 gap-2">
              {cats.map((c) => (
                <button key={c.id} type="button" className={chip(f.category_id === c.id)} onClick={() => setF({ ...f, category_id: c.id })}>{c.name}</button>
              ))}
            </div>
            {cats.length === 0 && <p className="text-sm text-slate-500">No expense types yet. The owner adds them on Settings.</p>}
          </div>
          {vans.length > 0 && (
            <div>
              <span className={label}>Vehicle (optional)</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip(f.vehicle_id === "")} onClick={() => setF({ ...f, vehicle_id: "" })}>None</button>
                {vans.map((v) => (
                  <button key={v.id} type="button" className={chip(f.vehicle_id === v.id)} onClick={() => setF({ ...f, vehicle_id: v.id })}>{v.name}</button>
                ))}
              </div>
            </div>
          )}
          <label className="block"><span className={label}>Paid to (optional)</span><input value={f.paid_to} onChange={set("paid_to")} maxLength={100} className={field} placeholder="e.g. Sai Ram battery" /></label>
        </>
      )}

      {mode === "staff" && (
        <>
          {pickEmployee ? (
            <label className="block">
              <span className={label}>Person (Plant staff)</span>
              <select value={f.person_id} onChange={set("person_id")} className={field}>
                <option value="">Pick the person</option>
                {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {employees.length === 0 && <span className="mt-1 block text-xs text-amber-800">No employees found. An advance against salary is only for people with the Plant staff role (Manage users).</span>}
            </label>
          ) : pickAdvance ? (
            <label className="block">
              <span className={label}>Which advance</span>
              <select value={f.returns_entry_id} onChange={set("returns_entry_id")} className={field}>
                <option value="">Pick the advance</option>
                {lists.advances.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.person} · ₹{a.left} left of ₹{a.amount}</option>)}
              </select>
              {lists.advances.length === 0 && <span className="mt-1 block text-xs text-slate-500">No advances with anything left.</span>}
              {advance?.attendance && advance.attendance.status !== "sent" && <span className="mt-1 block text-xs text-amber-800">{advance.ref} isn&apos;t in Attendance yet. Send it first.</span>}
            </label>
          ) : (
          <label className="block">
            <span className={label}>Person</span>
            <input value={f.person} onChange={set("person")} list="cash-people" maxLength={100} className={field} placeholder="Type or pick a name" />
            <datalist id="cash-people">
              {[...new Set([...lists.people.map((p) => p.name), ...lists.names])].map((n) => <option key={n} value={n} />)}
            </datalist>
          </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={chip(f.staff_dir === "out")} onClick={() => setF({ ...f, staff_dir: "out" })}>Gave cash</button>
            <button type="button" className={chip(f.staff_dir === "in")} onClick={() => setF({ ...f, staff_dir: "in" })}>Took back</button>
          </div>
          {f.staff_dir === "out" && (
            <fieldset className="space-y-2">
              <legend className={label}>What for</legend>
              {([
                ["advance", "Advance against salary", lists.link ? "Goes to Attendance automatically and is recovered from salary." : "Recovered from salary (enter it in Attendance too: the link isn't set up for this plant)."],
                ["plant", "For plant spending", "e.g. \"mess lagi 5000\". Stays with that person until settled."],
                ["salary", "Salary paid in cash", "Only in the cash book; mark paid in Attendance as usual."],
              ] as const).map(([k, t, d]) => (
                <label key={k} className={`flex gap-3 rounded-xl border p-3 ${f.staff_purpose === k ? "border-2 border-(--brand) bg-(--brand-soft)" : "border-slate-300"}`}>
                  <input type="radio" name="purpose" checked={f.staff_purpose === k} onChange={() => setF({ ...f, staff_purpose: k })} className="mt-1 h-5 w-5" />
                  <span><span className="block font-semibold">{t}</span><span className="text-sm text-slate-600">{d}</span></span>
                </label>
              ))}
            </fieldset>
          )}
          {f.staff_dir === "in" && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={chip(f.back_for === "advance")} onClick={() => setF({ ...f, back_for: "advance" })}>For an advance</button>
              <button type="button" className={chip(f.back_for === "plant")} onClick={() => setF({ ...f, back_for: "plant" })}>Plant spending</button>
            </div>
          )}
          {f.staff_dir === "in" && f.back_for === "advance" && lists.link && <p className="text-xs text-slate-500">Lowers that advance in Attendance. Refused once that month&apos;s salary is paid.</p>}
          <p className="text-xs text-slate-500">Nobody can enter cash given to themselves.</p>
        </>
      )}

      {mode === "money" && (
        <div className="grid grid-cols-1 gap-2">
          {MONEY.map(([k, t]) => (
            <button key={k} type="button" className={chip(f.money_kind === k)} onClick={() => setF({ ...f, money_kind: k })}>{t}</button>
          ))}
        </div>
      )}

      <label className="block"><span className={label}>Amount (₹)</span><input inputMode="decimal" value={f.amount} onChange={set("amount")} className={`${field} text-lg font-semibold`} placeholder="e.g. 2000" /></label>
      <label className="block">
        <span className={label}>Work day (when it was for; usually today)</span>
        <input type="date" value={f.work_date} max={date} onChange={set("work_date")} className={field} />
      </label>
      <label className="block"><span className={label}>Note (optional)</span><input value={f.note} onChange={set("note")} maxLength={300} className={field} /></label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

/** Close the day (count the box), or (owner) correct the last close as a new version with a reason. */
export function CloseDay({ date, expected, fixing }: { date: string; expected: string; fixing: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ counted: "", reason: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const diff = AMOUNT.test(f.counted.trim()) ? paise(f.counted.trim()) - paise(expected) : null;
  const needsReason = fixing || (diff !== null && diff !== 0n);

  async function save() {
    setError(undefined);
    if (!AMOUNT.test(f.counted.trim())) return setError("Cash counted: rupees, e.g. 26825");
    if (needsReason && f.reason.trim().length < 3) return setError(fixing ? "Correcting a close needs a reason" : "The count doesn't match: please give a reason");
    setBusy(true);
    const r = await api("/api/cash/close", { body: { date, counted: f.counted.trim(), reason: f.reason.trim() || undefined } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return fixing ? (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>Correct this close</Button>
    ) : (
      <Button className="w-full" onClick={() => setOpen(true)}>Close the day: count the cash</Button>
    );
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">{fixing ? "Correct the close" : "Close the day"}</p>
      {!fixing && <p className="text-sm text-slate-600">Expected cash in hand: <b>{signedMoney(paise(expected))}</b></p>}
      <label className="block">
        <span className={label}>Count the cash in the box and type it (₹)</span>
        <input inputMode="decimal" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} className={`${field} text-2xl font-bold`} autoFocus />
      </label>
      {diff !== null && !fixing && (
        <p className={`rounded-xl px-3 py-3 text-center font-semibold ${diff === 0n ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{diff === 0n ? "Matches ✓" : differenceText(diff)}</p>
      )}
      {needsReason && (
        <label className="block"><span className={label}>Reason</span><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} className={field} placeholder={fixing ? "e.g. counted again, ₹500 note missed" : "e.g. tea ₹80 not entered"} /></label>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : fixing ? "Save correction" : "Close the day"}</Button>
      </div>
    </div>
  );
}

/** Owner: cancel an entry with a reason. */
export function CancelEntry({ id, refText, closed }: { id: string; refText: string; closed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(undefined);
    if (reason.trim().length < 3) return setError("Please give a reason");
    setBusy(true);
    const r = await api(`/api/cash/entries/${id}/cancel`, { body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open) return <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => setOpen(true)}>Cancel {refText}</button>;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      {closed && <p className="text-xs text-red-900">This day is already closed: its count stays, and the day will show the difference.</p>}
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={field} placeholder="Why cancel? e.g. entered twice" />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Keep it</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : `Cancel ${refText}`}</Button>
      </div>
    </div>
  );
}

/** Owner, Settings: add / rename / switch off expense types or vehicles. */
export function ListEditor({ list, items, title }: { list: "category" | "vehicle"; items: { id: string; name: string; active: boolean }[]; title: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function add() {
    setError(undefined);
    if (!name.trim()) return;
    setBusy(true);
    const r = await api("/api/cash/lists", { body: { list, name: name.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setName("");
    router.refresh();
  }
  async function toggle(id: string, active: boolean) {
    setError(undefined);
    const r = await api(`/api/cash/lists/${id}`, { method: "PATCH", body: { list, active } });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  async function rename(id: string, old: string) {
    const n = window.prompt("New name", old)?.trim();
    if (!n || n === old) return;
    const r = await api(`/api/cash/lists/${id}`, { method: "PATCH", body: { list, name: n } });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-semibold">{title}</p>
      <ul className="divide-y divide-slate-100">
        {items.length === 0 && <li className="py-2 text-sm text-slate-500">None yet.</li>}
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-2">
            <span className={i.active ? "" : "text-slate-400 line-through"}>{i.name}</span>
            <span className="flex gap-3 text-sm font-semibold">
              <button type="button" className="text-(--brand)" onClick={() => rename(i.id, i.name)}>Rename</button>
              <button type="button" className={i.active ? "text-red-700" : "text-green-700"} onClick={() => toggle(i.id, !i.active)}>{i.active ? "Switch off" : "Switch on"}</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={list === "vehicle" ? 40 : 60} className={field} placeholder={list === "vehicle" ? "e.g. Mini" : "e.g. Electricity"} />
        <Button onClick={add} disabled={busy}>Add</Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

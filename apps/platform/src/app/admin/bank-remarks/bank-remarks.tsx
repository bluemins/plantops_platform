"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { WorkBook, WorkSheet } from "xlsx";
import { Button, ErrorText } from "@plantops/ui";
import {
  emptyMemory,
  findTable,
  learn,
  parseMemory,
  readLines,
  suggest,
  type Columns,
  type Line,
  type Memory,
  type Rule,
  type Source,
} from "@/lib/bank-remarks";

const CHIP: Record<Source, [string, string]> = {
  learned: ["Remembered", "bg-green-100 text-green-900"],
  rule: ["Your rule", "bg-green-100 text-green-900"],
  file: ["Already in file", "bg-slate-100 text-slate-700"],
  bank: ["Name from bank", "bg-blue-100 text-blue-900"],
  guess: ["Guess, check", "bg-amber-100 text-amber-900"],
  check: ["To check", "bg-orange-100 text-orange-900"],
  edited: ["Edited by you", "bg-slate-100 text-slate-700"],
};

const rupees = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // randomUUID needs https
const needsLook = (l: Line) => l.source === "guess" || !l.remark.trim();

interface Book {
  name: string;
  wb: WorkBook;
  ws: WorkSheet;
  origin: { r: number; c: number };
  header: number;
  cols: Columns;
  newRemarks: boolean;
  newParty: boolean;
}

async function openBook(file: File): Promise<{ book: Book; lines: Line[] } | string> {
  const XLSX = await import("xlsx");
  let wb: WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { cellNF: true });
  } catch {
    return "This file could not be read. Open the statement exactly as downloaded from the bank (.xls, .xlsx or .csv).";
  }
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: true });
    const table = findTable(rows);
    if (!table) continue;
    const start = XLSX.utils.decode_range(ws["!ref"] ?? "A1").s;
    const lines = readLines(rows, table.header, table.cols);
    if (!lines.length) continue;
    return { book: { name: file.name, wb, ws, origin: start, ...table }, lines };
  }
  return "No statement table found: the file needs a header row with Date, Description, Debit and Credit.";
}

export function BankRemarks({ plantKey }: { plantKey: string }) {
  const storageKey = `plantops.bankRemarks.${plantKey}`;
  const [memory, setMemory] = useState<Memory>(emptyMemory);
  const [view, setView] = useState<"open" | "review" | "rules">("open");
  const [book, setBook] = useState<Book>();
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = parseMemory(localStorage.getItem(storageKey) ?? "");
      if (saved) setMemory(saved);
    } catch {
      // private window or blocked storage: works, just remembers nothing
    }
  }, [storageKey]);

  function save(next: Memory) {
    setMemory(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setNotice("This browser didn't let the page remember the remarks. Use Back up to a file.");
    }
  }

  function refill(next: Memory) {
    setLines((ls) => ls.map((l) => suggest(l.source === "file" || l.source === "edited" ? l : { ...l, source: "check" }, next)));
  }

  async function open(file: File, teach: boolean) {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    const got = await openBook(file);
    setBusy(false);
    if (typeof got === "string") return setError(got);
    if (teach) {
      const filled = got.lines.filter((l) => l.remark || l.party);
      if (!filled.length) return setError("This file has no remarks yet. For teaching, open a month you already wrote remarks on.");
      const next = learn(memory, filled, newId);
      save(next);
      setNotice(`Learned from ${filled.length} lines of ${file.name}. ${next.rules.length} remarks remembered.`);
      return;
    }
    setBook(got.book);
    setLines(got.lines.map((l) => suggest(l, memory)));
    setView("review");
  }

  function addRule(rule: Omit<Rule, "id" | "by" | "uses">) {
    const next = { ...memory, rules: [...memory.rules, { ...rule, id: newId(), by: "you" as const, uses: 0 }] };
    save(next);
    refill(next);
  }

  function deleteRule(id: string) {
    const next = { ...memory, rules: memory.rules.filter((r) => r.id !== id) };
    save(next);
    refill(next);
  }

  function restore(next: Memory) {
    save(next);
    refill(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Bank remarks</h1>
        <div className="flex items-center gap-4">
          {view !== "rules" && (
            <button type="button" onClick={() => setView("rules")} className="font-medium text-(--brand)">
              Remembered ({memory.rules.length})
            </button>
          )}
          {view === "open" ? (
            <Link href="/home" className="font-medium text-(--brand)">Back</Link>
          ) : (
            <button type="button" onClick={() => setView(book ? (view === "rules" ? "review" : "open") : "open")} className="font-medium text-(--brand)">
              Back
            </button>
          )}
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      {notice && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {view === "open" && <OpenView memory={memory} busy={busy} onOpen={open} />}
      {view === "review" && book && (
        <ReviewView
          book={book}
          lines={lines}
          memory={memory}
          onChange={setLines}
          onDownload={async (remember) => {
            await download(book, lines);
            const next = remember ? learn(memory, lines, newId) : memory;
            save({ ...next, lastDone: { name: book.name, lines: lines.length, at: new Date().toISOString() } });
            setNotice(`Downloaded. ${remember ? "Your remarks are remembered for next month." : ""}`);
          }}
        />
      )}
      {view === "rules" && <RulesView memory={memory} onAdd={addRule} onDelete={deleteRule} onRestore={restore} setError={setError} />}
    </div>
  );
}

function OpenView({ memory, busy, onOpen }: { memory: Memory; busy: boolean; onOpen: (f: File, teach: boolean) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        Open the statement Excel you downloaded from the bank. Remarks and Party are filled in for you; you check the rest.
        The file is read on this computer only, never sent to PlantOps.
      </p>
      <label
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onOpen(f, false);
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed bg-white px-4 py-10 text-center ${over ? "border-(--brand)" : "border-slate-300"}`}
      >
        <span className="text-lg font-semibold">{busy ? "Reading…" : "Drop the bank Excel here, or tap to choose"}</span>
        <span className="text-sm text-slate-500">.xls, .xlsx or .csv, exactly as downloaded</span>
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onOpen(f, false);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="min-w-60 flex-1">
          <p className="font-semibold">Teach it from an old month</p>
          <p className="text-sm text-slate-600">Open a statement you already wrote remarks on. It learns which line gets which remark and party.</p>
        </div>
        <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-800 hover:bg-slate-50">
          Teach from old file
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onOpen(f, true);
            }}
          />
        </label>
      </div>
      {memory.lastDone && (
        <p className="text-sm text-slate-500">
          Last done: <strong>{memory.lastDone.name}</strong> · {memory.lastDone.lines} lines ·{" "}
          {new Date(memory.lastDone.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </p>
      )}
    </div>
  );
}

type Filter = "all" | "look" | "in" | "out";

function ReviewView({
  book,
  lines,
  memory,
  onChange,
  onDownload,
}: {
  book: Book;
  lines: Line[];
  memory: Memory;
  onChange: (ls: Line[]) => void;
  onDownload: (remember: boolean) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [remember, setRemember] = useState(true);
  const [warn, setWarn] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const count = (s: Source[]) => lines.filter((l) => s.includes(l.source)).length;
  const empty = lines.filter((l) => !l.remark.trim()).length;
  const remarks = useMemo(() => uniq([...memory.rules.map((r) => r.remark), ...lines.map((l) => l.remark)]), [memory, lines]);
  const parties = useMemo(() => uniq([...memory.rules.map((r) => r.party), ...lines.map((l) => l.party)]), [memory, lines]);

  const q = search.trim().toLowerCase();
  const shown = lines.filter(
    (l) =>
      (filter === "all" || (filter === "look" ? needsLook(l) : l.dir === filter)) &&
      (!q || `${l.desc} ${l.remark} ${l.party}`.toLowerCase().includes(q)),
  );

  function edit(row: number, field: "remark" | "party", value: string) {
    onChange(lines.map((l) => (l.row === row ? { ...l, [field]: value, source: "edited" } : l)));
  }

  async function go() {
    if (empty && !warn) {
      setWarn(true);
      top.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setWarn(false);
    await onDownload(remember);
  }

  const tabs: [Filter, string, number][] = [
    ["all", "All", lines.length],
    ["look", "Needs a look", lines.filter(needsLook).length],
    ["in", "Money in", lines.filter((l) => l.dir === "in").length],
    ["out", "Money out", lines.filter((l) => l.dir === "out").length],
  ];

  return (
    <div className="space-y-4" ref={top}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{book.name}</strong> · {lines.length} lines
        </p>
        <Button onClick={go}>Download Excel</Button>
      </div>

      {warn && (
        <div className="space-y-2 rounded-2xl border border-orange-300 bg-white p-4">
          <p className="font-semibold text-orange-800">{empty} line{empty === 1 ? " has" : "s have"} no remark</p>
          <p className="text-sm text-slate-600">They will be blank in the Excel. Download now and fill them later, or go back.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => (setWarn(false), setFilter("look"))}>Show them</Button>
            <Button onClick={go}>Download anyway</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Remembered" n={count(["learned", "rule", "file"])} className="text-green-800" />
        <Stat label="Name from bank" n={count(["bank"])} className="text-blue-800" />
        <Stat label="Guess, check" n={count(["guess"])} className="text-amber-800" />
        <Stat label="No remark yet" n={empty} className="text-orange-800" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([f, label, n]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-10 rounded-full border px-3.5 text-sm ${filter === f ? "border-(--brand) bg-(--brand) font-semibold text-(--brand-contrast)" : "border-slate-300 bg-white"}`}
          >
            {label} {n}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search description or remark"
          aria-label="Search"
          className="min-h-10 min-w-48 flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm"
        />
      </div>

      <datalist id="bank-remarks-list">{remarks.map((r) => <option key={r} value={r} />)}</datalist>
      <datalist id="bank-party-list">{parties.map((p) => <option key={p} value={p} />)}</datalist>

      <ul className="space-y-2">
        {shown.map((l) => {
          const [chip, chipClass] = CHIP[l.source];
          const look = needsLook(l);
          return (
            <li key={l.row} className={`space-y-2 rounded-xl border p-3 ${look ? "border-orange-200 bg-orange-50/50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{l.date}</span>
                <span className={`font-semibold ${l.dir === "in" ? "text-green-800" : "text-red-800"}`}>
                  {l.dir === "in" ? "+" : "−"} ₹{rupees(l.dir === "in" ? l.credit : l.debit)}
                </span>
              </div>
              <p className="text-xs break-all text-slate-500">{l.desc}</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                <input
                  value={l.remark}
                  onChange={(e) => edit(l.row, "remark", e.target.value)}
                  list="bank-remarks-list"
                  placeholder="Remarks"
                  aria-label="Remarks"
                  className={`min-h-11 rounded-lg border bg-white px-3 ${!l.remark.trim() ? "border-orange-400" : l.source === "guess" ? "border-amber-500" : "border-slate-300"}`}
                />
                <input
                  value={l.party}
                  onChange={(e) => edit(l.row, "party", e.target.value)}
                  list="bank-party-list"
                  placeholder="Party"
                  aria-label="Party"
                  className="min-h-11 rounded-lg border border-slate-300 bg-white px-3"
                />
                <span className={`justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${chipClass}`}>{chip}</span>
              </div>
            </li>
          );
        })}
        {!shown.length && <li className="rounded-xl border border-slate-200 bg-white p-4 text-slate-500">Nothing here.</li>}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-5" />
          Remember my remarks for next month
        </label>
        <Button onClick={go}>Download Excel</Button>
      </div>
    </div>
  );
}

function Stat({ label, n, className }: { label: string; n: number; className: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-600">{label}</p>
      <p className={`text-2xl font-bold ${className}`}>{n}</p>
    </div>
  );
}

function RulesView({
  memory,
  onAdd,
  onDelete,
  onRestore,
  setError,
}: {
  memory: Memory;
  onAdd: (r: Omit<Rule, "id" | "by" | "uses">) => void;
  onDelete: (id: string) => void;
  onRestore: (m: Memory) => void;
  setError: (e?: string) => void;
}) {
  const [match, setMatch] = useState("");
  const [dir, setDir] = useState<Rule["dir"]>("any");
  const [remark, setRemark] = useState("");
  const [party, setParty] = useState("");
  const rules = [...memory.rules].sort((a, b) => Number(b.by === "you") - Number(a.by === "you") || b.uses - a.uses);

  function backup() {
    const blob = new Blob([JSON.stringify(memory, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bank-remarks-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        When a bank line has the words on the left, it gets this remark and party. Money in by NEFT / UPI needs no rule: the
        payer&apos;s name comes from the bank. Kept in this browser only; back it up to use on another computer.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={backup}>Back up to a file</Button>
        <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-800 hover:bg-slate-50">
          Restore from backup
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const m = parseMemory(await f.text());
              if (!m) return setError("That is not a Bank remarks backup file.");
              if (window.confirm(`Replace the ${memory.rules.length} remembered remarks with the ${m.rules.length} in the backup?`)) {
                setError(undefined);
                onRestore(m);
              }
            }}
          />
        </label>
      </div>

      <form
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!match.trim() || (!remark.trim() && !party.trim())) return setError("Type the words to look for and a remark or party.");
          setError(undefined);
          onAdd({ match: match.trim().toUpperCase(), dir, remark: remark.trim(), party: party.trim() });
          setMatch("");
          setRemark("");
          setParty("");
        }}
      >
        <p className="font-semibold">Add a rule yourself</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="When the line has (e.g. HP PETROL)" aria-label="When the line has" className="min-h-11 rounded-lg border border-slate-300 px-3" />
          <select value={dir} onChange={(e) => setDir(e.target.value as Rule["dir"])} aria-label="Money in or out" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3">
            <option value="any">Money in or out</option>
            <option value="in">Money in only</option>
            <option value="out">Money out only</option>
          </select>
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remarks" aria-label="Remarks" className="min-h-11 rounded-lg border border-slate-300 px-3" />
          <input value={party} onChange={(e) => setParty(e.target.value)} placeholder="Party" aria-label="Party" className="min-h-11 rounded-lg border border-slate-300 px-3" />
        </div>
        <Button type="submit">Add rule</Button>
      </form>

      {rules.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-slate-500">Nothing remembered yet. Teach it from an old month, or download a month with remarks.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-0.5">
                <p className="font-mono text-xs break-all text-slate-600">{r.match}</p>
                <p className="font-medium">
                  {r.remark || <span className="text-slate-400">no remark</span>}
                  {r.party && <span className="text-slate-600"> · {r.party}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {r.dir === "in" ? "Money in" : r.dir === "out" ? "Money out" : "In or out"} · {r.by === "you" ? "your rule" : "learned"} · used {r.uses}×
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                className="min-h-10 shrink-0 rounded-lg border border-slate-200 px-3 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function uniq(xs: string[]) {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The bank's own sheet with only the Remarks and Party columns written; everything else stays as the bank gave it. */
async function download(book: Book, lines: Line[]) {
  const XLSX = await import("xlsx");
  const { ws, origin, header, cols } = book;
  const at = (r: number, c: number) => XLSX.utils.encode_cell({ r: r + origin.r, c: c + origin.c });
  const put = (r: number, c: number, v: string) => {
    if (v) ws[at(r, c)] = { t: "s", v };
    else delete ws[at(r, c)];
  };
  if (book.newRemarks) put(header, cols.remarks, "Remarks");
  if (book.newParty) put(header, cols.party, "Party");
  for (const l of lines) {
    put(l.row, cols.remarks, l.remark.trim());
    put(l.row, cols.party, l.party.trim());
  }
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  range.e.c = Math.max(range.e.c, Math.max(cols.remarks, cols.party) + origin.c);
  ws["!ref"] = XLSX.utils.encode_range(range);
  const widths = ws["!cols"] ?? [];
  for (const c of [cols.remarks, cols.party]) widths[c + origin.c] ??= { wch: 24 };
  ws["!cols"] = widths;
  XLSX.writeFile(book.wb, `${book.name.replace(/\.[^.]+$/, "")}-remarks.xlsx`, { bookType: "xlsx" });
}

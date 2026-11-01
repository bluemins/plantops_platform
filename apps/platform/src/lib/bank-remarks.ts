// Bank remarks (/admin/bank-remarks, owner only): the rules that fill a bank statement's Remarks and Party columns.
// Pure functions, used by the page in the browser; the statement itself never leaves the browser.

export type Dir = "in" | "out";
export type Source = "file" | "rule" | "learned" | "bank" | "guess" | "check" | "edited";

/** One remembered remark: a line whose cleaned description contains `match` gets this remark and party. */
export interface Rule {
  id: string;
  match: string;
  dir: Dir | "any";
  remark: string;
  party: string;
  by: "you" | "learned";
  uses: number;
}

export interface Memory {
  v: 1;
  rules: Rule[];
  lastDone?: { name: string; lines: number; at: string };
}

export const emptyMemory = (): Memory => ({ v: 1, rules: [] });

export interface Columns {
  date: number;
  desc: number;
  debit: number;
  credit: number;
  remarks: number;
  party: number;
}

export interface Line {
  row: number; // index into the sheet's rows
  date: string;
  desc: string;
  debit: number;
  credit: number;
  dir: Dir;
  remark: string;
  party: string;
  source: Source;
  ruleId?: string;
}

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

export function amount(s: unknown): number {
  const n = Number(clean(s).replace(/,/g, "").replace(/(cr|dr)$/i, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s.])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** Upper case, words only, without reference numbers (5+ digits), so the same payee matches month after month. */
export function signature(desc: string) {
  return clean(desc)
    .toUpperCase()
    .replace(/[^A-Z0-9@.]+/g, " ")
    .split(" ")
    .filter((t) => t && (t.match(/\d/g)?.length ?? 0) < 5 && !t.includes("@"))
    .join(" ");
}

const NOT_NAMES = new Set(["UPI", "CR", "DR", "P2A", "P2M", "P2P", "IMPS", "NEFT", "RTGS", "TRANSFER", "BY", "TO", "PAYMENT", "PAY"]);
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const looksLikeName = (s: string) =>
  /^[A-Z][A-Z .&']{2,}$/.test(s) && !NOT_NAMES.has(s) && !/^[A-Z]{4}$/.test(s) && !IFSC.test(s);

/** The other person's name in an NEFT / RTGS / UPI / IMPS line, or "" when the bank didn't give one. */
export function payerName(desc: string): string {
  const d = clean(desc).toUpperCase();
  const neft = d.match(/(?:NEFT|RTGS)\*(.*)$/);
  if (neft) {
    const parts = neft[1]!.split("*").map((p) => p.replace(/-+$/, "").trim());
    for (let i = parts.length - 1; i >= 0; i--) if (looksLikeName(parts[i]!)) return parts[i]!;
    return "";
  }
  const upi = d.match(/(?:UPI|IMPS)\/(.*)$/);
  if (upi) {
    const parts = upi[1]!.split("/").map((p) => p.replace(/-+$/, "").trim());
    const ref = parts.findIndex((p) => /^\d{6,}$/.test(p));
    for (const p of ref >= 0 ? parts.slice(ref + 1) : parts) if (looksLikeName(p)) return p;
  }
  return "";
}

const has = (header: string[], ...words: string[]) => header.findIndex((h) => words.some((w) => h.includes(w)));

/** Finds the bank's table: the header row (Txn Date … Description … Debit / Credit) and its columns. */
export function findTable(rows: unknown[][]): { header: number; cols: Columns; newRemarks: boolean; newParty: boolean } | null {
  for (let r = 0; r < Math.min(rows.length, 80); r++) {
    const header = (rows[r] ?? []).map((c) => clean(c).toLowerCase());
    const date = has(header, "txn date", "transaction date", "date");
    const desc = has(header, "description", "narration", "particulars", "details");
    const debit = has(header, "debit", "withdrawal");
    const credit = has(header, "credit", "deposit");
    if (date < 0 || desc < 0 || debit < 0 || credit < 0) continue;
    let remarks = has(header, "remark");
    const newRemarks = remarks < 0;
    const last = header.reduce((m, h, i) => (h ? i : m), 0);
    if (newRemarks) remarks = last + 1;
    let party = has(header, "party");
    const newParty = party < 0;
    if (newParty) party = remarks + 1;
    return { header: r, cols: { date, desc, debit, credit, remarks, party }, newRemarks, newParty };
  }
  return null;
}

/** The statement's money lines (a description and a debit or credit), with what the file already has in Remarks / Party. */
export function readLines(rows: unknown[][], header: number, cols: Columns): Line[] {
  const lines: Line[] = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const desc = clean(row[cols.desc]);
    const debit = amount(row[cols.debit]);
    const credit = amount(row[cols.credit]);
    if (!desc || (!debit && !credit)) continue;
    const remark = clean(row[cols.remarks]);
    const party = clean(row[cols.party]);
    lines.push({
      row: r,
      date: clean(row[cols.date]),
      desc,
      debit,
      credit,
      dir: debit ? "out" : "in",
      remark,
      party,
      source: remark || party ? "file" : "check",
    });
  }
  return lines;
}

const words = (s: string) => new Set(s.split(" ").filter(Boolean));
function similarity(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both || 1);
}

/** Fills one line: your rules, then remembered lines, then the name the bank gave, then a close guess; else "check". */
export function suggest(line: Line, memory: Memory): Line {
  if (line.source === "file" || line.source === "edited") return line;
  const sig = signature(line.desc);
  const fits = (r: Rule) => (r.dir === "any" || r.dir === line.dir) && r.match && sig.includes(signature(r.match));
  const hit = memory.rules
    .filter(fits)
    .sort((a, b) => Number(b.by === "you") - Number(a.by === "you") || b.match.length - a.match.length)[0];
  if (hit) return { ...line, remark: hit.remark, party: hit.party, source: hit.by === "you" ? "rule" : "learned", ruleId: hit.id };

  const name = payerName(line.desc);
  if (name) {
    const pretty = titleCase(name);
    // money in: the payer is the remark (as the owner writes it); money out: the payee is the party, the remark is yours
    return line.dir === "in"
      ? { ...line, remark: pretty, party: "", source: "bank" }
      : { ...line, remark: "", party: pretty, source: "check" };
  }

  let best: Rule | undefined;
  let score = 0.6;
  for (const r of memory.rules) {
    if (r.by !== "learned" || (r.dir !== "any" && r.dir !== line.dir)) continue;
    const s = similarity(sig, signature(r.match));
    if (s >= score) [best, score] = [r, s];
  }
  if (best) return { ...line, remark: best.remark, party: best.party, source: "guess", ruleId: best.id };
  return { ...line, remark: "", party: "", source: "check" };
}

/** What a line is remembered by: the bank's name for the other person, else its cleaned description. */
export function lineKey(line: Pick<Line, "desc">) {
  return payerName(line.desc) || signature(line.desc);
}

/**
 * Remembers the remark and party of each line that has one. A line that only repeats the bank's name (money in, no party)
 * needs no rule; a line your own rule filled unchanged just counts a use.
 */
export function learn(memory: Memory, lines: Line[], newId: () => string): Memory {
  const rules = memory.rules.map((r) => ({ ...r }));
  for (const line of lines) {
    const remark = clean(line.remark);
    const party = clean(line.party);
    if (!remark && !party) continue;
    const used = line.ruleId ? rules.find((r) => r.id === line.ruleId) : undefined;
    if (used && used.remark === remark && used.party === party && line.source !== "guess") {
      used.uses++;
      continue;
    }
    const name = payerName(line.desc);
    if (name && line.dir === "in" && remark === titleCase(name) && !party) continue;
    const match = lineKey(line);
    if (!match) continue;
    const same = rules.find((r) => r.by === "learned" && r.match === match && r.dir === line.dir);
    if (same) Object.assign(same, { remark, party, uses: same.uses + 1 });
    else rules.push({ id: newId(), match, dir: line.dir, remark, party, by: "learned", uses: 1 });
  }
  return { ...memory, rules };
}

/** A backup file read back: kept only if it has the right shape. */
export function parseMemory(text: string): Memory | null {
  try {
    const m = JSON.parse(text) as Memory;
    if (m?.v !== 1 || !Array.isArray(m.rules)) return null;
    const ok = m.rules.every(
      (r) =>
        typeof r.id === "string" &&
        typeof r.match === "string" &&
        ["in", "out", "any"].includes(r.dir) &&
        typeof r.remark === "string" &&
        typeof r.party === "string" &&
        ["you", "learned"].includes(r.by) &&
        typeof r.uses === "number",
    );
    return ok ? { v: 1, rules: m.rules, lastDone: m.lastDone } : null;
  } catch {
    return null;
  }
}

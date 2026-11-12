// 20 L customers → Sales (cash book step C2, docs/CASHBOOK_PHASE_PLAN.md section 6a). Pure functions: the browser reads
// the owner's 20 L pending report (another app's "Remaining Payment" Excel) into rows with `readJarSheet`, the server
// works out the plan against the customers the plant already has with `jarPlan`, then saves it in one transaction.
//
// Rules (owner, 2026-11-11, "as recommended"):
// - each row = a 20 L customer with what they owe ("Total Due") as an opening-balance bill OB20-<ref>.
// - a row whose mobile is already a Sales customer: by default the due is added to that customer; the owner may type
//   another mobile instead.
// - a row without a real mobile (empty, or not an Indian mobile like the other app's 1730445774 placeholders): left out
//   by default (it stays in the other app); the owner may type a mobile.
// - a reference already imported is never imported again, so the same file twice adds nothing.
// - the file's own Total row must equal the rows added up, and imported + left out = that total.
import { normalisePhone } from "@plantops/module-kit/phone";
import { paise, rupees } from "./ledger";

export interface JarRow {
  /** the other app's Ref. No. as written ("3324", "#000123811/ Nov-2024") */
  ref: string;
  name: string;
  /** the mobile as written in the file ("" when none) */
  mobile_typed: string;
  group: string;
  pref: string;
  /** what they owe, rupees ("360.00") */
  due: string;
}

export interface JarSheet {
  rows: JarRow[];
  /** the file's Total row (Total Due column), rupees; null when the file has none */
  file_total: string | null;
}

const NEED = ["Ref. No.", "Customer Name", "Mobile No.", "Total Due"];
const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Rupees from a cell: 360, "360", "1,250.50". Throws on anything else (the file must be the report, unchanged). A
 * negative due (paid ahead) is refused for opening balances; a month update reads it (and flags it). */
function money(v: unknown, where: string, negative = false): string {
  const s = norm(v).replace(/,/g, "");
  if (s === "" || s === "-") return "0.00";
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(s)) throw new Error(`${where}: "${norm(v)}" is not an amount`);
  if (s.startsWith("-") && !negative) throw new Error(`${where}: a negative due (${s}) can't be an opening balance`);
  return rupees(paise(s));
}

/** "5   Bijepur Area" → "Bijepur Area"; "Default Group" stays. */
export const groupName = (g: string) => norm(g).replace(/^\d+\s+/, "");

/**
 * The sheet as rows of cells (SheetJS `sheet_to_json(ws, { header: 1, raw: true })`) → the 20 L rows. The header row is
 * found by its column names; the "Total" row is read as the file's total, not as a customer.
 */
export function readJarSheet(aoa: unknown[][], opts: { negative?: boolean } = {}): JarSheet {
  const neg = opts.negative ?? false;
  const h = aoa.findIndex((r) => NEED.every((n) => r.some((c) => norm(c).startsWith(n))));
  if (h < 0) throw new Error(`This isn't the 20 L pending report: it needs the columns ${NEED.join(", ")}.`);
  const head = aoa[h]!.map(norm);
  const col = (name: string) => head.findIndex((c) => c.startsWith(name));
  const at = { ref: col("Ref. No."), name: col("Customer Name"), mobile: col("Mobile No."), group: col("Group"), pref: col("Payment Preference"), due: col("Total Due") };
  const rows: JarRow[] = [];
  let fileTotal: string | null = null;
  const seen = new Set<string>();
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i]!;
    const cell = (k: number) => (k < 0 ? "" : norm(r[k]));
    const ref = cell(at.ref);
    const name = cell(at.name);
    if (!ref && !name) {
      // the Total row: empty ref and name, "Total" in one of the cells
      if (r.some((c) => norm(c).toLowerCase() === "total")) fileTotal = money(r[at.due], `Row ${i + 1} (Total)`, neg);
      continue;
    }
    if (!ref) throw new Error(`Row ${i + 1} (${name}) has no Ref. No.`);
    if (!name) throw new Error(`Row ${i + 1} (Ref. No. ${ref}) has no customer name`);
    if (ref.length > 60 || name.length > 200) throw new Error(`Row ${i + 1}: Ref. No. or name is too long`);
    if (seen.has(ref)) throw new Error(`Ref. No. ${ref} is in the file twice`);
    seen.add(ref);
    rows.push({ ref, name, mobile_typed: cell(at.mobile), group: groupName(cell(at.group)).slice(0, 60), pref: cell(at.pref) === "-" ? "" : cell(at.pref).slice(0, 30), due: money(r[at.due], `Row ${i + 1} (${name})`, neg) });
  }
  if (!rows.length) throw new Error("No customers found under the header row.");
  return { rows, file_total: fileTotal };
}

/** "OB20-3324"; an old invoice ref "#000123811/ Nov-2024" → "OB20-000123811". */
export function openingNumber(ref: string): string {
  const head = ref.split("/")[0]!.replace(/[^0-9A-Za-z-]/g, "");
  return `OB20-${head || ref.replace(/[^0-9A-Za-z]/g, "")}`.slice(0, 40);
}

/** The place most of the file's names end with ("Biku Meher Bijepur" → "Bijepur"): the default place for new customers. */
export function commonPlace(rows: JarRow[]): string {
  const n = new Map<string, number>();
  for (const r of rows) {
    const w = r.name.split(" ");
    if (w.length > 1) n.set(w.at(-1)!, (n.get(w.at(-1)!) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** What the owner chose for a row (by ref). No choice = the default: add to the existing customer / leave out. */
export type JarChoice = { action: "add" } | { action: "mobile"; mobile: string } | { action: "skip" };

export interface PlanCustomer {
  id: string;
  name: string;
  phone: string;
}

export interface PlanRow extends JarRow {
  /** the mobile found in the file, if it is a real Indian mobile */
  phone: string | null;
  /** new = a new customer; existing = the file's mobile is a Sales customer; no_mobile; already = imported before */
  kind: "new" | "existing" | "no_mobile" | "already";
  /** what will happen */
  result: "create" | "add" | "skip" | "already";
  /** the mobile the row is saved under (file's or typed) */
  use_phone: string | null;
  /** the customer the due goes to (add), or the one that has this phone */
  customer: PlanCustomer | null;
  number: string;
  error: string | null;
}

export interface JarPlan {
  rows: PlanRow[];
  counts: { rows: number; create: number; add: number; skip: number; already: number; errors: number; opening_bills: number };
  totals: { file: string | null; rows: string; imported: string; left_out: string; already: string };
  /** the file's Total row differs from its rows added up */
  total_mismatch: boolean;
}

/**
 * The plan for these rows: `customerOf(phone)` = the Sales customer with this phone (main or Drop extra), `imported` =
 * refs already imported. Pure: the server passes what it read inside the import's transaction.
 */
export function jarPlan(sheet: JarSheet, customerOf: (phone: string) => PlanCustomer | null, imported: Set<string>, choices: Record<string, JarChoice> = {}): JarPlan {
  const rows: PlanRow[] = sheet.rows.map((r) => {
    const phone = r.mobile_typed ? normalisePhone(r.mobile_typed) : null;
    const found = phone ? customerOf(phone) : null;
    const kind: PlanRow["kind"] = imported.has(r.ref) ? "already" : !phone ? "no_mobile" : found ? "existing" : "new";
    const base: PlanRow = { ...r, phone, kind, result: "skip", use_phone: phone, customer: found, number: openingNumber(r.ref), error: null };
    if (kind === "already") return { ...base, result: "already" };
    const choice = choices[r.ref] ?? (kind === "no_mobile" ? { action: "skip" } : { action: "add" });
    if (choice.action === "skip") return { ...base, result: "skip" };
    if (choice.action === "mobile") {
      const typed = normalisePhone(choice.mobile);
      if (!typed) return { ...base, result: "skip", use_phone: null, customer: null, error: `"${choice.mobile}" is not a 10-digit Indian mobile` };
      const other = customerOf(typed);
      return { ...base, use_phone: typed, customer: other, result: other ? "add" : "create" };
    }
    // "add": the file's own mobile
    if (!phone) return { ...base, error: "Type a mobile, or leave this customer out" };
    return { ...base, result: found ? "add" : "create" };
  });
  const sum = (f: (r: PlanRow) => boolean) => rupees(rows.filter(f).reduce((s, r) => s + paise(r.due), 0n));
  const totalRows = sum(() => true);
  const live = (r: PlanRow) => r.result === "create" || r.result === "add";
  return {
    rows,
    counts: {
      rows: rows.length,
      // two rows typed with the same new mobile make one customer
      create: new Set(rows.filter((r) => r.result === "create").map((r) => r.use_phone)).size,
      add: rows.filter((r) => r.result === "add").length,
      skip: rows.filter((r) => r.result === "skip").length,
      already: rows.filter((r) => r.result === "already").length,
      errors: rows.filter((r) => r.error).length,
      opening_bills: rows.filter((r) => live(r) && paise(r.due) > 0n).length,
    },
    totals: { file: sheet.file_total, rows: totalRows, imported: sum(live), left_out: sum((r) => r.result === "skip"), already: sum((r) => r.result === "already") },
    total_mismatch: sheet.file_total !== null && sheet.file_total !== totalRows,
  };
}

// ---------- month update (cash book step C5, docs/CASHBOOK_PHASE_PLAN.md section 9; owner 2026-11-12) ----------
// Each month the owner uploads the same report again. The other app also records the payments collected in PlantOps,
// so its Remaining is the true balance. Per 20 L customer already imported (by Ref. No.):
//   sheet higher than PlantOps' 20 L due → a month bill for the difference; the same → nothing; lower → flagged;
//   negative → flagged; a customer who also buys boxes or shares the Sales customer with another 20 L ref → left for the
//   owner (owner: "always leave them for me"), who may type that month's amount (then it is billed).
// Refs in the file not imported yet are listed: "Import list" (same file) adds them as new 20 L customers.

/** "J20-3324-2026-11"; a second number for the same ref and month (after an undo) gets "-2", "-3"... */
export function monthNumber(ref: string, month: string, n = 1): string {
  const head = ref.split("/")[0]!.replace(/[^0-9A-Za-z-]/g, "") || ref.replace(/[^0-9A-Za-z]/g, "");
  const tail = `-${month}${n > 1 ? `-${n}` : ""}`;
  return `J20-${head.slice(0, 40 - 4 - tail.length)}${tail}`;
}

/** The last day of a month ("2026-11" → "2026-11-30"). */
export function monthEnd(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export interface KnownJar {
  jar_customer_id: string;
  customer_id: string;
  customer_name: string;
  /** unpaid on this ref's 20 L bills (OB20 + earlier month bills), paise */
  due: bigint;
  /** why the owner decides this one: also buys boxes / the Sales customer holds another 20 L ref too */
  mixed: "boxes" | "shared" | null;
}

/** The owner's choice for one row: leave it as it is, or (a mixed one) bill this amount. */
export type MonthChoice = { action: "leave" } | { action: "bill"; amount: string };

export interface MonthRow {
  ref: string;
  name: string;
  /** the sheet's Remaining (may be negative) */
  sheet: string;
  jar_customer_id: string;
  customer_id: string;
  customer_name: string;
  /** PlantOps' 20 L due before this month */
  plantops: string;
  action: "billed" | "matches" | "flagged" | "left";
  reason: "lower" | "negative" | "mixed" | "typed" | null;
  mixed: KnownJar["mixed"];
  /** the month bill (rupees) when billed */
  bill: string | null;
  /** what the rule gives (sheet − PlantOps), shown for flagged / left rows */
  difference: string;
  error: string | null;
}

export interface MonthPlan {
  rows: MonthRow[];
  /** refs in the file not imported yet (Import list adds them) */
  new_refs: { ref: string; name: string; due: string }[];
  /** 20 L customers imported before but not in this file (nothing changes for them) */
  missing: { ref: string; name: string }[];
  counts: { billed: number; matches: number; flagged: number; left: number; new_refs: number; missing: number; errors: number };
  totals: { file: string | null; rows: string; billed: string };
  total_mismatch: boolean;
}

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

export function jarMonthPlan(sheet: JarSheet, known: Map<string, KnownJar>, allRefs: Map<string, string>, choices: Record<string, MonthChoice> = {}): MonthPlan {
  const rows: MonthRow[] = [];
  const fresh: MonthPlan["new_refs"] = [];
  for (const r of sheet.rows) {
    const k = known.get(r.ref);
    if (!k) {
      fresh.push({ ref: r.ref, name: r.name, due: r.due });
      continue;
    }
    const S = paise(r.due);
    const diff = S - k.due;
    const base = { ref: r.ref, name: r.name, sheet: r.due, jar_customer_id: k.jar_customer_id, customer_id: k.customer_id, customer_name: k.customer_name, plantops: rupees(k.due), mixed: k.mixed, difference: rupees(diff), bill: null, error: null };
    const c = choices[r.ref];
    if (k.mixed) {
      if (c?.action === "bill") {
        const ok = AMOUNT.test(c.amount.trim()) && paise(c.amount.trim()) > 0n;
        rows.push(ok ? { ...base, action: "billed", reason: "typed", bill: rupees(paise(c.amount.trim())) } : { ...base, action: "left", reason: "mixed", error: `"${c.amount}" is not an amount in rupees` });
      } else rows.push({ ...base, action: "left", reason: "mixed" });
      continue;
    }
    if (S < 0n) rows.push({ ...base, action: "flagged", reason: "negative" });
    else if (diff < 0n) rows.push({ ...base, action: "flagged", reason: "lower" });
    else if (diff === 0n) rows.push({ ...base, action: "matches", reason: null });
    else if (c?.action === "leave") rows.push({ ...base, action: "left", reason: null });
    else rows.push({ ...base, action: "billed", reason: null, bill: rupees(diff) });
  }
  const inFile = new Set(sheet.rows.map((r) => r.ref));
  const missing = [...allRefs.entries()].filter(([ref]) => !inFile.has(ref)).map(([ref, name]) => ({ ref, name }));
  const n = (a: MonthRow["action"]) => rows.filter((r) => r.action === a).length;
  const totalRows = rupees(sheet.rows.reduce((s, r) => s + paise(r.due), 0n));
  return {
    rows,
    new_refs: fresh,
    missing,
    counts: { billed: n("billed"), matches: n("matches"), flagged: n("flagged"), left: n("left"), new_refs: fresh.length, missing: missing.length, errors: rows.filter((r) => r.error).length },
    totals: { file: sheet.file_total, rows: totalRows, billed: rupees(rows.reduce((s, r) => s + (r.bill ? paise(r.bill) : 0n), 0n)) },
    total_mismatch: sheet.file_total !== null && sheet.file_total !== totalRows,
  };
}

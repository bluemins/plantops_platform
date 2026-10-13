// The customer-upload preview: every row of the owner's file sorted into New / Unchanged / Update / Rejected,
// exactly as docs/ORDER_CAPTURE_PHASE_PLAN.md "Duplicates" says. Pure (no database), so every case is tested here;
// the server runs it for the preview and again, inside the saving transaction, on confirm.
//   * the phone number after normalising is the customer's identity (+91 96929 05402 = 096929 05402 = 9692905402)
//   * "same" name / place = equal after trimming and joining spaces; letter case counts (a capital fixed = Update)
//   * possible duplicates (same name and place, another number) ignore case and are only a warning
import { csv } from "@plantops/module-kit/csv";
import { normalisePhone } from "@plantops/module-kit/phone";

export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const PLACE_MIN = 2;
export const PLACE_MAX = 200;
export const PHONE_TYPED_MAX = 30;
export const UPLOAD_MAX_ROWS = 5000;

/** One data row of the file, from the three columns the owner chose. `line` = its line in the file (header = 1). */
export interface UploadRow {
  line: number;
  name: string;
  phone: string;
  place: string;
}

/** A customer already in the plant's list. */
export interface ExistingCustomer {
  id: string;
  name: string;
  phone: string;
  place: string;
  active: boolean;
}

export interface NewCustomer {
  line: number;
  name: string;
  phone: string;
  phoneTyped: string;
  place: string;
  /** "Maa Tarini Store, Bargarh has 91234 56780 in your list" - added anyway; the owner decides */
  possibleDuplicate?: string;
}
export interface UpdateCustomer {
  line: number;
  id: string;
  phone: string;
  from: { name: string; place: string; active: boolean };
  to: { name: string; place: string };
}
export interface Rejected {
  lines: number[];
  phone: string;
  reason: string;
}

export interface UploadPlan {
  added: NewCustomer[];
  unchanged: { line: number; name: string; phone: string }[];
  updated: UpdateCustomer[];
  rejected: Rejected[];
  /** identical rows for one phone: counted once, the rest ignored */
  repeated: { lines: number[]; phone: string }[];
}

/** Trim and join runs of spaces: what "same" compares. */
export const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (name: string, place: string) => `${clean(name).toLowerCase()}|${clean(place).toLowerCase()}`;
const fmt = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;
const linesText = (lines: number[]) => (lines.length === 2 ? `lines ${lines[0]} and ${lines[1]}` : `lines ${lines.join(", ")}`);

/** Why a single row can't be saved, or null. All reasons, joined. */
export function rowProblem(row: UploadRow): string | null {
  const problems: string[] = [];
  const phone = row.phone.trim();
  if (!phone) problems.push("Phone is empty");
  else if (/^\d+(\.\d+)?e\+?\d+$/i.test(phone.replace(/\s/g, ""))) problems.push("Excel changed this number. Format the phone column as Text and save again");
  else if (phone.length > PHONE_TYPED_MAX || !normalisePhone(phone)) problems.push("Not a 10-digit mobile number");
  const name = clean(row.name);
  if (!name) problems.push("Name is missing");
  else if (name.length < NAME_MIN) problems.push("Name is too short");
  else if (name.length > NAME_MAX) problems.push(`Name is longer than ${NAME_MAX} characters`);
  const place = clean(row.place);
  if (!place) problems.push("Place is missing");
  else if (place.length < PLACE_MIN) problems.push("Place is too short");
  else if (place.length > PLACE_MAX) problems.push(`Place is longer than ${PLACE_MAX} characters`);
  return problems.length ? problems.join("; ") : null;
}

export function classifyUpload(rows: UploadRow[], existing: ExistingCustomer[]): UploadPlan {
  const plan: UploadPlan = { added: [], unchanged: [], updated: [], rejected: [], repeated: [] };

  // 1. rows that can't be saved on their own; completely empty rows are skipped quietly
  const byPhone = new Map<string, UploadRow[]>();
  for (const row of rows) {
    if (!clean(row.name) && !row.phone.trim() && !clean(row.place)) continue;
    const problem = rowProblem(row);
    if (problem) {
      plan.rejected.push({ lines: [row.line], phone: row.phone.trim(), reason: problem });
      continue;
    }
    const phone = normalisePhone(row.phone)!;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), row]);
  }

  // 2. one phone, several rows: identical -> once; different -> none of them
  const chosen: { phone: string; row: UploadRow }[] = [];
  for (const [phone, group] of byPhone) {
    const variants = [...new Set(group.map((r) => `${clean(r.name)}, ${clean(r.place)}`))];
    if (variants.length > 1) {
      plan.rejected.push({ lines: group.map((r) => r.line), phone, reason: `Same phone on ${linesText(group.map((r) => r.line))} with different details (${variants.join(" / ")})` });
      continue;
    }
    if (group.length > 1) plan.repeated.push({ lines: group.map((r) => r.line), phone });
    chosen.push({ phone, row: group[0]! });
  }

  // 3. against the plant's list
  const known = new Map(existing.map((c) => [c.phone, c]));
  const sameNamePlace = new Map<string, string>(); // name|place (any case) -> a phone that has it
  for (const c of existing) if (!sameNamePlace.has(key(c.name, c.place))) sameNamePlace.set(key(c.name, c.place), c.phone);
  const fileNamePlace = new Map<string, { phone: string; line: number }>();
  for (const { phone, row } of chosen) {
    const k = key(row.name, row.place);
    if (!known.has(phone) && !fileNamePlace.has(k)) fileNamePlace.set(k, { phone, line: row.line });
  }

  for (const { phone, row } of chosen) {
    const name = clean(row.name);
    const place = clean(row.place);
    const have = known.get(phone);
    if (have) {
      if (have.name === name && have.place === place && have.active) plan.unchanged.push({ line: row.line, name, phone });
      else plan.updated.push({ line: row.line, id: have.id, phone, from: { name: have.name, place: have.place, active: have.active }, to: { name, place } });
      continue;
    }
    const added: NewCustomer = { line: row.line, name, phone, phoneTyped: row.phone.trim(), place };
    const k = key(name, place);
    const other = sameNamePlace.get(k);
    const inFile = fileNamePlace.get(k);
    if (other) added.possibleDuplicate = `${name}, ${place} already has ${fmt(other)} in your list`;
    else if (inFile && inFile.phone !== phone) added.possibleDuplicate = `${name}, ${place} is also on line ${inFile.line} with ${fmt(inFile.phone)}`;
    plan.added.push(added);
  }

  plan.rejected.sort((a, b) => a.lines[0]! - b.lines[0]!);
  return plan;
}

/** The numbers on the preview screen. "Rejected" counts rows (a clash of two rows is two). */
export const planCounts = (p: UploadPlan) => ({
  added: p.added.length,
  unchanged: p.unchanged.length,
  updated: p.updated.length,
  rejected: p.rejected.reduce((n, r) => n + r.lines.length, 0),
  repeated: p.repeated.reduce((n, r) => n + r.lines.length - 1, 0),
});

/**
 * The rows the owner's file had on the rejected lines, as they were, plus a "Reason" column: fix them and upload
 * again. `table` = the whole file (header first, so line N is table[N - 1]). Made in the browser; formulas neutralised.
 */
export function rejectedCsv(table: string[][], rejected: Rejected[]) {
  const reasons = new Map<number, string>();
  for (const r of rejected) for (const line of r.lines) reasons.set(line, r.reason);
  const rows = [...reasons.keys()].sort((a, b) => a - b).map((line) => [...(table[line - 1] ?? []), reasons.get(line)]);
  return csv([[...(table[0] ?? []), "Reason"], ...rows]);
}

// Rule 24 (owner, 2026-11-09): a person's own holiday list. Pure helpers shared by the server and the Holidays box:
// reading rows pasted from a spreadsheet (the owner's holiday sheet) and naming a choice group by its months.
import { validDay } from "./days";

export const HOLIDAY_NAME_MAX = 60;
export const HOLIDAY_GROUP_MAX = 30;
/** At most this many holidays in one paste (a year's list is about 30). */
export const MAX_HOLIDAYS_PER_SAVE = 60;

export interface HolidayRow {
  /** "YYYY-MM-DD" */
  day: string;
  name: string;
  paid: boolean;
  /** the choice group ("Oct–Dec 2026"); always null for a Paid holiday */
  group: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const s = `${y < 100 ? 2000 + y : y}-${pad(m)}-${pad(d)}`;
  return validDay(s) ? s : null;
};

/**
 * A date as a spreadsheet shows it: "14-Jan-2026", "14 Jan 2026", "14-Jan-26", "2026-01-14", or day first "14/01/2026",
 * "14-01-2026", "14.01.2026" (India). null when the text is not a date.
 */
export function readDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,9})[-\s/.,]+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    return month < 0 ? null : ymd(Number(m[3]), month + 1, Number(m[1]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "Oct–Dec 2026" (or "Aug 2026" for one month; "Dec 2026–Jan 2027" across years): a group named by its months. */
export function groupLabel(days: readonly string[]): string {
  const sorted = [...days].sort();
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const name = (d: string) => MONTH_NAMES[Number(d.slice(5, 7)) - 1]!;
  if (first.slice(0, 7) === last.slice(0, 7)) return `${name(first)} ${first.slice(0, 4)}`;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${name(first)}–${name(last)} ${first.slice(0, 4)}`;
  return `${name(first)} ${first.slice(0, 4)}–${name(last)} ${last.slice(0, 4)}`;
}

export interface PasteResult {
  rows: HolidayRow[];
  /** lines that have text but no date (a header line is skipped silently) */
  skipped: string[];
  /** true when the paste marked choice groups (a number in the last column) */
  grouped: boolean;
}

/**
 * Rows copied from the owner's holiday sheet (columns Type | Date | Day | Name | | Paid Leave | Choice Leave) or any
 * sheet with a date and a name per line. Per line: the first cell that is a date; the name = the first cell after it
 * that is not a weekday, "Paid" or a number (else the longest other text); Paid = any cell saying "Paid".
 * Choice groups: a whole number in the LAST cell marks a group. Spreadsheets copy a merged cell's number on the
 * group's first row, so when the first line has a number every number starts a group; otherwise (numbers typed on the
 * last row of each group) every number ends one. Lines after the last group (or a paste without numbers) get no group.
 * Each group is named by its months ("Oct–Dec 2026"); Paid holidays never get a group.
 */
export function parseHolidayPaste(text: string): PasteResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const read: { day: string; name: string; paid: boolean; marker: boolean }[] = [];
  const skipped: string[] = [];
  for (const [i, line] of lines.entries()) {
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/,|\s{2,}/)).map((c) => c.trim());
    const at = cells.findIndex((c) => readDate(c) !== null);
    if (at < 0) {
      if (i > 0 || read.length > 0) skipped.push(line.trim());
      continue;
    }
    const isOther = (c: string) => c === "" || WEEKDAYS.test(c) || /^paid$/i.test(c) || /^\d+$/.test(c) || readDate(c) !== null;
    const after = cells.slice(at + 1).find((c) => !isOther(c));
    const longest = cells.filter((c) => !isOther(c)).sort((a, b) => b.length - a.length)[0];
    const name = (after ?? longest ?? "").replace(/\s+/g, " ").slice(0, HOLIDAY_NAME_MAX).trim();
    if (!name) {
      skipped.push(line.trim());
      continue;
    }
    const lastCell = [...cells].reverse().find((c) => c !== "") ?? "";
    read.push({ day: readDate(cells[at]!)!, name, paid: cells.some((c) => /^paid$/i.test(c)), marker: cells.length > at + 1 && /^\d+$/.test(lastCell) && cells.indexOf(lastCell) > at });
  }
  const grouped = read.some((r) => r.marker);
  const groupOf: number[] = [];
  if (grouped) {
    const starts = read[0]!.marker;
    let g = 0;
    for (const [i, r] of read.entries()) {
      if (starts) {
        if (r.marker && i > 0) g += 1;
        groupOf.push(g);
      } else {
        groupOf.push(g);
        if (r.marker) g += 1;
      }
    }
    // numbers that END groups: lines after the last number have no group
    if (!starts) for (let i = read.length - 1; i >= 0 && !read[i]!.marker; i--) groupOf[i] = -1;
  }
  const labels = new Map<number, string>();
  for (const g of new Set(groupOf)) if (g >= 0) labels.set(g, groupLabel(read.filter((_, i) => groupOf[i] === g).map((r) => r.day)));
  const rows = read.map((r, i) => ({ day: r.day, name: r.name, paid: r.paid, group: !grouped || r.paid || groupOf[i]! < 0 ? null : labels.get(groupOf[i]!)! }));
  return { rows, skipped, grouped };
}

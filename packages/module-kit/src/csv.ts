// CSV files for owners' exports: open correctly in Excel and can never run as a formula there.

/** One CSV cell: quoted when needed; a leading = + - @ is neutralised so spreadsheets never run it as a formula. */
export function csvCell(v: unknown) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows -> CSV text with a BOM, so Excel reads UTF-8 (₹, Hindi, Odia) correctly. */
export const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** "2026-10-04 18:30" in India time, for export columns. */
export const csvTime = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(",", "");

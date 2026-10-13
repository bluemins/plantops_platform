// Reading the owner's customer file (CSV saved from Google Sheets, Excel or Zoho) in the browser. Plain RFC 4180:
// quoted cells may hold commas, quotes ("") and line breaks; CRLF or LF; a UTF-8 BOM is dropped. Excel set to some
// regional formats saves with semicolons: used when the first line has semicolons and no commas.

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type Column = "name" | "phone" | "place";

/** A first guess at which column is which, from the header row (the owner can change it). -1 = not found. */
export function guessColumns(header: string[]): Record<Column, number> {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (re: RegExp, not: number[] = []) => h.findIndex((x, i) => re.test(x) && !not.includes(i));
  const phone = find(/phone|mobile|contact|number|\bno\b|whatsapp/);
  const name = find(/name|customer|party|shop|hotel/, [phone]);
  const place = find(/place|city|village|town|address|area|location|district/, [phone, name]);
  return { name, phone, place };
}

/** The file Order Capture offers as a starting point (docs/ORDER_CAPTURE_PHASE_PLAN.md "Template"). */
export const TEMPLATE_CSV = "Name,Phone,Place\r\nSri ram hotel,98765 43210,bijepur\r\nMaa Tarini Store,+91 91234 56780,Bargarh\r\n";

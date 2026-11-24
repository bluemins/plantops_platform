// Plant answers: "Copy as WhatsApp message". Only `shareable` facts go in (D7: no rupee amounts, no phone numbers);
// private cards are never copied (D10). A last check refuses the text if anything that looks like money or a phone
// number got in anyway (a wrongly labelled field), so a mistake shows as "can't copy", never as a leak.
import { dmy } from "../receivables";
import type { CardDef } from "./cards";
import { fieldsOf, formatValue, type Facts } from "./facts";

/** at most this many rows in one message; the rest are counted */
export const COPY_ROWS = 30;

const LEAK = [
  { why: "a rupee amount", re: /₹|\bRs\.?\s?\d|\bINR\b/i },
  { why: "a phone number", re: /\+91|(?<!\d)\d{10}(?!\d)/ },
];

/** null = clean; else what was found */
export function leakIn(text: string): string | null {
  return LEAK.find((l) => l.re.test(text))?.why ?? null;
}

export class CopyRefused extends Error {}

/** A name can hold a mobile ("Retail Customer 7999293831"): keep its last 4 digits only, so the name still reads. */
export const maskPhones = (s: string) => s.replace(/(?:\+91[\s-]?)?(?<!\d)\d{6}(\d{4})(?!\d)/g, "xxxxxx$1");

/** The message, or CopyRefused. `asOf` is the India day (YYYY-MM-DD). */
export function copyText(card: CardDef, facts: Facts, asOf: string): string {
  if (card.private) throw new CopyRefused(`${card.id} is private and is never copied`);
  const totals = fieldsOf(card, "total").filter((f) => f.privacy === "shareable");
  const cols = fieldsOf(card, "row").filter((f) => f.privacy === "shareable");
  const lines = [`*${card.title}* (as of ${dmy(asOf)})`];
  const head = totals.map((f) => `${f.label}: ${formatValue(f.kind, facts.totals[f.key] ?? null)}`).join(" · ");
  if (head) lines.push(head);
  if (!facts.rows.length) lines.push("Nothing to show.");
  facts.rows.slice(0, COPY_ROWS).forEach((r, i) => {
    const parts = cols.filter((f) => r[f.key] != null && r[f.key] !== "").map((f) => (f.kind === "text" ? maskPhones(formatValue(f.kind, r[f.key]!)) : formatValue(f.kind, r[f.key]!)));
    lines.push(`${i + 1}. ${parts.join(" · ")}`);
  });
  if (facts.rows.length > COPY_ROWS) lines.push(`…and ${facts.rows.length - COPY_ROWS} more in PlantOps.`);
  const text = lines.join("\n");
  const leak = leakIn(text);
  if (leak) throw new CopyRefused(`The copied text of ${card.id} would include ${leak}`);
  return text;
}

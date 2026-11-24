// Plant answers, step "word the answer": fixed sentences filled only from a card's facts. No AI (D3). A later Odia
// version of each sentence goes beside the English one (Phase 13), so wording never changes meaning.
import { formatValue, type Facts } from "./facts";

export const WORDING_VERSION = 1;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

const SENTENCES: Record<string, (f: Facts) => string> = {
  M2: (f) => {
    const bills = Number(f.totals.bills);
    if (!bills) return "No bills are over 30 days late. Nobody to chase today.";
    const first = f.rows[0]!;
    return (
      `${plural(bills, "bill", "bills")} from ${plural(Number(f.totals.customers), "customer", "customers")} ${bills === 1 ? "is" : "are"} over 30 days late, ` +
      `${formatValue("money", f.totals.due)} in all. Call ${first.customer} first: ${formatValue("money", first.due)}, ${formatValue("days", first.oldest_days)} late.`
    );
  },
};

/** The sentence for a built card; a card without one is a programming error (tests check every built card). */
export function word(cardId: string, facts: Facts): string {
  const s = SENTENCES[cardId];
  if (!s) throw new Error(`No sentence for card ${cardId}`);
  return s(facts);
}

export const hasSentence = (cardId: string) => cardId in SENTENCES;

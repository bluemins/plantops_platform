// Suggestions for the Match screen: which customer a Zoho contact probably is (and the other way round). Only
// suggestions: the owner decides every link (owner, 2026-11-06). Pure, no database.
//
// A name is compared word by word after dropping titles (Mr., Mrs. …), punctuation and case; the place in brackets
// ("Sahu Hotel(Bijepur)") is compared separately and only adds to the score. A word that starts another word (≥ 3
// letters: "Ganesh" / "Ganesha") counts most of a match.

const TITLES = new Set(["mr", "mrs", "miss", "ms", "dr", "m/s", "ms."]);

export function nameParts(name: string) {
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const main = (m ? m[1]! : name).toLowerCase();
  const place = m ? m[2]!.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() : "";
  const words = main
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w));
  return { words, place };
}

const wordScore = (a: string, b: string) => (a === b ? 1 : a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)) ? 0.8 : 0);

/** 0 … 1: how alike two names are. */
export function nameScore(a: string, b: string, placeB = "") {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x.words.length || !y.words.length) return 0;
  let hit = 0;
  for (const w of x.words) hit += Math.max(0, ...y.words.map((v) => wordScore(w, v)));
  let score = hit / Math.max(x.words.length, y.words.length);
  // the place in brackets matches the other side's place, or one of its words
  const otherPlace = (placeB || y.place).toLowerCase();
  if (x.place && (otherPlace.includes(x.place) || y.words.includes(x.place))) score += 0.15;
  return Math.min(1, Math.round(score * 100) / 100);
}

export const SUGGEST_MIN = 0.5;

/** The best few matches for `name` among `others` (score ≥ SUGGEST_MIN), best first. */
export function suggest<T extends { name: string; place?: string }>(name: string, others: T[], n = 3) {
  return others
    .map((o) => ({ item: o, score: nameScore(name, o.name, o.place ?? "") }))
    .filter((s) => s.score >= SUGGEST_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

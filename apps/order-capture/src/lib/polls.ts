// Drop polls (docs/CUSTOMER_APP_PHASE_PLAN.md "Polls tab"; owner 2026-11-09). Pure rules:
//   * a poll is open from opens_at until closes_at (or until the owner closes it early)
//   * poll points, decided when an answer is saved: the poll points in force that day, only when points are on, it is
//     the shop's first counted answer this week (Monday–Sunday, India) and the shop had an order delivered in the last
//     30 days; otherwise 0 with the reason
//   * buying size from main-brand boxes in the 3 months before the poll opened: small < 10, medium 10–49, large 50+
import { addDays } from "./customer-insights";

export type PollReason = "counted" | "week_used" | "no_recent_order" | "points_off";
export type PollState = "scheduled" | "open" | "closed";

export function pollState(p: { opens_at: Date; closes_at: Date; closed_early_at: Date | null }, now: Date): PollState {
  if (p.closed_early_at || now >= p.closes_at) return "closed";
  return now < p.opens_at ? "scheduled" : "open";
}

/** The Monday (India date) of the week `day` is in. */
export function weekStart(day: string) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** Points for an answer saved on `today` (India date). */
export function answerPoints(input: {
  /** points on: a start date that has come */
  pointsOn: boolean;
  pollPoints: number;
  today: string;
  /** India dates of this shop's earlier counted answers */
  countedOn: string[];
  /** India date of the shop's latest delivered order; null = none */
  lastDeliveredOn: string | null;
}): { points: number; reason: PollReason } {
  if (!input.pointsOn || input.pollPoints <= 0) return { points: 0, reason: "points_off" };
  const monday = weekStart(input.today);
  if (input.countedOn.some((d) => d >= monday && d <= input.today)) return { points: 0, reason: "week_used" };
  if (!input.lastDeliveredOn || input.lastDeliveredOn < addDays(input.today, -30)) return { points: 0, reason: "no_recent_order" };
  return { points: input.pollPoints, reason: "counted" };
}

export const REASON_TEXT: Record<PollReason, (points: number) => string> = {
  counted: (n) => `Thank you! +${n} points.`,
  week_used: () => "Thank you! You already got this week's poll points.",
  no_recent_order: () => "Thank you! Poll points need an order delivered in the last 30 days.",
  points_off: () => "Thank you for answering!",
};

export type BuyingSize = "small" | "medium" | "large";
export const SIZES: BuyingSize[] = ["small", "medium", "large"];
export const SIZE_LABEL: Record<BuyingSize, string> = { small: "Small (under 10 boxes)", medium: "Medium (10–49 boxes)", large: "Large (50+ boxes)" };

/** Buying size from boxes bought in the 3 months before the poll (owner, 2026-11-09). */
export const sizeOf = (boxes: number): BuyingSize => (boxes >= 50 ? "large" : boxes >= 10 ? "medium" : "small");

/** "Other" is choice -1. */
export const OTHER = -1;

export type ResultAnswer = { choice: number; other_text: string | null; place: string; boxes: number };

/** Counts per choice (the last count is "Other" when the poll has it), split by place and by buying size. */
export function pollResults(choices: string[], otherAllowed: boolean, answers: ResultAnswer[]) {
  const labels = otherAllowed ? [...choices, "Other"] : [...choices];
  const idx = (c: number) => (c === OTHER ? choices.length : c);
  const tally = (list: ResultAnswer[]) => {
    const counts = labels.map(() => 0);
    for (const a of list) if (idx(a.choice) < counts.length) counts[idx(a.choice)]! += 1;
    return { total: list.length, counts };
  };
  const group = <K extends string>(keyOf: (a: ResultAnswer) => K) => {
    const m = new Map<K, ResultAnswer[]>();
    for (const a of answers) m.set(keyOf(a), [...(m.get(keyOf(a)) ?? []), a]);
    return m;
  };
  const places = [...group((a) => a.place.trim() || "—")].map(([place, list]) => ({ place, ...tally(list) })).sort((a, b) => Number(a.place === "—") - Number(b.place === "—") || b.total - a.total || a.place.localeCompare(b.place));
  const sizes = group((a) => sizeOf(a.boxes));
  return {
    labels,
    ...tally(answers),
    others: answers.filter((a) => a.choice === OTHER && a.other_text).map((a) => a.other_text!),
    by_place: places,
    by_size: SIZES.map((size) => ({ size, ...tally(sizes.get(size) ?? []) })),
  };
}

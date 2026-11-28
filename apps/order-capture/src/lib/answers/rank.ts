// Plant answers, step "rank the actions" (docs/MORNING_REPORT_PHASE_PLAN.md section 3; owner 2026-11-28): the priority
// rules that pick at most 7 actions for the morning report from the stock, order and money cards. Fixed sentences, no AI
// (D3). A later AI ranking would take the same input and give the same output, and these rules stay as the fallback.
// Each action has two texts: `text` for the owner's screen (may hold ₹) and `share` for Copy as WhatsApp, built from
// shareable facts only (no ₹, no phones, no staff names: D7) and checked again by the copy guard.
import { leakIn, maskPhones } from "./copy";
import { formatValue, type Facts, type Row } from "./facts";

/** the morning report lists at most this many actions (D11) */
export const MAX_ACTIONS = 7;
/** level 3: a material that runs out within this many days */
export const RUN_OUT_DAYS = 3;

export interface Action {
  cardId: string;
  /** the priority level of section 3's table (1 = first) */
  level: number;
  /** the owner's screen */
  text: string;
  /** the copied message: no ₹, no phones, no staff names */
  share: string;
  /** a page in Sales */
  href: string;
}

/** the cards the rules read, by id; a card that couldn't be worked out is left out (and said in the report) */
export type RankInput = Partial<Record<"S3" | "S1" | "S2" | "O1" | "M2" | "O2", Facts>>;

export interface Ranked {
  actions: Action[];
  /** candidates left out by the per-level cap or the limit of 7, per card */
  leftOut: { cardId: string; count: number }[];
}

const N = (v: unknown) => Number(v ?? 0);
const S = (v: unknown) => maskPhones(String(v ?? ""));
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const at = (place: unknown) => (place ? ` (${S(place)})` : "");
const days = (v: unknown) => formatValue("days", N(v));
const cardHref = (id: string) => `/reports/answers/${id}`;
/** "28 Nov", as in the approved mock-up */
export const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${ymd}T00:00:00Z`));

type Make = (f: Facts) => Omit<Action, "cardId" | "level">[];

/** Section 3's table, in order: card, most actions per day, how its candidates are made. */
const LEVELS: { level: number; cardId: keyof RankInput; max: number; make: Make }[] = [
  {
    level: 1,
    cardId: "S3",
    max: 1,
    make: (f) => {
      const t = f.totals;
      if (t.day === null || t.day === undefined) return [];
      const day = shortDate(String(t.day));
      if (t.done !== "Done") {
        const s = `Last night's count (${day}) was not done. Ask the store keeper to count today.`;
        return [{ text: s, share: s, href: cardHref("S3") }];
      }
      const n = N(t.not_updated);
      if (!n) return [];
      const names = f.rows.map((r) => S(r.material)).join(", ");
      const what = `did not update ${n === 1 ? "1 material" : `${n} materials`}: ${names}. Ask for a correction.`;
      return [{ text: `Last night's count (${day}${t.by ? `, ${S(t.by)}` : ""}${t.at ? `, ${t.at}` : ""}) ${what}`, share: `Last night's count (${day}) ${what}`, href: cardHref("S3") }];
    },
  },
  {
    level: 2,
    cardId: "S1",
    max: 2,
    make: (f) =>
      f.rows
        .filter((r) => N(r.make) > 0)
        .map((r: Row) => {
          const u = String(r.unit ?? "box");
          const short = r.short_material ? ` Material for only ${qty(N(r.can_make))} ${u}: ${S(r.short_material)} runs out first.` : "";
          const s = `Make ${qty(N(r.make))} ${u} ${S(r.product)}: ${qty(N(r.needed))} ${u} pending, ${qty(N(r.in_stock))} in stock.${short}`;
          return { text: s, share: s, href: cardHref("S1") };
        }),
  },
  {
    level: 3,
    cardId: "S2",
    max: 1,
    make: (f) =>
      f.rows
        .filter((r) => N(r.days_left) <= RUN_OUT_DAYS)
        .map((r) => {
          const s = `${S(r.material)} runs out in about ${days(r.days_left)} at this rate (${S(r.on_hand)} left).`;
          return { text: s, share: s, href: cardHref("S2") };
        }),
  },
  {
    level: 4,
    cardId: "O1",
    max: 2,
    make: (f) =>
      f.rows
        .filter((r) => r.stock === "Stock there")
        .map((r) => {
          const s = `${S(r.ref)} ${S(r.customer)}${at(r.place)}: waiting ${days(r.days)}, stock is ready. Give a delivery day.`;
          return { text: s, share: s, href: String(r.href ?? cardHref("O1")) };
        }),
  },
  {
    level: 5,
    cardId: "M2",
    max: 2,
    make: (f) =>
      f.rows.map((r) => {
        const bills = String(r.bill_numbers ?? "").split(", ").filter(Boolean).length;
        const base = `Call ${S(r.customer)}${at(r.place)}: ${bills === 1 ? "1 bill" : `${bills} bills`} over 30 days, oldest ${days(r.oldest_days)} late`;
        return { text: `${base}, ${formatValue("money", r.due)} due.`, share: `${base}.`, href: String(r.href ?? cardHref("M2")) };
      }),
  },
  {
    level: 6,
    cardId: "O2",
    max: 1,
    make: (f) =>
      f.rows.map((r) => {
        const s = `Call ${S(r.customer)}${at(r.place)}: usually orders every ${days(r.usual_gap)}, none for ${days(r.since_last)}.`;
        return { text: s, share: s, href: String(r.href ?? cardHref("O2")) };
      }),
  },
];

/** The rules: each level in order, up to its cap, until 7. An empty level leaves its places to the next. */
export function rankRules(input: RankInput): Ranked {
  const actions: Action[] = [];
  const leftOut: Ranked["leftOut"] = [];
  for (const l of LEVELS) {
    const f = input[l.cardId];
    const all = f ? l.make(f) : [];
    const room = Math.max(0, Math.min(l.max, MAX_ACTIONS - actions.length));
    const taken = all.slice(0, room);
    for (const a of taken) {
      // a wrongly built share text must never leak: fall back to pointing at the card
      const share = leakIn(a.share) ? `See "${l.cardId}" in PlantOps.` : a.share;
      actions.push({ cardId: l.cardId, level: l.level, ...a, share });
    }
    if (all.length > taken.length) leftOut.push({ cardId: l.cardId, count: all.length - taken.length });
  }
  return { actions, leftOut };
}

/** The notification and page heading. */
export function morningSummary(r: Ranked): { title: string; body: string } {
  const n = r.actions.length;
  if (!n) return { title: "Morning report: nothing urgent today", body: "Count, stock, pending orders and late bills all look fine." };
  return { title: `Morning report: ${n === 1 ? "1 thing" : `${n} things`} for today`, body: `First: ${r.actions[0]!.share}`.slice(0, 300) };
}

/** Copy as WhatsApp: shareable texts only, numbered; null if the guard finds ₹ or a phone anyway. */
export function morningCopy(dateLabel: string, actions: Pick<Action, "share">[]): string | null {
  const lines = [`*Morning report, ${dateLabel}*`, ...(actions.length ? actions.map((a, i) => `${i + 1}. ${a.share}`) : ["Nothing urgent today."])];
  const text = lines.join("\n");
  return leakIn(text) ? null : text;
}

export type Rank = (input: RankInput) => Ranked;

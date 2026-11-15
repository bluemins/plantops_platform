// Field day log: the pure rules (docs/FIELD_DAY_PHASE_PLAN.md "Agreed design"). The server loads the rows; this file
// works out what a day looks like. Nothing worked out here is stored.
//   * A day belongs to the India date of its start. The newest start / end counts (a correction is a new row pointing
//     to the one it replaces); the time shown is the first one's.
//   * A removed visit stays, crossed out.
//   * An End (or a visit) with no day started today goes to yesterday's day if that was started and not ended: an End
//     after midnight closes last night's round.

/** Worse than this, a location is "rough": saved, marked for the owner, never saved as a shop's location (as Sales). */
export const ROUGH_M = 150;
/** km as typed: 0 to 9,999,999.9, at most one decimal ("45210" or "45210.5"). */
const KM_RE = /^\d{1,7}(\.\d)?$/;

export type FieldEventKind = "start" | "visit" | "end";

export interface FieldEventRow {
  id: string;
  /** whose day it is */
  userId: string;
  userName: string;
  onDate: string;
  kind: FieldEventKind;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  placeText: string | null;
  kmTenths: number | null;
  photoFileId: string | null;
  correctsId: string | null;
  reason: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPlace: string | null;
  customerPhone: string | null;
  saveLocation: boolean | null;
  note: string | null;
  createdBy: string;
  createdByName: string;
  /** ISO time */
  at: string;
}

export interface FieldCancelRow {
  eventId: string;
  reason: string;
  createdByName: string;
  at: string;
}

export interface TimelineItem extends FieldEventRow {
  /** a start / end replaced by a newer correction */
  replaced: boolean;
  /** a removed visit: who, when, why */
  removed: { by: string; at: string; reason: string } | null;
  rough: boolean;
}

export interface FieldDayView {
  date: string;
  /** the start / end that count (newest); null = none */
  start: TimelineItem | null;
  end: TimelineItem | null;
  /** when the day was first started / ended (a correction keeps the original time) */
  startedAt: string | null;
  endedAt: string | null;
  /** visits still counted (not removed), oldest first */
  visits: TimelineItem[];
  /** every row, oldest first, for the timeline (replaced and removed ones crossed out) */
  timeline: TimelineItem[];
  /** km by meter: end − start in tenths; null until ended */
  kmTenths: number | null;
  notEnded: boolean;
  removedVisits: number;
  anyRough: boolean;
}

export const isRough = (accuracyM: number | null) => accuracyM !== null && accuracyM > ROUGH_M;

/** "45210.5" → 452105 tenths; null when it isn't a km reading. */
export function parseKm(typed: string): number | null {
  const s = typed.trim().replace(/,/g, "");
  if (!KM_RE.test(s)) return null;
  return Math.round(Number(s) * 10);
}

/** 452105 → "45,210.5" */
export const fmtKm = (tenths: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tenths / 10);

/** The Google Maps link for a point (no map is drawn in the page: no key, no cost). */
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

const byTime = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/** One day of one person, from its rows. */
export function fieldDayView(date: string, events: readonly FieldEventRow[], cancels: readonly FieldCancelRow[]): FieldDayView {
  const rows = events.filter((e) => e.onDate === date).sort(byTime);
  const cancelOf = new Map(cancels.map((c) => [c.eventId, c]));
  const newest = (kind: "start" | "end") => rows.filter((r) => r.kind === kind).at(-1) ?? null;
  const first = (kind: "start" | "end") => rows.find((r) => r.kind === kind) ?? null;
  const startRow = newest("start");
  const endRow = newest("end");
  const timeline: TimelineItem[] = rows.map((r) => {
    const c = r.kind === "visit" ? cancelOf.get(r.id) : undefined;
    return {
      ...r,
      replaced: (r.kind === "start" && r.id !== startRow?.id) || (r.kind === "end" && r.id !== endRow?.id),
      removed: c ? { by: c.createdByName, at: c.at, reason: c.reason } : null,
      rough: isRough(r.accuracyM),
    };
  });
  const item = (id: string | undefined) => timeline.find((t) => t.id === id) ?? null;
  const start = item(startRow?.id);
  const end = item(endRow?.id);
  const visits = timeline.filter((t) => t.kind === "visit" && !t.removed);
  return {
    date,
    start,
    end,
    startedAt: first("start")?.at ?? null,
    endedAt: first("end")?.at ?? null,
    visits,
    timeline,
    kmTenths: start && end && start.kmTenths !== null && end.kmTenths !== null ? end.kmTenths - start.kmTenths : null,
    notEnded: !!start && !end,
    removedVisits: timeline.filter((t) => t.kind === "visit" && t.removed).length,
    anyRough: timeline.some((t) => t.rough && !t.replaced && !t.removed),
  };
}

export interface DayState {
  started: boolean;
  ended: boolean;
}

/**
 * Which day a visit or an End goes to: today's if it was started; else yesterday's when that was started and not
 * ended (after midnight); else none ("Start your day first").
 */
export function openDayFor(today: string, yesterday: string, states: { today: DayState; yesterday: DayState }): string | null {
  if (states.today.started) return today;
  if (states.yesterday.started && !states.yesterday.ended) return yesterday;
  return null;
}

// Plant days are India days: a mark belongs to its date in Asia/Kolkata, whatever the server's clock zone.
// (Floor Stock has the same idea in its own days.ts; apps don't share code with each other.)

const IST_OFFSET_MS = 5.5 * 3600_000;

/** "2026-10-15" for a moment, in India time. */
export const istDay = (at: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);

/** "2026-10" for a moment, in India time. */
export const istMonth = (at: Date = new Date()) => istDay(at).slice(0, 7);

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})-(\d{2})$/;

/** A real calendar date written "YYYY-MM-DD" (not "2026-02-30"). */
export function validDay(s: string) {
  const m = YMD.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s && +m[1]! >= 2000;
}

/** A real month written "YYYY-MM". */
export const validMonth = (s: string) => YM.test(s) && validDay(`${s}-01`);

/** The moment an India date starts (00:00 IST), as a Date. */
export function dayStart(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) - IST_OFFSET_MS);
}

/** "2026-10-08" + n days (n may be negative). */
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** "2026-10" + n months. */
export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Every date of a month, "2026-10-01" ... "2026-10-31". */
export function monthDays(ym: string) {
  const days: string[] = [];
  for (let d = `${ym}-01`; d.startsWith(ym); d = addDays(d, 1)) days.push(d);
  return days;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayMon0(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

/** "8h 40m", "0h 05m", "0h" */
export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return min === 0 ? "0h" : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "Tue, 13 Oct" */
export const fmtDayLong = (ymd: string) =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/** "October 2026" */
export const fmtMonth = (ym: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

// Plant days are India days: a count belongs to the date in Asia/Kolkata, whatever the server's clock zone.

/** "2026-10-08" for a moment, in India time. */
export const istDay = (at: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);

/**
 * The day a count belongs to (B-05): until 5 am India time it is still last night's count, so a store keeper who
 * finishes after midnight lands on the right day. Saving is still allowed for the calendar today and yesterday.
 */
export const COUNT_DAY_STARTS_AT = 5;
export const countDay = (at: Date = new Date()) => istDay(new Date(at.getTime() - COUNT_DAY_STARTS_AT * 3600_000));
/** Between midnight and 5 am: the counting day is still yesterday's calendar date. */
export const afterMidnight = (at: Date = new Date()) => countDay(at) !== istDay(at);

/** "2026-10-08" + n days (n may be negative). */
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** "6:40 pm" in India time. */
export const istTime = (at: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at)).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();

// Plant days are India days: a count belongs to the date in Asia/Kolkata, whatever the server's clock zone.

/** "2026-10-08" for a moment, in India time. */
export const istDay = (at: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);

/** "2026-10-08" + n days (n may be negative). */
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** "6:40 pm" in India time. */
export const istTime = (at: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at)).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();

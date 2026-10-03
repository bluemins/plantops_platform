// The plan's history window (plan §1 E): screens, search and prints show only the last N months.
// Nothing is deleted; the owner's export always contains everything.
import { historyMonths } from "./platform";

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** First visible day (YYYY-MM-DD), or null when the plan has no limit. */
export async function historyCutoff(tenantId: string, today = todayIst()): Promise<string | null> {
  const months = await historyMonths(tenantId);
  if (!months) return null;
  const [y, m, d] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d!, lastDay)); // 31 Mar - 1 month = 28/29 Feb
  return first.toISOString().slice(0, 10);
}

/** Is a date (YYYY-MM-DD or ISO time) inside the window? */
export function visible(cutoff: string | null, date: string) {
  if (!cutoff) return true;
  const ymd = date.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(date)) : date;
  return ymd >= cutoff;
}

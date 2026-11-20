// Reports → Receivables → Written off (owner, 2026-11-20): the period from the address, like the other reports.
import { periodDates, PERIODS, type Period } from "@/lib/report";
import { istToday } from "./ledger";

export function readWriteOffParams(q: Record<string, string | undefined>) {
  const period = ((PERIODS as readonly string[]).includes(q.period ?? "") ? q.period : "this_fy") as Period;
  return { period, ...periodDates(period, istToday(), { from: q.from, to: q.to }) };
}

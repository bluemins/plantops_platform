// The owner's month CSV (docs/ATTENDANCE_PHASE_PLAN.md "Month CSV"): one row per person per day, worked out with the
// same rules as the calendars (a night shift counts on the day it started). Audited; cells can never run as formulas.
import { csv } from "@plantops/module-kit/csv";
import { fmtMinutes, istMonth, monthDays, validMonth } from "@/lib/days";
import { fmtTime } from "@/lib/punch";
import { workDays } from "@/lib/sessions";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { withTenant } from "./db";
import { notFound } from "./http";
import { loadMarks, staffList, type Person } from "./people";
import type { AtUser } from "./session";

export const CSV_HEADER = ["Name", "Date", "First IN", "Last OUT", "Worked", "Worked minutes", "Blocks", "No exit", "No entry", "Changed"];

/** Owner: the month as CSV text. People = active Plant staff + anyone with a mark that month. */
export async function monthCsv(user: AtUser, month: string) {
  requireAccess(user, "export");
  if (!validMonth(month) || month > istMonth()) throw notFound("Not found");
  const dates = monthDays(month);
  const staff = await staffList(user);
  return withTenant(user.tenantId, async (tx) => {
    const loaded = await loadMarks(tx, user.tenantId, dates[0]!, dates.at(-1)!);
    // active Plant staff, plus anyone else with something on a day of this month (e.g. someone who has left)
    const people = new Map<string, Person>(staff.active.map((p) => [p.userId, p]));
    const now = new Date();
    const daysOf = new Map([...loaded].map(([userId, l]) => [userId, workDays(l.marks, l.cancels, now)]));
    for (const [userId, days] of daysOf) {
      if (!people.has(userId) && dates.some((d) => days.has(d))) people.set(userId, { userId, name: loaded.get(userId)!.name });
    }
    const rows: unknown[][] = [CSV_HEADER];
    for (const p of [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))) {
      const days = daysOf.get(p.userId);
      for (const d of dates) {
        const day = days?.get(d);
        const done = day?.blocks.filter((b) => b.status === "done") ?? [];
        const firstIn = day?.blocks[0]?.start.at;
        const lastOut = done.reduce<Date | null>((latest, b) => (!latest || b.end!.at > latest ? b.end!.at : latest), null);
        rows.push([
          p.name,
          d,
          firstIn ? fmtTime(firstIn) : "",
          lastOut ? fmtTime(lastOut) : "",
          day && day.minutes > 0 ? fmtMinutes(day.minutes) : "",
          day?.minutes ?? 0,
          done.length,
          day?.noExit ? "yes" : "",
          day?.noEntry ? "yes" : "",
          day?.changed ? "yes" : "",
        ]);
      }
    }
    await audit(tx, user, "export.csv", null, { month, people: people.size, rows: rows.length - 1 });
    return csv(rows);
  });
}

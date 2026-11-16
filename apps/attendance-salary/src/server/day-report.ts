// Attendance's part of Sales' Day report (owner only; packages/module-kit/src/day-report.ts): who came, who was late,
// who didn't mark, who has no OUT, field days and claims waiting. Never money (owner 2026-11-16). The Today board's own
// rules (boardFor), worked out for the end of that day. Read only, nothing stored.
import { sql } from "drizzle-orm";
import type { DayReportPart } from "@plantops/types";
import { clip, endOfDay, plural } from "@plantops/module-kit/day-report";
import { loadClaims } from "./claims";
import { withTenant } from "./db";
import { fieldDaysOn } from "./field";
import { boardFor } from "./today";

const time = (at: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
const minutesIst = (at: Date) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(at).split(":").map(Number);
  return (h! % 24) * 60 + m!;
};
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const names = (list: { name: string }[]) => list.map((p) => p.name).join(", ");

export async function attendanceDayReport(tenantId: string, date: string, now: Date): Promise<DayReportPart> {
  const at = endOfDay(date, now);
  const isToday = at === now;
  const board = await boardFor(tenantId, at);
  const { starts, waiting } = await withTenant(tenantId, async (tx) => {
    // each person's "Work starts at" (rule 23) from the setting in force that month; null = no start time set
    const r = await tx.execute<{ user_id: string; work_start_minutes: number | null }>(sql`
      select distinct on (user_id) user_id, work_start_minutes
        from attendance_salary.salary_settings
       where tenant_id = ${tenantId} and from_month <= ${date}::date
       order by user_id, from_month desc, created_at desc`);
    const claims = await loadClaims(tx, tenantId);
    return { starts: new Map(r.rows.map((x) => [x.user_id, x.work_start_minutes])), waiting: claims.filter((c) => c.status === "waiting").length };
  });
  const field = await fieldDaysOn(tenantId, date);

  const present = [...board.cameLeft.map((p) => ({ ...p, first: p.firstIn })), ...board.inside.map((p) => ({ ...p, first: p.since }))];
  const total = present.length + board.notMarked.length + board.dayOff.length;
  const late = present
    .filter((p) => {
      const s = starts.get(p.userId);
      return p.first && s !== null && s !== undefined && minutesIst(p.first) > s;
    })
    .map((p) => `${p.name} ${time(p.first!)} (starts ${hm(starts.get(p.userId)!)})`);

  const rows: DayReportPart["rows"] = [
    { label: "Present", value: `${present.length} of ${total}` },
    { label: "Not marked", value: board.notMarked.length ? clip(names(board.notMarked), 300) : "None", tone: board.notMarked.length ? "warn" : "ok" },
  ];
  if (board.dayOff.length) rows.push({ label: "Day off (marked OFF)", value: clip(names(board.dayOff), 300) });
  rows.push({ label: "Came after work start", value: late.length ? clip(late.join(", "), 300) : "None", tone: late.length ? "warn" : undefined });
  if (board.inside.length)
    rows.push({ label: isToday ? "Inside now (no OUT yet)" : "No OUT that day", value: clip(board.inside.map((p) => `${p.name} (in ${time(p.since)})`).join(", "), 300), tone: isToday ? undefined : "warn" });
  if (board.noExitYesterday.length) rows.push({ label: "No OUT the day before", value: clip(names(board.noExitYesterday), 300), tone: "warn" });
  for (const f of field)
    rows.push({
      label: `Field day: ${f.name}`,
      value: [f.kmTenths !== null ? `${(f.kmTenths / 10).toLocaleString("en-IN")} km` : "", plural(f.visits, "shop"), f.notEnded ? "not ended" : ""].filter(Boolean).join(" · "),
      tone: f.notEnded && !isToday ? "warn" : undefined,
    });
  rows.push({ label: "Claims waiting for approval", value: String(waiting), tone: waiting ? "warn" : undefined });
  if (board.platformDown) rows.push({ label: "Note", value: "PlantOps couldn't list the staff: only people who marked in the last 3 days are counted", tone: "warn" });

  const attention: string[] = [];
  if (board.notMarked.length) attention.push(clip(`Not marked: ${names(board.notMarked)}`, 200));
  if (waiting) attention.push(`${plural(waiting, "claim")} waiting for approval`);
  const notEnded = field.filter((f) => f.notEnded);
  if (notEnded.length && !isToday) attention.push(clip(`Field day not ended: ${names(notEnded)}`, 200));
  return { summary: `${present.length} of ${total} present`, tone: board.notMarked.length ? "warn" : "ok", rows, attention };
}

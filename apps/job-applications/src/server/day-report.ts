// Job applications' part of Sales' Day report (owner only; packages/module-kit/src/day-report.ts): applications that
// came in that day (by position) and how many are still new. No names or phone numbers. Read only, nothing stored.
import { sql } from "drizzle-orm";
import type { DayReportPart } from "@plantops/types";
import { clip, plural } from "@plantops/module-kit/day-report";
import { withTenant } from "./db";

export function jobsDayReport(tenantId: string, date: string): Promise<DayReportPart> {
  const from = `${date}T00:00:00+05:30`;
  return withTenant(tenantId, async (tx) => {
    const day = await tx.execute<{ position: string; n: number }>(sql`
      select coalesce(opening_title, 'No position') as position, count(*)::int as n
        from job_applications.applications
       where tenant_id = ${tenantId} and created_at >= ${from}::timestamptz and created_at < ${from}::timestamptz + interval '1 day'
       group by 1 order by 2 desc, 1`);
    const fresh = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from job_applications.applications where tenant_id = ${tenantId} and status = 'new'`);
    const came = day.rows.reduce((s, r) => s + r.n, 0);
    const waiting = fresh.rows[0]?.n ?? 0;
    const rows: DayReportPart["rows"] = [{ label: "Came in that day", value: String(came) }];
    for (const r of day.rows.slice(0, 8)) rows.push({ label: `  ${clip(r.position, 90)}`, value: String(r.n) });
    rows.push({ label: "Still new (not handled)", value: String(waiting) });
    return { summary: `${came} new that day`, tone: "ok", rows, attention: came ? [`${plural(came, "new job application")}`] : [] };
  });
}

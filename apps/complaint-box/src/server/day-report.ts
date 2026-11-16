// Complaint Box's part of Sales' Day report (owner only; packages/module-kit/src/day-report.ts): complaints logged and
// resolved that day, open now, the oldest open ones. No customer phone numbers. Read only, nothing stored.
import { sql } from "drizzle-orm";
import type { DayReportPart } from "@plantops/types";
import { clip, plural } from "@plantops/module-kit/day-report";
import { withTenant } from "./db";
import { AMBER_AFTER_DAYS } from "./inbox";

const ref = (n: number) => `C-${String(n).padStart(4, "0")}`;

export function complaintDayReport(tenantId: string, date: string, now: Date): Promise<DayReportPart> {
  const from = `${date}T00:00:00+05:30`;
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ logged: number; resolved: number; reopened: number }>(sql`
      select (select count(*)::int from complaint_box.complaints c
               where c.tenant_id = ${tenantId} and c.created_at >= ${from}::timestamptz and c.created_at < ${from}::timestamptz + interval '1 day') as logged,
             (select count(*)::int from complaint_box.complaint_events e
               where e.tenant_id = ${tenantId} and e.kind = 'resolved' and e.created_at >= ${from}::timestamptz and e.created_at < ${from}::timestamptz + interval '1 day') as resolved,
             (select count(*)::int from complaint_box.complaint_events e
               where e.tenant_id = ${tenantId} and e.kind = 'reopened' and e.created_at >= ${from}::timestamptz and e.created_at < ${from}::timestamptz + interval '1 day') as reopened`);
    // open now, with days since logging / the last reopening (the inbox's rule)
    const open = await tx.execute<{ ref_no: number; item_name: string; place: string; days: number }>(sql`
      select c.ref_no, c.item_name, c.place,
             floor(extract(epoch from (${now.toISOString()}::timestamptz - coalesce((select max(e.created_at) from complaint_box.complaint_events e
                     where e.complaint_id = c.id and e.kind = 'reopened'), c.created_at))) / 86400)::int as days
        from complaint_box.complaints c
       where c.tenant_id = ${tenantId} and c.status in ('open', 'in_progress')
       order by days desc, c.ref_no`);
    const { logged = 0, resolved = 0, reopened = 0 } = rows[0] ?? {};
    const late = open.rows.filter((c) => c.days > AMBER_AFTER_DAYS);
    const out: DayReportPart["rows"] = [
      { label: "Logged that day", value: String(logged) },
      { label: "Resolved that day", value: String(resolved) },
    ];
    if (reopened) out.push({ label: "Reopened that day", value: String(reopened), tone: "warn" });
    out.push({ label: "Open now", value: String(open.rows.length), tone: open.rows.length ? undefined : "ok" });
    for (const c of open.rows.slice(0, 5))
      out.push({ label: `  ${ref(c.ref_no)}`, value: clip(`${c.item_name} · ${c.place} · ${plural(c.days, "day")} open`, 300), tone: c.days > AMBER_AFTER_DAYS ? "warn" : undefined });
    return {
      summary: `${logged} new · ${open.rows.length} open`,
      tone: late.length ? "warn" : "ok",
      rows: out,
      attention: late.length ? [clip(`${plural(late.length, "complaint")} open over ${AMBER_AFTER_DAYS} days (oldest ${ref(late[0]!.ref_no)}, ${plural(late[0]!.days, "day")})`, 200)] : [],
    };
  });
}

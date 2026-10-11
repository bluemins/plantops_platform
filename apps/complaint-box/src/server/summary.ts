// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored. Up to 3
// badges, the same for the owner and staff (docs/COMPLAINT_BOX_PHASE_PLAN.md "Standard pieces"):
//   "3 open" (info; "No open complaints" ok)  ·  "1 open over 3 days" (warn)  ·  "2 new today" (ok)
import { sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { withTenant } from "./db";
import { AMBER_AFTER_DAYS } from "./inbox";

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export function summaryFor(tenantId: string, _view: SummaryView, now = new Date()): Promise<ModuleSummary> {
  // "more than 3 days" = the same rule as the amber cards: whole days since logging / the last reopening > 3
  const amberBefore = new Date(now.getTime() - (AMBER_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000);
  const todayStart = new Date(`${istDay(now)}T00:00:00+05:30`);
  return withTenant(tenantId, async (tx) => {
    const { rows: setup } = await tx.execute<{ items: number }>(sql`
      select count(*)::int as items from complaint_box.items where tenant_id = ${tenantId} and status = 'active'`);
    if (!setup[0]?.items) return { badges: [{ text: "Item list not set up yet", tone: "warn" }] };

    const { rows } = await tx.execute<{ open: number; old: number; today: number }>(sql`
      select count(*) filter (where c.status in ('open', 'in_progress'))::int as open,
             count(*) filter (where c.status in ('open', 'in_progress')
                                and coalesce((select max(e.created_at) from complaint_box.complaint_events e
                                               where e.complaint_id = c.id and e.kind = 'reopened'), c.created_at) <= ${amberBefore.toISOString()}::timestamptz)::int as old,
             count(*) filter (where c.created_at >= ${todayStart.toISOString()}::timestamptz)::int as today
        from complaint_box.complaints c
       where c.tenant_id = ${tenantId}`);
    const { open = 0, old = 0, today = 0 } = rows[0] ?? {};
    const badges: ModuleSummary["badges"] = [open ? { text: `${open} open`, tone: "info" } : { text: "No open complaints", tone: "ok" }];
    if (old) badges.push({ text: `${old} open over ${AMBER_AFTER_DAYS} days`, tone: "warn" });
    if (today) badges.push({ text: `${today} new today`, tone: "ok" });
    return { badges };
  });
}

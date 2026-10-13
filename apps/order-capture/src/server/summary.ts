// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored. Up to 3
// badges, the same for the owner and staff (docs/ORDER_CAPTURE_PHASE_PLAN.md "Standard pieces"):
//   "3 pending" (info; "No pending orders" ok)  ·  "1 pending over 2 days" (warn)  ·  "2 new today" (ok)
import { sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { AMBER_AFTER_DAYS } from "@/lib/history";
import { withTenant } from "./db";

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export function summaryFor(tenantId: string, _view: SummaryView, now = new Date()): Promise<ModuleSummary> {
  // "over 2 days" = the same rule as the amber cards: entered 2 whole days ago or more
  const amberFrom = new Date(now.getTime() - AMBER_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const todayStart = new Date(`${istDay(now)}T00:00:00+05:30`);
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ pending: number; old: number; today: number }>(sql`
      select count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'pending' and created_at <= ${amberFrom.toISOString()}::timestamptz)::int as old,
             count(*) filter (where created_at >= ${todayStart.toISOString()}::timestamptz)::int as today
        from order_capture.orders
       where tenant_id = ${tenantId}`);
    const { pending = 0, old = 0, today = 0 } = rows[0] ?? {};
    const badges: ModuleSummary["badges"] = [pending ? { text: `${pending} pending`, tone: "info" } : { text: "No pending orders", tone: "ok" }];
    if (old) badges.push({ text: `${old} pending over ${AMBER_AFTER_DAYS} days`, tone: "warn" });
    if (today) badges.push({ text: `${today} new today`, tone: "ok" });
    return { badges };
  });
}

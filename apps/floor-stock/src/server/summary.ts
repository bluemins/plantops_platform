// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored.
// Up to 3 badges (approved 2026-10-04):
//   "Today's count not done" (warn) / "Counted 6:40 pm" (ok)
//   "N items low" (danger) - from the newest count, against today's limits
//   "Made 120 box" (info) - today's production
import { sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { istDay, istTime } from "@/lib/days";
import { qty } from "@/lib/compare";
import { withTenant } from "./db";

const MAX_TEXT = 40;

export function summaryFor(tenantId: string, _view: SummaryView, now = new Date()): Promise<ModuleSummary> {
  const today = istDay(now);
  return withTenant(tenantId, async (tx) => {
    const { rows: setup } = await tx.execute<{ items: number }>(sql`
      select count(*)::int as items
        from floor_stock.items i
        join floor_stock.sections s on s.id = i.section_id and s.status = 'active'
       where i.tenant_id = ${tenantId} and i.status = 'active'`);
    if (!setup[0]?.items) return { badges: [{ text: "Sections not set up yet", tone: "warn" }] };

    // the newest count (its latest version) and whether it is today's
    const { rows: newest } = await tx.execute<{ date: string; version_id: string; first_at: string }>(sql`
      select c.count_date::text as date,
             (select v.id from floor_stock.count_versions v where v.count_id = c.id order by v.version desc limit 1) as version_id,
             (select v.entered_at from floor_stock.count_versions v where v.count_id = c.id and v.version = 1) as first_at
        from floor_stock.counts c
       where c.tenant_id = ${tenantId}
       order by c.count_date desc
       limit 1`);
    const last = newest[0];
    const badges: ModuleSummary["badges"] = [];
    const countedToday = last?.date === today;
    badges.push(countedToday ? { text: `Counted ${istTime(last!.first_at)}`, tone: "ok" } : { text: "Today's count not done", tone: "warn" });
    if (!last) return { badges };

    const { rows: low } = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select l.item_id
          from floor_stock.count_lines l
          join floor_stock.items i on i.id = l.item_id
         where l.version_id = ${last.version_id} and l.kind = 'stock' and i.min_level is not null
         group by l.item_id, i.min_level
        having sum(l.qty) < i.min_level) x`);
    const n = low[0]?.n ?? 0;
    if (n) badges.push({ text: `${n} item${n === 1 ? "" : "s"} low`, tone: "danger" });

    if (countedToday) {
      const { rows: made } = await tx.execute<{ unit: string; total: string }>(sql`
        select l.unit, sum(l.qty)::text as total
          from floor_stock.count_lines l
         where l.version_id = ${last.version_id} and l.kind = 'production'
         group by l.unit
         order by sum(l.qty) desc`);
      const parts = made.filter((m) => Number(m.total) > 0).map((m) => `${qty(Number(m.total))} ${m.unit}`);
      let text = parts.length ? `Made ${parts.join(" + ")}` : "";
      if (text.length > MAX_TEXT) text = `Made ${parts[0]}`.slice(0, MAX_TEXT);
      if (text) badges.push({ text, tone: "info" });
    }
    return { badges };
  });
}

// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored.
import { sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { withTenant } from "./db";

/** Up to 3 badges: expired (red), expiring within 30 days (amber), number of documents. */
export function summaryFor(tenantId: string, _view: SummaryView): Promise<ModuleSummary> {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ expired: number; soon: number; total: number }>(sql`
      with cur as (
        select distinct on (v.document_id) v.expires_on
          from document_store.document_versions v
          join document_store.documents d on d.id = v.document_id and d.status = 'active'
         where v.tenant_id = ${tenantId}
         order by v.document_id, v.version desc)
      select count(*) filter (where expires_on < (now() at time zone 'Asia/Kolkata')::date)::int as expired,
             count(*) filter (where expires_on >= (now() at time zone 'Asia/Kolkata')::date
                               and expires_on <= (now() at time zone 'Asia/Kolkata')::date + 30)::int as soon,
             count(*)::int as total
        from cur`);
    const r = rows[0] ?? { expired: 0, soon: 0, total: 0 };
    const badges: ModuleSummary["badges"] = [];
    if (r.expired) badges.push({ text: `${r.expired} expired`, tone: "danger" });
    if (r.soon) badges.push({ text: `${r.soon} expiring soon`, tone: "warn" });
    badges.push({ text: `${r.total} document${r.total === 1 ? "" : "s"}`, tone: r.expired || r.soon ? "info" : "ok" });
    return { badges };
  });
}

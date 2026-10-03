// Launcher tile numbers (CLAUDE.md "Launcher tiles"): read live each time a launcher opens, never stored.
import { and, count, eq, sql } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { schema, withTenant } from "./db";

const { batches, entries, entryVersions } = schema;

/** Up to 3 badges: on hold (red), awaiting approval (owner), tests today. */
export function summaryFor(tenantId: string, view: SummaryView): Promise<ModuleSummary> {
  return withTenant(tenantId, async (tx) => {
    const byStatus = await tx
      .select({ status: batches.status, n: count() })
      .from(batches)
      .where(eq(batches.tenantId, tenantId))
      .groupBy(batches.status);
    const n = (s: string) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);
    const [today] = await tx
      .select({ n: sql<number>`count(distinct ${entries.id})::int` })
      .from(entries)
      .innerJoin(entryVersions, and(eq(entryVersions.entryId, entries.id), eq(entryVersions.version, 1)))
      .where(
        and(
          eq(entries.tenantId, tenantId),
          sql`(${entryVersions.testedAt} at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`,
        ),
      );

    const badges: ModuleSummary["badges"] = [];
    if (n("on_hold")) badges.push({ text: `${n("on_hold")} on hold`, tone: "danger" });
    if (view === "owner" && n("pending")) badges.push({ text: `${n("pending")} awaiting approval`, tone: "warn" });
    badges.push({ text: `${today?.n ?? 0} test${today?.n === 1 ? "" : "s"} today`, tone: today?.n ? "ok" : "info" });
    return { badges };
  });
}

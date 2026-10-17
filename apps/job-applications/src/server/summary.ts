// The launcher tile's numbers (CLAUDE.md "Launcher tiles"; docs/JOB_APPLICATIONS_PHASE_PLAN.md "Launcher tile"):
//   "N new" (warn when one has waited unopened over 3 days) · "N this week" · owner: "Public page has no openings".
import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import type { ModuleSummary, SummaryView } from "@plantops/types";
import { schema, withTenant } from "./db";

const DAY = 86_400_000;
const { applications, openings } = schema;

export async function summaryFor(tenantId: string, view: SummaryView, now = new Date()): Promise<ModuleSummary> {
  return withTenant(tenantId, async (tx) => {
    const n = async (where: ReturnType<typeof and>) => Number((await tx.select({ n: count() }).from(applications).where(where))[0]?.n ?? 0);
    const mine = eq(applications.tenantId, tenantId);
    const fresh = await n(and(mine, eq(applications.status, "new")));
    const waiting = await n(and(mine, eq(applications.status, "new"), isNull(applications.seenAt), lt(applications.createdAt, new Date(now.getTime() - 3 * DAY))));
    const week = await n(and(mine, gte(applications.createdAt, new Date(now.getTime() - 7 * DAY))));
    const badges: ModuleSummary["badges"] = [fresh ? { text: `${fresh} new`, tone: waiting ? "warn" : "info" } : { text: "No new applications", tone: "ok" }];
    if (week) badges.push({ text: `${week} this week`, tone: "info" });
    if (view === "owner") {
      const [open] = await tx.select({ n: count() }).from(openings).where(and(eq(openings.tenantId, tenantId), eq(openings.status, "active")));
      if (!Number(open?.n ?? 0)) badges.push({ text: "Public page has no openings", tone: "info" });
    }
    return { badges: badges.slice(0, 3) };
  });
}

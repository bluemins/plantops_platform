// Search inside Lab Records (owner, lab staff; super_admin read-only in step 8). Limited to the plan's
// history window; older records stay stored and come back on upgrade.
import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "./db";
import { loadEntries, type EntryView } from "./entries";
import { historyCutoff } from "./history";
import type { BatchSummary } from "./batches";
import type { LabUser } from "./session";

const { batches, entries } = schema;
const LIMIT = 200;

export const SearchInput = z.object({
  kind: z.enum(["batches", "records"]).default("records"),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  batch_no: z.string().trim().max(40).optional(),
  form: z.enum(["daily", "form1", "form2", "form3", "form4"]).optional().catch(undefined),
  status: z.enum(["pending", "on_hold", "approved", "rejected"]).optional().catch(undefined),
  verdict: z.enum(["pass", "fail", "none"]).optional().catch(undefined),
});
export type SearchInput = z.infer<typeof SearchInput>;

export type SearchResult =
  | { kind: "batches"; cutoff: string | null; capped: boolean; batches: BatchSummary[] }
  | { kind: "records"; cutoff: string | null; capped: boolean; records: EntryView[] };

const like = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const istDate = (col: unknown) => sql`(${col} at time zone 'Asia/Kolkata')::date`;

export async function search(user: LabUser, q: SearchInput): Promise<SearchResult> {
  const cutoff = await historyCutoff(user.tenantId);
  const from = cutoff && (!q.from || q.from < cutoff) ? cutoff : q.from;

  return withTenant(user.tenantId, async (tx) => {
    if (q.kind === "batches") {
      const conds = [eq(batches.tenantId, user.tenantId)];
      if (from) conds.push(gte(batches.productionDate, from));
      if (q.to) conds.push(lte(batches.productionDate, q.to));
      if (q.batch_no) conds.push(ilike(batches.batchNo, like(q.batch_no)));
      if (q.status) conds.push(eq(batches.status, q.status));
      const rows = await tx
        .select({ b: batches, tests: sql<number>`(select count(*)::int from lab_records.entries e where e.batch_id = ${batches.id})` })
        .from(batches)
        .where(and(...conds))
        .orderBy(desc(batches.productionDate), desc(batches.createdAt))
        .limit(LIMIT + 1);
      const list = rows.slice(0, LIMIT).map(({ b, tests }) => ({
        id: b.id,
        batch_no: b.batchNo,
        production_date: b.productionDate,
        product_name: b.productName,
        status: b.status,
        held_since: b.heldSince?.toISOString() ?? null,
        tests: Number(tests),
        created_by_name: b.createdByName,
      }));
      return { kind: "batches", cutoff, capped: rows.length > LIMIT, batches: list };
    }

    // Records: filter on each entry's CURRENT (latest) version.
    const latest = sql`(select v.tested_at from lab_records.entry_versions v where v.entry_id = ${entries.id} order by v.version desc limit 1)`;
    const latestVerdict = sql`(select v.verdict from lab_records.entry_versions v where v.entry_id = ${entries.id} order by v.version desc limit 1)`;
    const conds = [eq(entries.tenantId, user.tenantId)];
    if (from) conds.push(sql`${istDate(latest)} >= ${from}::date`);
    if (q.to) conds.push(sql`${istDate(latest)} <= ${q.to}::date`);
    if (q.form) conds.push(eq(entries.form, q.form));
    if (q.verdict) conds.push(sql`${latestVerdict} = ${q.verdict}`);
    if (q.batch_no) conds.push(ilike(batches.batchNo, like(q.batch_no)));
    if (q.status) conds.push(eq(batches.status, q.status));
    const ids = await tx
      .select({ id: entries.id, at: latest })
      .from(entries)
      .leftJoin(batches, and(eq(batches.id, entries.batchId), eq(batches.tenantId, entries.tenantId)))
      .where(and(...conds))
      .orderBy(desc(latest))
      .limit(LIMIT + 1);
    const records = await loadEntries(tx, user.tenantId, { ids: ids.slice(0, LIMIT).map((r) => r.id) });
    records.sort((a, b) => b.current.tested_at.localeCompare(a.current.tested_at));
    return { kind: "records", cutoff, capped: ids.length > LIMIT, records };
  });
}

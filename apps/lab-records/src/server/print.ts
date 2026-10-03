// Printable FSSAI registers (step 7): one form, one date range, oldest first, in the sheet's layout.
// Only what the plan's history window shows; every row is the record's current version.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FormId } from "@/lib/forms";
import { schema, withTenant } from "./db";
import { loadEntries, type EntryView } from "./entries";
import { historyCutoff } from "./history";
import type { LabUser } from "./session";

const { batches, entries } = schema;

const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Default range: the current calendar month. */
export function defaultRange() {
  const today = istToday();
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export type PrintRow = EntryView & { production_date: string | null };

export async function printRows(user: LabUser, form: FormId, range: { from: string; to: string }) {
  const cutoff = await historyCutoff(user.tenantId);
  const from = cutoff && range.from < cutoff ? cutoff : range.from;
  const rows = await withTenant(user.tenantId, async (tx) => {
    const latest = sql`(select v.tested_at from lab_records.entry_versions v where v.entry_id = ${entries.id} order by v.version desc limit 1)`;
    const ids = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.tenantId, user.tenantId),
          eq(entries.form, form),
          sql`(${latest} at time zone 'Asia/Kolkata')::date between ${from}::date and ${range.to}::date`,
        ),
      )
      .limit(2000);
    const list = await loadEntries(tx, user.tenantId, { ids: ids.map((r) => r.id) });
    const batchIds = [...new Set(list.map((e) => e.batch_id).filter((x): x is string => !!x))];
    const dates = batchIds.length
      ? await tx.select({ id: batches.id, d: batches.productionDate }).from(batches).where(and(eq(batches.tenantId, user.tenantId), inArray(batches.id, batchIds)))
      : [];
    return list.map((e): PrintRow => ({ ...e, production_date: dates.find((d) => d.id === e.batch_id)?.d ?? null }));
  });
  rows.sort((a, b) => a.current.tested_at.localeCompare(b.current.tested_at) || a.created_at.localeCompare(b.created_at));
  return { rows, from, to: range.to, cutoff };
}

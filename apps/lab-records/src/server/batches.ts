// Batches: Lab Records owns the batch record (CLAUDE.md). Other modules store batch_id as a plain reference.
// Status: pending -> (on_hold) -> approved | rejected. Holds, approval and rejection arrive in step 4.
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { pgCode } from "./audit";
import { schema, withTenant } from "./db";
import { requireEnter } from "./guards";
import { badRequest, conflict, hiddenByPlan, notFound } from "./http";
import { historyCutoff, visible } from "./history";
import { batchAlerts, type AlertView } from "./alerts";
import { approvalCheck, listCorrective, type ApprovalCheck } from "./approval";
import { loadEntries, type EntryView } from "./entries";
import { productLabel, products } from "./platform";
import type { BatchStatus } from "./schema";
import type { LabUser } from "./session";

const { batches, batchEvents, entries, entryVersions } = schema;

export type BatchSummary = {
  id: string;
  batch_no: string;
  production_date: string;
  product_name: string | null;
  status: BatchStatus;
  held_since: string | null;
  tests: number;
  created_by_name: string;
};

export type BatchEventView = { event: string; by_name: string; note: string | null; at: string };
export type CorrectiveView = { id: string; note: string; by_name: string; at: string };
export type BatchDetail = BatchSummary & {
  created_at: string;
  events: BatchEventView[];
  entries: EntryView[];
  check: ApprovalCheck;
  corrective: CorrectiveView[];
  alerts: AlertView[];
};

const summary = (b: typeof batches.$inferSelect, tests: number): BatchSummary => ({
  id: b.id,
  batch_no: b.batchNo,
  production_date: b.productionDate,
  product_name: b.productName,
  status: b.status,
  held_since: b.heldSince?.toISOString() ?? null,
  tests,
  created_by_name: b.createdByName,
});

/** Today's date in India, as YYYY-MM-DD. */
export const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export const CreateBatchInput = z.object({
  batch_no: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/_.-]{1,40}$/, "Use letters, numbers and - / _ . only (up to 40)"),
  production_date: z.iso.date(),
  sku_id: z.uuid().nullable().optional(),
});

export function createBatch(user: LabUser, input: z.infer<typeof CreateBatchInput>) {
  requireEnter(user);
  if (input.production_date > todayIst()) throw badRequest("The production date can't be in the future");
  return (async () => {
    let productName: string | null = null;
    if (input.sku_id) {
      const sku = (await products(user.tenantId)).find((s) => s.id === input.sku_id && s.status === "active");
      if (!sku) throw badRequest("Pick one of the plant's active products");
      productName = productLabel(sku);
    }
    return withTenant(user.tenantId, async (tx) => {
      try {
        const [row] = await tx
          .insert(batches)
          .values({
            tenantId: user.tenantId,
            batchNo: input.batch_no,
            productionDate: input.production_date,
            skuId: input.sku_id ?? null,
            productName,
            createdBy: user.userId,
            createdByName: user.name,
          })
          .returning();
        await tx.insert(batchEvents).values({ tenantId: user.tenantId, batchId: row!.id, event: "created", byUser: user.userId, byName: user.name });
        return summary(row!, 0);
      } catch (err) {
        if (pgCode(err) === "23505") throw conflict(`Batch ${input.batch_no} already exists`);
        throw err;
      }
    });
  })();
}

/** Recent batches (newest production date first), with how many tests each has. */
export async function listBatches(user: LabUser, opts: { limit?: number; statuses?: BatchStatus[] } = {}) {
  const cutoff = await historyCutoff(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const conds = [eq(batches.tenantId, user.tenantId)];
    if (cutoff) conds.push(gte(batches.productionDate, cutoff));
    if (opts.statuses?.length) conds.push(inArray(batches.status, opts.statuses));
    const rows = await tx
      .select({ b: batches, tests: count(entries.id) })
      .from(batches)
      .leftJoin(entries, and(eq(entries.batchId, batches.id), eq(entries.tenantId, batches.tenantId)))
      .where(and(...conds))
      .groupBy(batches.id)
      .orderBy(desc(batches.productionDate), desc(batches.createdAt))
      .limit(opts.limit ?? 30);
    return rows.map((r) => summary(r.b, Number(r.tests)));
  });
}

export async function getBatch(user: LabUser, id: string): Promise<BatchDetail> {
  const cutoff = await historyCutoff(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const [b] = await tx.select().from(batches).where(and(eq(batches.tenantId, user.tenantId), eq(batches.id, id)));
    if (!b) throw notFound("Batch not found");
    if (!visible(cutoff, b.productionDate)) throw hiddenByPlan();
    const events = await tx
      .select()
      .from(batchEvents)
      .where(and(eq(batchEvents.tenantId, user.tenantId), eq(batchEvents.batchId, id)))
      .orderBy(asc(batchEvents.at), asc(batchEvents.id));
    const list = await loadEntries(tx, user.tenantId, { batchId: id });
    const notes = await listCorrective(tx, user.tenantId, id);
    return {
      ...summary(b, list.length),
      created_at: b.createdAt.toISOString(),
      events: events.map((e) => ({ event: e.event, by_name: e.byName, note: e.note, at: e.at.toISOString() })),
      entries: list,
      check: await approvalCheck(tx, user.tenantId, b, list),
      corrective: notes.map((n) => ({ id: n.id, note: n.note, by_name: n.byName, at: n.at.toISOString() })),
    };
  }).then(async (d) => ({ ...d, alerts: await batchAlerts(user.tenantId, id) }));
}

/** Tests entered today (India time), newest first, with the batch number if any - for the home screen. */
export function todaysTests(user: LabUser) {
  return withTenant(user.tenantId, async (tx) => {
    const ids = await tx
      .selectDistinct({ id: entries.id, createdAt: entries.createdAt })
      .from(entries)
      .innerJoin(entryVersions, eq(entryVersions.entryId, entries.id))
      .where(
        and(
          eq(entries.tenantId, user.tenantId),
          eq(entries.form, "daily"),
          sql`(${entryVersions.testedAt} at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`,
        ),
      )
      .orderBy(desc(entries.createdAt))
      .limit(50);
    const list = await loadEntries(tx, user.tenantId, { ids: ids.map((r) => r.id) });
    const batchIds = [...new Set(list.map((e) => e.batch_id).filter((x): x is string => !!x))];
    const nos = batchIds.length
      ? await tx.select({ id: batches.id, no: batches.batchNo }).from(batches).where(and(eq(batches.tenantId, user.tenantId), inArray(batches.id, batchIds)))
      : [];
    return list.map((e) => ({ ...e, batch_no: nos.find((n) => n.id === e.batch_id)?.no ?? null }));
  });
}

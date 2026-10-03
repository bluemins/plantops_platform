// Batch hold, release, approval and rejection (CLAUDE.md "Data rules", plan §4):
//   any failed result on a batch -> ON HOLD automatically (system), alert to owner + lab leads;
//   release (owner / lab lead) needs a corrective-action note AND every current test on the batch passing;
//   approve (owner / lab lead) only when pending, with at least one test and nothing failing;
//   reject (owner / lab lead) closes a batch for good, with a reason. Every step is a batch_events row.
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { FORMS } from "@/lib/forms";
import { limitText } from "@/lib/verdict";
import { notifyBatchDecision } from "./alerts";
import { audit } from "./audit";
import { schema, withTenant, type LabTx } from "./db";
import { loadEntries, type EntryView } from "./entries";
import { actorOf, requireApprover } from "./guards";
import { badRequest, conflict, forbidden, notFound } from "./http";
import type { LabUser } from "./session";

const { batches, batchEvents, correctiveActions, entries } = schema;

export type HoldNotice = { batchId: string; batchNo: string; reason: string; wasApproved: boolean };

/** "TDS 620 mg/L (max 500), pH 9.1 (6.5 – 8.5)" - what failed, for the hold note and the alert. */
export function failureText(entry: EntryView) {
  const failed = entry.current.results.filter((r) => r.verdict === "fail");
  if (!failed.length) return `${FORMS[entry.form].short}: outcome Fail`;
  return failed.map((r) => `${r.name} ${r.value}${r.unit ? ` ${r.unit}` : ""} (${limitText(r.limit_min, r.limit_max)})`).join(", ");
}

/** Locks the batch row for this transaction, so two saves can't change its status at the same time. */
async function lockBatch(tx: LabTx, tenantId: string, batchId: string) {
  const [b] = await tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).for("update");
  if (!b) throw notFound("Batch not found");
  return b;
}

/**
 * Called in the same transaction that saved a failing result. Puts the batch on hold (also an approved one:
 * a late failure stops dispatch again). Already on hold: nothing new (the plant was alerted already).
 */
export async function holdOnFailure(tx: LabTx, tenantId: string, batchId: string, entry: EntryView): Promise<HoldNotice | null> {
  const b = await lockBatch(tx, tenantId, batchId);
  if (b.status === "on_hold" || b.status === "rejected") return null;
  const reason = failureText(entry);
  await tx.update(batches).set({ status: "on_hold", heldSince: new Date(), updatedAt: new Date() }).where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
  await tx.insert(batchEvents).values({ tenantId, batchId, event: "held", byUser: null, byName: "System (failed test)", note: reason, entryId: entry.id });
  return { batchId, batchNo: b.batchNo, reason, wasApproved: b.status === "approved" };
}

export type ApprovalCheck = {
  /** daily tests + Form 1 records on the batch */
  tests: number;
  /** checks whose MOST RECENT result on this batch fails, e.g. "TDS 620 mg/L (max 500)" */
  failing: string[];
  /** a corrective-action note written since the batch went on hold */
  correctiveSinceHold: boolean;
};

/**
 * Per check (parameter), the most recent result on the batch decides: a passing retest of TDS clears TDS,
 * while the failed entry itself stays on record unchanged. Each entry counts with its current version.
 */
export function stillFailing(list: EntryView[]) {
  const latest = new Map<string, { at: string; created: string; text: string; fail: boolean }>();
  for (const e of list) {
    if (e.form !== "daily" && e.form !== "form1") continue;
    for (const r of e.current.results) {
      const prev = latest.get(r.parameter_id);
      const newer = !prev || e.current.tested_at > prev.at || (e.current.tested_at === prev.at && e.created_at > prev.created);
      if (newer) {
        latest.set(r.parameter_id, {
          at: e.current.tested_at,
          created: e.created_at,
          text: `${r.name} ${r.value}${r.unit ? ` ${r.unit}` : ""} (${limitText(r.limit_min, r.limit_max)})`,
          fail: r.verdict === "fail",
        });
      }
    }
  }
  return [...latest.values()].filter((v) => v.fail).map((v) => v.text);
}

/** What stands between this batch and the next step (shown on the batch page, enforced below). */
export async function approvalCheck(tx: LabTx, tenantId: string, batch: typeof batches.$inferSelect, list: EntryView[]): Promise<ApprovalCheck> {
  const tests = list.filter((e) => e.form === "daily" || e.form === "form1");
  const notes = batch.heldSince
    ? await tx
        .select({ id: correctiveActions.id })
        .from(correctiveActions)
        .where(and(eq(correctiveActions.tenantId, tenantId), eq(correctiveActions.batchId, batch.id), gte(correctiveActions.at, batch.heldSince)))
        .limit(1)
    : [];
  return { tests: tests.length, failing: stillFailing(list), correctiveSinceHold: notes.length > 0 };
}

const currentEntries = (tx: LabTx, tenantId: string, batchId: string) => loadEntries(tx, tenantId, { batchId });

// ---------- actions ----------

export const CorrectiveInput = z.object({
  note: z.string().trim().min(5, "Describe what was done (at least a few words)").max(1000),
  entry_id: z.uuid().nullable().optional(),
});
export const ReleaseInput = z.object({ note: z.string().trim().max(500).optional() });
export const RejectInput = z.object({ reason: z.string().trim().min(5, "Say why the batch is rejected (e.g. discarded 2,000 L)").max(500) });

/** What was done about a failure ("RO membrane flushed"). Lab staff, lab lead or owner. */
export async function addCorrectiveAction(user: LabUser, batchId: string, input: z.infer<typeof CorrectiveInput>) {
  if (!user.canEnter && !user.canApprove) throw forbidden();
  return withTenant(user.tenantId, async (tx) => {
    const b = await lockBatch(tx, user.tenantId, batchId);
    if (b.status === "rejected") throw conflict("This batch is rejected");
    if (input.entry_id) {
      const [e] = await tx.select({ id: entries.id }).from(entries).where(and(eq(entries.tenantId, user.tenantId), eq(entries.id, input.entry_id), eq(entries.batchId, batchId)));
      if (!e) throw badRequest("That test is not part of this batch");
    }
    const [row] = await tx
      .insert(correctiveActions)
      .values({ tenantId: user.tenantId, batchId, entryId: input.entry_id ?? null, note: input.note, byUser: user.userId, byName: user.name })
      .returning();
    return { id: row!.id, note: row!.note, by_name: row!.byName, at: row!.at.toISOString() };
  });
}

/** On hold -> pending. Needs a corrective-action note since the hold and nothing failing any more. */
export async function releaseHold(user: LabUser, batchId: string, input: z.infer<typeof ReleaseInput>) {
  requireApprover(user);
  return withTenant(user.tenantId, async (tx) => {
    const b = await lockBatch(tx, user.tenantId, batchId);
    if (b.status !== "on_hold") throw conflict("This batch is not on hold");
    const check = await approvalCheck(tx, user.tenantId, b, await currentEntries(tx, user.tenantId, batchId));
    if (!check.correctiveSinceHold) throw conflict("Write a corrective-action note first (what was done about the failure)");
    if (check.failing.length) throw conflict(`Still failing: ${check.failing.join("; ")}. Add a passing retest first.`);
    await tx.update(batches).set({ status: "pending", heldSince: null, updatedAt: new Date() }).where(eq(batches.id, batchId));
    await tx.insert(batchEvents).values({ tenantId: user.tenantId, batchId, event: "released", byUser: user.userId, byName: user.name, note: input.note || null });
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "batch.released", target: batchId, details: { batch_no: b.batchNo } });
    return { status: "pending" as const };
  });
}

/** Pending -> approved for production (and later dispatch). */
export async function approveBatch(user: LabUser, batchId: string) {
  requireApprover(user);
  const result = await withTenant(user.tenantId, async (tx) => {
    const b = await lockBatch(tx, user.tenantId, batchId);
    if (b.status === "on_hold") throw conflict("This batch is on hold: release the hold first");
    if (b.status !== "pending") throw conflict(`This batch is already ${b.status}`);
    const check = await approvalCheck(tx, user.tenantId, b, await currentEntries(tx, user.tenantId, batchId));
    if (!check.tests) throw conflict("Add at least one test before approving");
    if (check.failing.length) throw conflict(`Can't approve while a test fails: ${check.failing.join("; ")}`);
    await tx.update(batches).set({ status: "approved", updatedAt: new Date() }).where(eq(batches.id, batchId));
    await tx.insert(batchEvents).values({ tenantId: user.tenantId, batchId, event: "approved", byUser: user.userId, byName: user.name });
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "batch.approved", target: batchId, details: { batch_no: b.batchNo } });
    return { status: "approved" as const, batchNo: b.batchNo };
  });
  return { status: result.status };
}

/** Pending or on hold -> rejected, for good (discarded, sent for reprocessing). All records stay. */
export async function rejectBatch(user: LabUser, batchId: string, input: z.infer<typeof RejectInput>) {
  requireApprover(user);
  const result = await withTenant(user.tenantId, async (tx) => {
    const b = await lockBatch(tx, user.tenantId, batchId);
    if (b.status === "approved") throw conflict("An approved batch can't be rejected. If it later fails a test it goes on hold first.");
    if (b.status === "rejected") throw conflict("This batch is already rejected");
    await tx.update(batches).set({ status: "rejected", heldSince: null, updatedAt: new Date() }).where(eq(batches.id, batchId));
    await tx.insert(batchEvents).values({ tenantId: user.tenantId, batchId, event: "rejected", byUser: user.userId, byName: user.name, note: input.reason });
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "batch.rejected", target: batchId, details: { batch_no: b.batchNo, reason: input.reason } });
    return { batchNo: b.batchNo };
  });
  await notifyBatchDecision(user.tenantId, { batchId, batchNo: result.batchNo, text: `Batch ${result.batchNo} REJECTED by ${user.name}: ${input.reason}` });
  return { status: "rejected" as const };
}

/** Corrective notes on a batch, newest first. */
export function listCorrective(tx: LabTx, tenantId: string, batchId: string) {
  return tx
    .select()
    .from(correctiveActions)
    .where(and(eq(correctiveActions.tenantId, tenantId), eq(correctiveActions.batchId, batchId)))
    .orderBy(desc(correctiveActions.at));
}


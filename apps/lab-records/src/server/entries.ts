// Lab entries (daily tests now; FSSAI Forms 1-4 use the same tables). APPEND-ONLY (CLAUDE.md "Data rules"):
//   * saving creates version 1 and locks it - there are no drafts and nothing is ever overwritten;
//   * a correction is a new version of the same entry, with who / when / why; earlier versions stay;
//   * a retest is a new entry; the failed one stays on record.
// The database enforces it too: lab_app has no UPDATE or DELETE on these tables.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { pgCode } from "./audit";
import { schema, withTenant, type LabTx } from "./db";
import { requireEnter } from "./guards";
import { badRequest, conflict, notFound } from "./http";
import { Decimal } from "./parameters";
import type { EntryForm, Verdict } from "./schema";
import type { LabUser } from "./session";
import { judge, overall } from "@/lib/verdict";

const { batches, entries, entryVersions, entryResults, parameters, verifications } = schema;

// ---------- reading ----------

export type ResultView = {
  parameter_id: string;
  name: string;
  unit: string | null;
  value: string;
  limit_min: string | null;
  limit_max: string | null;
  verdict: Verdict;
};
export type VersionView = {
  id: string;
  version: number;
  verdict: Verdict;
  tested_at: string;
  entered_by_name: string;
  entered_at: string;
  reason: string | null;
  remark: string;
  data: Record<string, unknown>;
  results: ResultView[];
  verified: { by: string; at: string } | null;
};
export type EntryView = {
  id: string;
  form: EntryForm;
  batch_id: string | null;
  created_at: string;
  /** oldest first; the last one is what screens and prints show */
  versions: VersionView[];
  current: VersionView;
};

/** Entries with all their versions, results and verifications, newest entry first. */
export async function loadEntries(tx: LabTx, tenantId: string, where: { batchId?: string; ids?: string[]; form?: EntryForm; limit?: number }) {
  const conds = [eq(entries.tenantId, tenantId)];
  if (where.batchId) conds.push(eq(entries.batchId, where.batchId));
  if (where.ids) conds.push(inArray(entries.id, where.ids.length ? where.ids : ["00000000-0000-0000-0000-000000000000"]));
  if (where.form) conds.push(eq(entries.form, where.form));
  const entryRows = await tx
    .select()
    .from(entries)
    .where(and(...conds))
    .orderBy(desc(entries.createdAt))
    .limit(where.limit ?? 500);
  if (!entryRows.length) return [];

  const versions = await tx
    .select()
    .from(entryVersions)
    .where(and(eq(entryVersions.tenantId, tenantId), inArray(entryVersions.entryId, entryRows.map((e) => e.id))))
    .orderBy(asc(entryVersions.version));
  const versionIds = versions.map((v) => v.id);
  const results = versionIds.length
    ? await tx
        .select({ r: entryResults, sort: parameters.sort })
        .from(entryResults)
        .innerJoin(parameters, eq(parameters.id, entryResults.parameterId))
        .where(and(eq(entryResults.tenantId, tenantId), inArray(entryResults.versionId, versionIds)))
        .orderBy(asc(parameters.sort))
    : [];
  const checks = versionIds.length
    ? await tx.select().from(verifications).where(and(eq(verifications.tenantId, tenantId), inArray(verifications.versionId, versionIds)))
    : [];

  const toVersion = (v: typeof entryVersions.$inferSelect): VersionView => {
    const check = checks.find((c) => c.versionId === v.id);
    return {
      id: v.id,
      version: v.version,
      verdict: v.verdict,
      tested_at: v.testedAt.toISOString(),
      entered_by_name: v.enteredByName,
      entered_at: v.enteredAt.toISOString(),
      reason: v.reason,
      remark: typeof v.data.remark === "string" ? v.data.remark : "",
      data: v.data,
      results: results
        .filter(({ r }) => r.versionId === v.id)
        .map(({ r }) => ({
          parameter_id: r.parameterId,
          name: r.parameterName,
          unit: r.unit,
          value: r.value,
          limit_min: r.limitMin,
          limit_max: r.limitMax,
          verdict: r.verdict,
        })),
      verified: check ? { by: check.verifiedByName, at: check.verifiedAt.toISOString() } : null,
    };
  };

  return entryRows.map((e): EntryView => {
    const vs = versions.filter((v) => v.entryId === e.id).map(toVersion);
    return { id: e.id, form: e.form, batch_id: e.batchId, created_at: e.createdAt.toISOString(), versions: vs, current: vs[vs.length - 1]! };
  });
}

export async function getEntry(user: LabUser, id: string) {
  return withTenant(user.tenantId, async (tx) => {
    const [entry] = await loadEntries(tx, user.tenantId, { ids: [id] });
    if (!entry) throw notFound("Entry not found");
    return entry;
  });
}

// ---------- writing ----------

const MAX_FUTURE_MS = 5 * 60_000; // a phone clock a few minutes ahead is fine
const MAX_PAST_DAYS = 30;

const ResultInput = z.object({ parameter_id: z.uuid(), value: Decimal });
const Remark = z.string().trim().max(500).optional();
const TestedAt = z.iso.datetime({ offset: true }).optional();

export const DailyEntryInput = z.object({
  batch_id: z.uuid().nullable().optional(),
  tested_at: TestedAt,
  remark: Remark,
  results: z.array(ResultInput).min(1, "Enter at least one result").max(50),
});

export const CorrectionInput = z.object({
  reason: z.string().trim().min(3, "Say why you are correcting this (at least a few words)").max(500),
  tested_at: TestedAt,
  remark: Remark,
  results: z.array(ResultInput).min(1).max(50),
});

function testedAt(value: string | undefined, fallback: Date) {
  const at = value ? new Date(value) : fallback;
  const now = Date.now();
  if (at.getTime() > now + MAX_FUTURE_MS) throw badRequest("The test time can't be in the future");
  if (at.getTime() < now - MAX_PAST_DAYS * 86_400_000) throw badRequest(`The test time can't be more than ${MAX_PAST_DAYS} days ago`);
  return at;
}

function noDuplicates(results: { parameter_id: string }[]) {
  if (new Set(results.map((r) => r.parameter_id)).size !== results.length) throw badRequest("A parameter appears twice");
}

/** Saves a daily in-house test as version 1, locked. Each value is judged against the plant's current limit. */
export function createDailyEntry(user: LabUser, input: z.infer<typeof DailyEntryInput>) {
  requireEnter(user);
  noDuplicates(input.results);
  const at = testedAt(input.tested_at, new Date());
  return withTenant(user.tenantId, async (tx) => {
    if (input.batch_id) {
      const [batch] = await tx.select().from(batches).where(and(eq(batches.tenantId, user.tenantId), eq(batches.id, input.batch_id)));
      if (!batch) throw notFound("Batch not found");
      if (batch.status === "rejected") throw conflict(`Batch ${batch.batchNo} was rejected; no more tests can be added`);
    }
    const params = await tx
      .select()
      .from(parameters)
      .where(and(eq(parameters.tenantId, user.tenantId), eq(parameters.kind, "daily"), inArray(parameters.id, input.results.map((r) => r.parameter_id))));
    const results = input.results.map((r) => {
      const p = params.find((x) => x.id === r.parameter_id);
      if (!p || !p.active) throw badRequest("One of the checks is not an active daily check for this plant");
      return { parameterId: p.id, parameterName: p.name, unit: p.unit, value: r.value, limitMin: p.limitMin, limitMax: p.limitMax, verdict: judge(r.value, p.limitMin, p.limitMax) };
    });

    const [entry] = await tx
      .insert(entries)
      .values({ tenantId: user.tenantId, form: "daily", batchId: input.batch_id ?? null, createdBy: user.userId })
      .returning();
    await insertVersion(tx, user, entry!.id, 1, { reason: null, testedAt: at, data: { remark: input.remark ?? "" }, results });
    const [view] = await loadEntries(tx, user.tenantId, { ids: [entry!.id] });
    return view!;
  });
}

/**
 * A correction (e.g. a typing mistake): a new version of the same entry with a reason. Same checks as the
 * original; each keeps the limit that applied when it was first tested. Earlier versions stay on record.
 */
export function correctEntry(user: LabUser, entryId: string, input: z.infer<typeof CorrectionInput>) {
  requireEnter(user);
  noDuplicates(input.results);
  return withTenant(user.tenantId, async (tx) => {
    const [entry] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    if (!entry) throw notFound("Entry not found");
    const prev = entry.current;
    if (input.results.length !== prev.results.length || input.results.some((r) => !prev.results.some((p) => p.parameter_id === r.parameter_id))) {
      throw badRequest("A correction has the same checks as the original entry. For a new test, add a new entry (retest).");
    }
    const results = prev.results.map((p) => {
      const value = input.results.find((r) => r.parameter_id === p.parameter_id)!.value;
      return { parameterId: p.parameter_id, parameterName: p.name, unit: p.unit, value, limitMin: p.limit_min, limitMax: p.limit_max, verdict: judge(value, p.limit_min, p.limit_max) };
    });
    const at = testedAt(input.tested_at, new Date(prev.tested_at));
    const remark = input.remark ?? prev.remark;
    const unchanged =
      remark === prev.remark && at.getTime() === new Date(prev.tested_at).getTime() && results.every((r) => Number(r.value) === Number(prev.results.find((p) => p.parameter_id === r.parameterId)!.value));
    if (unchanged) throw badRequest("Nothing was changed");

    try {
      await insertVersion(tx, user, entryId, prev.version + 1, { reason: input.reason, testedAt: at, data: { ...prev.data, remark }, results });
    } catch (err) {
      // Two people correcting the same entry at once: the second one must look again first.
      if (pgCode(err) === "23505") throw conflict("Someone else just corrected this entry. Please reload and check it again.");
      throw err;
    }
    const [view] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    return view!;
  });
}

type NewResult = { parameterId: string; parameterName: string; unit: string | null; value: string; limitMin: string | null; limitMax: string | null; verdict: Verdict };

async function insertVersion(
  tx: LabTx,
  user: LabUser,
  entryId: string,
  version: number,
  v: { reason: string | null; testedAt: Date; data: Record<string, unknown>; results: NewResult[] },
) {
  const [row] = await tx
    .insert(entryVersions)
    .values({
      tenantId: user.tenantId,
      entryId,
      version,
      data: v.data,
      reason: v.reason,
      verdict: overall(v.results.map((r) => r.verdict)),
      testedAt: v.testedAt,
      enteredBy: user.userId,
      enteredByName: user.name,
    })
    .returning();
  if (v.results.length) {
    await tx.insert(entryResults).values(v.results.map((r) => ({ ...r, tenantId: user.tenantId, versionId: row!.id })));
  }
  return row!;
}

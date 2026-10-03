// Lab entries: daily tests and FSSAI Forms 1-4. APPEND-ONLY (CLAUDE.md "Data rules"):
//   * saving creates version 1 and locks it - there are no drafts and nothing is ever overwritten;
//   * a correction is a new version of the same entry, with who / when / why; earlier versions stay;
//   * a retest is a new entry; the failed one stays on record.
// The database enforces it too: lab_app has no UPDATE or DELETE on these tables.
// A failed result on a batch puts the batch on hold (approval.ts) in the same transaction.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { FORMS, mainDateField, type FormDef, type FormId } from "@/lib/forms";
import { judge, overall, type Verdict } from "@/lib/verdict";
import { holdOnFailure, type HoldNotice } from "./approval";
import { notifyFormFailure, notifyHold } from "./alerts";
import { audit, pgCode } from "./audit";
import { schema, withTenant, type LabTx } from "./db";
import { actorOf, requireApprover, requireEnter } from "./guards";
import { badRequest, conflict, hiddenByPlan, notFound } from "./http";
import { historyCutoff, visible } from "./history";
import { Decimal } from "./parameters";
import type { EntryForm } from "./schema";
import type { LabUser } from "./session";

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
  batch_no: string | null;
  created_at: string;
  /** oldest first; the last one is what screens and prints show */
  versions: VersionView[];
  current: VersionView;
};

/** Entries with all their versions, results, verifications and batch numbers, newest entry first. */
export async function loadEntries(tx: LabTx, tenantId: string, where: { batchId?: string; ids?: string[]; form?: EntryForm; limit?: number }) {
  const conds = [eq(entries.tenantId, tenantId)];
  if (where.batchId) conds.push(eq(entries.batchId, where.batchId));
  if (where.ids) {
    if (!where.ids.length) return [];
    conds.push(inArray(entries.id, where.ids));
  }
  if (where.form) conds.push(eq(entries.form, where.form));
  const entryRows = await tx
    .select({ e: entries, batchNo: batches.batchNo })
    .from(entries)
    .leftJoin(batches, and(eq(batches.id, entries.batchId), eq(batches.tenantId, entries.tenantId)))
    .where(and(...conds))
    .orderBy(desc(entries.createdAt))
    .limit(where.limit ?? 1000);
  if (!entryRows.length) return [];

  const versions = await tx
    .select()
    .from(entryVersions)
    .where(and(eq(entryVersions.tenantId, tenantId), inArray(entryVersions.entryId, entryRows.map((r) => r.e.id))))
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

  return entryRows.map(({ e, batchNo }): EntryView => {
    const vs = versions.filter((v) => v.entryId === e.id).map(toVersion);
    return { id: e.id, form: e.form, batch_id: e.batchId, batch_no: batchNo, created_at: e.createdAt.toISOString(), versions: vs, current: vs[vs.length - 1]! };
  });
}

export async function getEntry(user: LabUser, id: string) {
  const cutoff = await historyCutoff(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const [entry] = await loadEntries(tx, user.tenantId, { ids: [id] });
    if (!entry) throw notFound("Entry not found");
    if (!visible(cutoff, entry.current.tested_at)) throw hiddenByPlan();
    return entry;
  });
}

/** Recent entries of one form (Forms screen), inside the plan's history window. */
export async function listEntries(user: LabUser, form: FormId, limit = 30) {
  const cutoff = await historyCutoff(user.tenantId);
  const list = await withTenant(user.tenantId, (tx) => loadEntries(tx, user.tenantId, { form, limit }));
  return list.filter((e) => visible(cutoff, e.current.tested_at));
}

// ---------- validation ----------

const DAILY_PAST_DAYS = 30;
/** Forms 1-4 often arrive with an outside lab report weeks later, or are copied in from paper records. */
const FORM_PAST_DAYS = 730;
const MAX_FUTURE_MS = 5 * 60_000; // a phone clock a few minutes ahead is fine

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
/** A form's date (YYYY-MM-DD) as a moment: noon in India, so it never slips to another day. */
const istNoon = (ymd: string) => new Date(`${ymd}T12:00:00+05:30`);

const fieldSchema = (type: string) => {
  switch (type) {
    case "date":
      return z.iso.date("Use a date like 2026-10-03");
    case "longtext":
      return z.string().trim().max(1000);
    case "outcome":
      return z.enum(["pass", "fail", "pending"]);
    case "source":
      return z.enum(["in_house", "outside"]);
    default:
      return z.string().trim().max(200);
  }
};

/** Checks a form's own fields (the sheet's columns) and returns them clean. */
export function parseFormData(def: FormDef, raw: Record<string, unknown> = {}) {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const value = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : raw[f.key];
    if (value === undefined || value === null || value === "") {
      if (f.required) throw badRequest(`${f.label}: required`);
      continue;
    }
    const parsed = fieldSchema(f.type).safeParse(value);
    if (!parsed.success) throw badRequest(`${f.label}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    if (f.type === "date" && parsed.data > todayIst()) throw badRequest(`${f.label}: can't be in the future`);
    out[f.key] = parsed.data;
  }
  if (def.id === "form1" && out.source === "outside" && (!out.lab_name || !out.report_no)) {
    throw badRequest("Tested at an outside lab: enter the lab name and report no.");
  }
  return out;
}

/** When the record happened: the form's main date, or the test time for a daily test. */
function testedAt(def: FormDef, data: Record<string, string>, given: string | undefined, fallback: Date) {
  const key = mainDateField(def.id);
  const at = key ? istNoon(data[key]!) : given ? new Date(given) : fallback;
  const now = Date.now();
  const maxPast = def.id === "daily" ? DAILY_PAST_DAYS : FORM_PAST_DAYS;
  if (at.getTime() > now + MAX_FUTURE_MS + (key ? 12 * 3_600_000 : 0)) throw badRequest("The test time can't be in the future");
  if (at.getTime() < now - maxPast * 86_400_000) throw badRequest(`Records older than ${maxPast} days can't be entered here`);
  return at;
}

const ResultInput = z.object({ parameter_id: z.uuid(), value: Decimal });
const Remark = z.string().trim().max(500).optional();
const TestedAt = z.iso.datetime({ offset: true }).optional();

export const EntryInput = z.object({
  form: z.enum(["daily", "form1", "form2", "form3", "form4"]).default("daily"),
  batch_id: z.uuid().nullable().optional(),
  tested_at: TestedAt,
  /** daily test shortcut for data.remark */
  remark: Remark,
  data: z.record(z.string(), z.unknown()).optional(),
  results: z.array(ResultInput).max(50).optional(),
});
/** Kept for the daily test screen and older callers. */
export const DailyEntryInput = EntryInput;

export const CorrectionInput = z.object({
  reason: z.string().trim().min(3, "Say why you are correcting this (at least a few words)").max(500),
  tested_at: TestedAt,
  remark: Remark,
  data: z.record(z.string(), z.unknown()).optional(),
  results: z.array(ResultInput).max(50).optional(),
});

function noDuplicates(results: { parameter_id: string }[]) {
  if (new Set(results.map((r) => r.parameter_id)).size !== results.length) throw badRequest("A parameter appears twice");
}

type NewResult = { parameterId: string; parameterName: string; unit: string | null; value: string; limitMin: string | null; limitMax: string | null; verdict: Verdict };

/** Forms 3 and 4 have a pass/fail outcome instead of numbers. */
const outcomeVerdict = (data: Record<string, string>): Verdict => (data.outcome === "pass" ? "pass" : data.outcome === "fail" ? "fail" : "none");

/** After saving: alerts go out once the transaction has committed (holds and Form 3/4 failures). */
async function afterSave(user: LabUser, hold: HoldNotice | null, entry: EntryView) {
  if (hold) await notifyHold(user.tenantId, hold);
  else if ((entry.form === "form3" || entry.form === "form4") && entry.current.verdict === "fail") {
    await notifyFormFailure(user.tenantId, entry);
  }
}

// ---------- writing ----------

/** Saves a daily test or a Form 1-4 record as version 1, locked. Results are judged against today's limits. */
export async function createEntry(user: LabUser, input: z.infer<typeof EntryInput>) {
  requireEnter(user);
  const def = FORMS[input.form];
  const data = parseFormData(def, { ...input.data, ...(input.remark !== undefined ? { remark: input.remark } : {}) });
  const at = testedAt(def, data, input.tested_at, new Date());
  const resultsIn = input.results ?? [];
  if (def.hasResults && !resultsIn.length) throw badRequest("Enter at least one result");
  if (!def.hasResults && resultsIn.length) throw badRequest("This form has no parameter results");
  if (def.batch === "required" && !input.batch_id) throw badRequest("Choose the batch");
  if (def.batch === "none" && input.batch_id) throw badRequest("This form is not linked to a batch");
  noDuplicates(resultsIn);

  const { entry, hold } = await withTenant(user.tenantId, async (tx) => {
    if (input.batch_id) {
      const [batch] = await tx.select().from(batches).where(and(eq(batches.tenantId, user.tenantId), eq(batches.id, input.batch_id)));
      if (!batch) throw notFound("Batch not found");
      if (batch.status === "rejected") throw conflict(`Batch ${batch.batchNo} was rejected; no more tests can be added`);
    }
    const kind = input.form === "form1" ? "form1" : "daily";
    const params = resultsIn.length
      ? await tx
          .select()
          .from(parameters)
          .where(and(eq(parameters.tenantId, user.tenantId), eq(parameters.kind, kind), inArray(parameters.id, resultsIn.map((r) => r.parameter_id))))
      : [];
    const results: NewResult[] = resultsIn.map((r) => {
      const p = params.find((x) => x.id === r.parameter_id);
      if (!p || !p.active) throw badRequest(`One of the values is not an active ${kind === "form1" ? "Form 1 parameter" : "daily check"} for this plant`);
      return { parameterId: p.id, parameterName: p.name, unit: p.unit, value: r.value, limitMin: p.limitMin, limitMax: p.limitMax, verdict: judge(r.value, p.limitMin, p.limitMax) };
    });

    const [row] = await tx
      .insert(entries)
      .values({ tenantId: user.tenantId, form: input.form, batchId: input.batch_id ?? null, createdBy: user.userId })
      .returning();
    const verdict = def.hasResults ? overall(results.map((r) => r.verdict)) : outcomeVerdict(data);
    await insertVersion(tx, user, row!.id, 1, { reason: null, testedAt: at, data, results, verdict });
    const [view] = await loadEntries(tx, user.tenantId, { ids: [row!.id] });
    const hold = input.batch_id && verdict === "fail" ? await holdOnFailure(tx, user.tenantId, input.batch_id, view!) : null;
    return { entry: view!, hold };
  });
  await afterSave(user, hold, entry);
  return entry;
}

/** The daily test screen's call (kept so step 3 callers and tests read naturally). */
export const createDailyEntry = (user: LabUser, input: Omit<z.infer<typeof EntryInput>, "form"> & { form?: FormId }) =>
  createEntry(user, { ...input, form: input.form ?? "daily" });

/**
 * A correction (e.g. a typing mistake): a new version of the same entry with a reason. Same parameters as the
 * original, each keeping the limit that applied when it was first tested. Earlier versions stay on record.
 * A correction never releases a hold; a correction that turns a batch test into a fail puts the batch on hold.
 */
export async function correctEntry(user: LabUser, entryId: string, input: z.infer<typeof CorrectionInput>) {
  requireEnter(user);
  const { entry, hold } = await withTenant(user.tenantId, async (tx) => {
    const [entry] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    if (!entry) throw notFound("Entry not found");
    const def = FORMS[entry.form];
    const prev = entry.current;

    let results: NewResult[] = [];
    if (def.hasResults) {
      const resultsIn = input.results ?? [];
      noDuplicates(resultsIn);
      if (resultsIn.length !== prev.results.length || resultsIn.some((r) => !prev.results.some((p) => p.parameter_id === r.parameter_id))) {
        throw badRequest("A correction has the same values as the original entry. For a new test, add a new entry (retest).");
      }
      results = prev.results.map((p) => {
        const value = resultsIn.find((r) => r.parameter_id === p.parameter_id)!.value;
        return { parameterId: p.parameter_id, parameterName: p.name, unit: p.unit, value, limitMin: p.limit_min, limitMax: p.limit_max, verdict: judge(value, p.limit_min, p.limit_max) };
      });
    } else if (input.results?.length) {
      throw badRequest("This form has no parameter results");
    }

    const merged = { ...prev.data, ...input.data, ...(input.remark !== undefined ? { remark: input.remark } : {}) };
    const data = parseFormData(def, merged);
    const at = testedAt(def, data, input.tested_at, new Date(prev.tested_at));
    const sameData = JSON.stringify(Object.entries(data).sort()) === JSON.stringify(Object.entries(parseFormData(def, prev.data)).sort());
    const sameResults = results.every((r) => Number(r.value) === Number(prev.results.find((p) => p.parameter_id === r.parameterId)!.value));
    if (sameData && sameResults && at.getTime() === new Date(prev.tested_at).getTime()) throw badRequest("Nothing was changed");

    const verdict = def.hasResults ? overall(results.map((r) => r.verdict)) : outcomeVerdict(data);
    try {
      await insertVersion(tx, user, entryId, prev.version + 1, { reason: input.reason, testedAt: at, data, results, verdict });
    } catch (err) {
      // Two people correcting the same entry at once: the second one must look again first.
      if (pgCode(err) === "23505") throw conflict("Someone else just corrected this entry. Please reload and check it again.");
      throw err;
    }
    const [view] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    const hold = entry.batch_id && verdict === "fail" ? await holdOnFailure(tx, user.tenantId, entry.batch_id, view!) : null;
    return { entry: view!, hold };
  });
  await afterSave(user, hold, entry);
  return entry;
}

async function insertVersion(
  tx: LabTx,
  user: LabUser,
  entryId: string,
  version: number,
  v: { reason: string | null; testedAt: Date; data: Record<string, unknown>; results: NewResult[]; verdict: Verdict },
) {
  const [row] = await tx
    .insert(entryVersions)
    .values({
      tenantId: user.tenantId,
      entryId,
      version,
      data: v.data,
      reason: v.reason,
      verdict: v.verdict,
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

// ---------- verification ("Verified By") ----------

/** Owner or lab lead confirms the current version of a record. A later correction needs verifying again. */
export async function verifyEntry(user: LabUser, entryId: string) {
  requireApprover(user);
  return withTenant(user.tenantId, async (tx) => {
    const [entry] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    if (!entry) throw notFound("Entry not found");
    if (entry.current.verified) throw conflict(`Already verified by ${entry.current.verified.by}`);
    try {
      await tx.insert(verifications).values({ tenantId: user.tenantId, versionId: entry.current.id, verifiedBy: user.userId, verifiedByName: user.name });
    } catch (err) {
      if (pgCode(err) === "23505") throw conflict("Someone else just verified this record");
      throw err;
    }
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "entry.verified", target: entryId, details: { version: entry.current.version } });
    const [view] = await loadEntries(tx, user.tenantId, { ids: [entryId] });
    return view!;
  });
}

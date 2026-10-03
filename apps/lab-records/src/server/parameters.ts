// What a plant tests and its pass/fail limits. Each plant starts with the default lists below and NO
// limits filled in (CLAUDE.md: sample limits are placeholders; each plant sets its own). Owner and lab lead
// change them; every change is audited, and past results keep the limit that applied when tested.
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { schema, withTenant, type LabTx } from "./db";
import { actorOf, requireApprover } from "./guards";
import { badRequest, conflict, notFound } from "./http";
import type { ParameterKind } from "./schema";
import type { LabUser } from "./session";

const { parameters } = schema;

/** Daily in-house checks every plant starts with (it can rename, add or switch off daily checks). */
const DAILY_DEFAULTS = [
  { code: "tds", name: "TDS", unit: "mg/L" },
  { code: "ph", name: "pH", unit: null },
  { code: "turbidity", name: "Turbidity", unit: "NTU" },
];

/** FSSAI Form 1 columns, in the sheet's order (refeDocs/sheets/FSSAI STI Forms.xlsx). Fixed list: the print layout depends on it. */
export const FORM1_PARAMETERS = [
  { code: "barium", name: "Barium" },
  { code: "copper", name: "Copper" },
  { code: "iron", name: "Iron" },
  { code: "manganese", name: "Manganese" },
  { code: "nitrate", name: "Nitrate" },
  { code: "nitrite", name: "Nitrite" },
  { code: "aluminium", name: "Aluminium" },
  { code: "calcium", name: "Calcium" },
  { code: "sulphide", name: "Sulphide" },
  { code: "magnesium", name: "Magnesium" },
  { code: "antimony", name: "Antimony" },
  { code: "borate", name: "Borate" },
  { code: "phenolic_compound", name: "Phenolic Compound" },
  { code: "mineral_oil", name: "Mineral Oil" },
  { code: "zinc", name: "Zinc" },
  { code: "anionic_surface_active_agent", name: "Anionic Surface-Active Agent" },
];

/** Creates the default parameter lists the first time a plant uses Lab Records. */
export async function ensureParameters(tx: LabTx, tenantId: string) {
  const [{ n }] = (await tx.select({ n: count() }).from(parameters).where(eq(parameters.tenantId, tenantId))) as [{ n: number }];
  if (n > 0) return;
  const rows = [
    ...DAILY_DEFAULTS.map((p, i) => ({ ...p, kind: "daily" as const, sort: i })),
    ...FORM1_PARAMETERS.map((p, i) => ({ ...p, unit: "mg/L", kind: "form1" as const, sort: i })),
  ];
  await tx
    .insert(parameters)
    .values(rows.map((r) => ({ tenantId, kind: r.kind, code: r.code, name: r.name, unit: r.unit, sort: r.sort, updatedBy: "system" })))
    .onConflictDoNothing();
}

export type ParameterView = {
  id: string;
  kind: ParameterKind;
  code: string;
  name: string;
  unit: string | null;
  limit_min: string | null;
  limit_max: string | null;
  active: boolean;
};

const view = (p: typeof parameters.$inferSelect): ParameterView => ({
  id: p.id,
  kind: p.kind,
  code: p.code,
  name: p.name,
  unit: p.unit,
  limit_min: p.limitMin,
  limit_max: p.limitMax,
  active: p.active,
});

export async function listParametersTx(tx: LabTx, tenantId: string, kind?: ParameterKind) {
  await ensureParameters(tx, tenantId);
  const rows = await tx
    .select()
    .from(parameters)
    .where(kind ? and(eq(parameters.tenantId, tenantId), eq(parameters.kind, kind)) : eq(parameters.tenantId, tenantId))
    .orderBy(asc(parameters.kind), asc(parameters.sort), asc(parameters.name));
  return rows.map(view);
}

export const listParameters = (user: LabUser, kind?: ParameterKind) => withTenant(user.tenantId, (tx) => listParametersTx(tx, user.tenantId, kind));

// ---------- changes (owner / lab lead) ----------

/** A decimal typed by a person: up to 7 digits before and 4 after the point. Blank = no limit. */
export const Decimal = z
  .string()
  .trim()
  .regex(/^-?\d{1,7}(\.\d{1,4})?$/, "Enter a number like 500 or 6.5");
const Limit = z.union([Decimal, z.literal(""), z.null()]).transform((v) => (v ? v : null));

export const UpdateParameterInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    unit: z.string().trim().max(20).nullable(),
    limit_min: Limit,
    limit_max: Limit,
    active: z.boolean(),
  })
  .partial();

export const AddParameterInput = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(20).nullable().optional(),
  limit_min: Limit.optional(),
  limit_max: Limit.optional(),
});

function checkLimits(min: string | null, max: string | null) {
  if (min !== null && max !== null && Number(min) > Number(max)) throw badRequest("The lowest allowed value can't be above the highest");
}

export function updateParameter(user: LabUser, id: string, input: z.infer<typeof UpdateParameterInput>) {
  requireApprover(user);
  return withTenant(user.tenantId, async (tx) => {
    const [before] = await tx.select().from(parameters).where(and(eq(parameters.tenantId, user.tenantId), eq(parameters.id, id)));
    if (!before) throw notFound("Parameter not found");
    // Form 1 columns are fixed by the government form: only unit and limits change.
    if (before.kind === "form1" && (input.name !== undefined || input.active !== undefined)) {
      throw badRequest("Form 1 parameters follow the FSSAI form: only the unit and limits can change");
    }
    const next = {
      name: input.name ?? before.name,
      unit: input.unit === undefined ? before.unit : input.unit || null,
      limitMin: input.limit_min === undefined ? before.limitMin : input.limit_min,
      limitMax: input.limit_max === undefined ? before.limitMax : input.limit_max,
      active: input.active ?? before.active,
    };
    checkLimits(next.limitMin, next.limitMax);
    const [row] = await tx
      .update(parameters)
      .set({ ...next, updatedAt: new Date(), updatedBy: actorOf(user) })
      .where(and(eq(parameters.tenantId, user.tenantId), eq(parameters.id, id)))
      .returning();
    await audit(tx, {
      tenantId: user.tenantId,
      actor: actorOf(user),
      action: "parameter.updated",
      target: id,
      details: {
        name: before.name,
        before: { unit: before.unit, limit_min: before.limitMin, limit_max: before.limitMax, active: before.active, name: before.name },
        after: { unit: next.unit, limit_min: next.limitMin, limit_max: next.limitMax, active: next.active, name: next.name },
      },
    });
    return view(row!);
  });
}

/** A new daily check (e.g. "Free chlorine"). Form 1's list is fixed. */
export function addDailyParameter(user: LabUser, input: z.infer<typeof AddParameterInput>) {
  requireApprover(user);
  const limitMin = input.limit_min ?? null;
  const limitMax = input.limit_max ?? null;
  checkLimits(limitMin, limitMax);
  const code = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "check";
  return withTenant(user.tenantId, async (tx) => {
    await ensureParameters(tx, user.tenantId);
    const existing = await tx
      .select({ code: parameters.code, sort: parameters.sort })
      .from(parameters)
      .where(and(eq(parameters.tenantId, user.tenantId), eq(parameters.kind, "daily")));
    if (existing.some((p) => p.code === code)) throw conflict(`There is already a daily check called "${input.name}"`);
    const [row] = await tx
      .insert(parameters)
      .values({
        tenantId: user.tenantId,
        kind: "daily",
        code,
        name: input.name,
        unit: input.unit || null,
        limitMin,
        limitMax,
        sort: Math.max(-1, ...existing.map((p) => p.sort)) + 1,
        updatedBy: actorOf(user),
      })
      .returning();
    await audit(tx, { tenantId: user.tenantId, actor: actorOf(user), action: "parameter.added", target: row!.id, details: { ...input } });
    return view(row!);
  });
}

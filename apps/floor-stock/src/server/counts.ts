// The daily count: today's production (finished goods) + the closing stock of every item, once per plant per day.
// Rules (approved 2026-10-04):
//   * only for today or yesterday (India time); never older, never a future date
//   * production starts empty; closing stock is pre-filled from the latest version of the last count
//   * submitting locks it; a correction is a new version with a reason and holds the full sheet again
//   * append-only: stock_app has no UPDATE / DELETE on counts, versions or lines (the database refuses)
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { addDays, istDay } from "@/lib/days";
import type { AlertContact } from "@plantops/types";
import { ownersOf, queueLowStock } from "./alerts";
import { schema, withTenant, type StockTx } from "./db";
import { kit } from "./kit";
import { badRequest, conflict } from "./http";
import type { LineKind, SectionKind } from "./schema";
import { actorOf, requireCount, type StockUser } from "./session";

const { auditLog, countLines, countVersions, counts, items, sections } = schema;

export const MAX_LINES = 20;

// ---------- inputs ----------
const Qty = z
  .number()
  .min(0, "Quantities can't be negative")
  .max(9_999_999_999, "That number is too large")
  .refine((n) => Math.round(n * 100) / 100 === n, "At most 2 decimals");
const Line = z.object({
  item_id: z.uuid(),
  kind: z.enum(["production", "stock"]),
  qty: Qty,
  second_qty: Qty.nullish(),
  remark: z.string().trim().max(120, "Remarks can be at most 120 characters").nullish(),
});
export const CountInput = z.object({
  date: z.iso.date(),
  /** the version the screen was showing (0 = no count yet), so two people can't overwrite each other's work */
  expected_version: z.number().int().min(0),
  reason: z.string().trim().max(300).nullish(),
  lines: z.array(Line).min(1, "The count is empty").max(4000),
});
export type CountInput = z.infer<typeof CountInput>;

/** Counts are entered for today or yesterday only. */
export function allowedDates(now = new Date()) {
  const today = istDay(now);
  return [today, addDays(today, -1)];
}

// ---------- what the count screen needs ----------
export interface FormItem {
  id: string;
  name: string;
  unit: string;
  second_unit: string | null;
}
export interface FormSection {
  id: string;
  name: string;
  kind: SectionKind;
  items: FormItem[];
}
export interface FormLine {
  item_id: string;
  kind: LineKind;
  qty: number;
  second_qty: number | null;
  remark: string | null;
}
export interface VersionInfo {
  version: number;
  reason: string | null;
  entered_by: string;
  entered_at: string;
}
export interface CountForm {
  date: string;
  /** the count already saved for this date (null = not counted yet) */
  current: VersionInfo | null;
  /** where the pre-filled numbers come from: this date's latest version (correction) or the last count before it */
  prefill_from: string | null;
  sections: FormSection[];
  lines: FormLine[];
}

const num = (v: string | null) => (v === null ? null : Number(v));
const lineOf = (l: typeof countLines.$inferSelect): FormLine => ({ item_id: l.itemId, kind: l.kind, qty: Number(l.qty), second_qty: num(l.secondQty), remark: l.remark });

/** The latest version of one date's count (null = no count that day). */
export async function latestVersion(tx: StockTx, tenantId: string, date: string) {
  const [row] = await tx
    .select({ count: counts, version: countVersions })
    .from(counts)
    .innerJoin(countVersions, eq(countVersions.countId, counts.id))
    .where(and(eq(counts.tenantId, tenantId), eq(counts.countDate, date)))
    .orderBy(desc(countVersions.version))
    .limit(1);
  return row ?? null;
}

export const versionInfo = (v: typeof countVersions.$inferSelect): VersionInfo => ({
  version: v.version,
  reason: v.reason,
  entered_by: v.enteredByName,
  entered_at: v.enteredAt.toISOString(),
});

/** Active sections with their active items, in the plant's order: what is counted today. */
async function activeList(tx: StockTx, tenantId: string): Promise<FormSection[]> {
  const secs = await tx.select().from(sections).where(and(eq(sections.tenantId, tenantId), eq(sections.status, "active"))).orderBy(asc(sections.sortOrder), asc(sections.createdAt));
  const its = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.status, "active"))).orderBy(asc(items.sortOrder), asc(items.createdAt));
  return secs.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    items: its.filter((i) => i.sectionId === s.id).map((i) => ({ id: i.id, name: i.name, unit: i.unit, second_unit: i.secondUnit })),
  }));
}

/**
 * The count screen for one date. With a count already saved, the numbers are that count's (for a correction);
 * otherwise closing stock comes from the last count before the date and production starts empty.
 */
export async function countForm(user: StockUser, date: string): Promise<CountForm> {
  return withTenant(user.tenantId, async (tx) => {
    const list = await activeList(tx, user.tenantId);
    const current = await latestVersion(tx, user.tenantId, date);
    if (current) {
      const lines = await tx.select().from(countLines).where(eq(countLines.versionId, current.version.id)).orderBy(asc(countLines.lineNo));
      return { date, current: versionInfo(current.version), prefill_from: date, sections: list, lines: lines.map(lineOf) };
    }
    const [last] = await tx
      .select({ date: counts.countDate })
      .from(counts)
      .where(and(eq(counts.tenantId, user.tenantId), lt(counts.countDate, date)))
      .orderBy(desc(counts.countDate))
      .limit(1);
    if (!last) return { date, current: null, prefill_from: null, sections: list, lines: [] };
    const prev = (await latestVersion(tx, user.tenantId, last.date))!;
    const lines = await tx
      .select()
      .from(countLines)
      .where(and(eq(countLines.versionId, prev.version.id), eq(countLines.kind, "stock")))
      .orderBy(asc(countLines.lineNo));
    return { date, current: null, prefill_from: last.date, sections: list, lines: lines.map(lineOf) };
  });
}

// ---------- submit / correct ----------
const dbCode = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;

/**
 * Saves a count (version 1) or a correction (next version, with a reason). Every item being counted must have a
 * closing stock; production only for finished-goods items; a second number only where the item has one.
 */
export async function submitCount(user: StockUser, input: CountInput, now = new Date()) {
  requireCount(user);
  if (!allowedDates(now).includes(input.date)) throw badRequest("A count can only be entered for today or yesterday");
  // who gets the low-stock email; if the platform can't be reached the count is still saved (no email queued)
  const contacts = await kit.contacts(user.tenantId);
  if (!contacts) console.error("[floor-stock] owners could not be loaded; no low-stock email queued for", input.date);
  try {
    return await withTenant(user.tenantId, (tx) => saveCount(tx, user, input, ownersOf(contacts ?? [])));
  } catch (err) {
    if (dbCode(err) === "23505") throw conflict("Someone else saved this count just now. Please reload the page to see it.");
    throw err;
  }
}

async function saveCount(tx: StockTx, user: StockUser, input: CountInput, owners: AlertContact[]) {
  const current = await latestVersion(tx, user.tenantId, input.date);
  const currentVersion = current?.version.version ?? 0;
  if (input.expected_version !== currentVersion) {
    throw conflict(
      current
        ? `This day was already counted by ${current.version.enteredByName}. Please reload the page to see it.`
        : "This count changed while you were entering it. Please reload the page.",
    );
  }
  const reason = input.reason?.trim() || null;
  if (current && (!reason || reason.length < 3)) throw badRequest("Please say why the count is being corrected (at least 3 characters)");

  // What may be in this count: today's list, plus (for a correction) anything in the version being corrected.
  const list = await activeList(tx, user.tenantId);
  const kindOf = new Map<string, SectionKind>();
  for (const s of list) for (const i of s.items) kindOf.set(i.id, s.kind);
  const lineIds = [...new Set(input.lines.map((l) => l.item_id))];
  const rows = await tx.select({ item: items, kind: sections.kind }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(and(eq(items.tenantId, user.tenantId), inArray(items.id, lineIds)));
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  const before = current ? new Set((await tx.selectDistinct({ id: countLines.itemId }).from(countLines).where(eq(countLines.versionId, current.version.id))).map((r) => r.id)) : new Set<string>();

  const numbered = new Map<string, number>();
  const values: (typeof countLines.$inferInsert)[] = [];
  for (const l of input.lines) {
    const row = byId.get(l.item_id);
    if (!row || (!kindOf.has(l.item_id) && !before.has(l.item_id))) throw badRequest("An item in this count is no longer counted. Please reload the page.");
    const it = row.item;
    if (l.kind === "production" && row.kind !== "finished") throw badRequest(`"${it.name}" is not a finished good, so it has no production`);
    if (l.second_qty != null && (l.kind === "production" || !it.secondUnit)) throw badRequest(`"${it.name}" has no second number`);
    const key = `${l.item_id}:${l.kind}`;
    const lineNo = (numbered.get(key) ?? 0) + 1;
    if (lineNo > MAX_LINES) throw badRequest(`"${it.name}" can have at most ${MAX_LINES} lines`);
    numbered.set(key, lineNo);
    values.push({
      tenantId: user.tenantId,
      versionId: "", // set below
      itemId: it.id,
      kind: l.kind,
      lineNo,
      itemName: it.name,
      unit: it.unit,
      secondUnit: it.secondUnit,
      qty: String(l.qty),
      secondQty: l.second_qty == null ? null : String(l.second_qty),
      remark: l.remark?.trim() || null,
    });
  }
  for (const s of list) {
    for (const i of s.items) if (!numbered.has(`${i.id}:stock`)) throw badRequest(`Please enter the closing stock of "${i.name}" (${s.name})`);
  }

  let countId = current?.count.id;
  if (!countId) {
    const [c] = await tx.insert(counts).values({ tenantId: user.tenantId, countDate: input.date }).returning({ id: counts.id });
    countId = c!.id;
  }
  const version = currentVersion + 1;
  const [v] = await tx
    .insert(countVersions)
    .values({ tenantId: user.tenantId, countId, version, reason: version === 1 ? null : reason, enteredBy: user.userId, enteredByName: user.name })
    .returning();
  await tx.insert(countLines).values(values.map((x) => ({ ...x, versionId: v!.id })));
  const queued = await queueLowStock(tx, user.tenantId, input.date, v!.id, owners);
  await tx.insert(auditLog).values({
    tenantId: user.tenantId,
    actor: actorOf(user),
    action: version === 1 ? "count.submit" : "count.correct",
    target: input.date,
    details: { by: user.name, version, lines: values.length, ...(version > 1 ? { reason } : {}) },
  });
  return { date: input.date, version, entered_at: v!.enteredAt.toISOString(), low_stock_emails: queued };
}


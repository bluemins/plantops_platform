// Read-only views of the counts: one day compared with the day before (Sold / Used / low), history by date and
// by item, Recent changes (setup audit) and the owner's CSV. Everything calculated here is worked out when the
// screen opens and never stored.
import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { describeChange } from "@/lib/changes";
import { compare, isLow, sum, type Comparison } from "@/lib/compare";
import { addDays } from "@/lib/days";
import { latestVersion, versionInfo, type VersionInfo } from "./counts";
import { schema, withTenant, type StockTx } from "./db";
import { forbidden, notFound } from "./http";
import type { SectionKind } from "./schema";
import { actorOf, requireOwner, type StockUser } from "./session";

const { auditLog, countLines, countVersions, counts, items, sections } = schema;

/** Owner, store keeper and PlantOps support (read-only) may look at counts. */
function requireView(user: StockUser) {
  if (!user.isSupport && !user.canCount) throw forbidden();
}

type Line = typeof countLines.$inferSelect;

export interface LineView {
  qty: number;
  second_qty: number | null;
  remark: string | null;
}
export interface DayRow {
  item_id: string;
  name: string;
  unit: string;
  second_unit: string | null;
  finished: boolean;
  /** today's production lines (finished goods only) and their total */
  production: LineView[];
  production_total: number;
  stock: LineView[];
  closing: number;
  second_total: number | null;
  min_level: number | null;
  low: boolean;
  previous: number | null;
  comparison: Comparison;
}
export interface DaySection {
  id: string;
  name: string;
  kind: SectionKind;
  rows: DayRow[];
}
export interface DayView {
  date: string;
  previous_date: string;
  previous_counted: boolean;
  versions: VersionInfo[];
  /** the version shown (the latest unless another was asked for) */
  shown: VersionInfo;
  sections: DaySection[];
  low: DayRow[];
}

const lineView = (l: Line): LineView => ({ qty: Number(l.qty), second_qty: l.secondQty === null ? null : Number(l.secondQty), remark: l.remark });

/** Closing stock per item in one version: total + unit (as saved that day). */
function closingByItem(lines: Line[]) {
  const map = new Map<string, { qty: number; unit: string }>();
  for (const l of lines.filter((x) => x.kind === "stock")) {
    const cur = map.get(l.itemId);
    map.set(l.itemId, { qty: sum([cur?.qty ?? 0, Number(l.qty)]), unit: l.unit });
  }
  return map;
}

async function linesOf(tx: StockTx, versionId: string) {
  return tx.select().from(countLines).where(eq(countLines.versionId, versionId)).orderBy(asc(countLines.lineNo));
}

/** One day's count (a given version, or the latest) compared with the day before. null = not counted that day. */
export async function dayView(user: StockUser, date: string, version?: number): Promise<DayView | null> {
  requireView(user);
  return withTenant(user.tenantId, async (tx) => {
    const [count] = await tx.select().from(counts).where(and(eq(counts.tenantId, user.tenantId), eq(counts.countDate, date)));
    if (!count) return null;
    const versions = await tx.select().from(countVersions).where(eq(countVersions.countId, count.id)).orderBy(asc(countVersions.version));
    const shown = version ? versions.find((v) => v.version === version) : versions.at(-1);
    if (!shown) throw notFound("That version does not exist");
    const lines = await linesOf(tx, shown.id);

    const previousDate = addDays(date, -1);
    const prev = await latestVersion(tx, user.tenantId, previousDate);
    const prevClosing = prev ? closingByItem(await linesOf(tx, prev.version.id)) : new Map();

    // Current section and limit of every item in this count (an item's section is today's, not that day's).
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const itemRows = ids.length ? await tx.select().from(items).where(and(eq(items.tenantId, user.tenantId), inArray(items.id, ids))) : [];
    const secRows = await tx.select().from(sections).where(eq(sections.tenantId, user.tenantId)).orderBy(asc(sections.sortOrder), asc(sections.createdAt));
    const itemOf = new Map(itemRows.map((i) => [i.id, i]));

    const result: DaySection[] = secRows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, rows: [] }));
    const orderedIds = [...ids].sort((a, b) => (itemOf.get(a)?.sortOrder ?? 0) - (itemOf.get(b)?.sortOrder ?? 0));
    for (const id of orderedIds) {
      const mine = lines.filter((l) => l.itemId === id);
      const first = mine[0]!;
      const it = itemOf.get(id)!;
      const sec = result.find((s) => s.id === it.sectionId)!;
      const production = mine.filter((l) => l.kind === "production").map(lineView);
      const stock = mine.filter((l) => l.kind === "stock").map(lineView);
      const finished = sec.kind === "finished";
      const closing = sum(stock.map((l) => l.qty));
      const production_total = sum(production.map((l) => l.qty));
      const seconds = stock.filter((l) => l.second_qty !== null).map((l) => l.second_qty!);
      const minLevel = it.minLevel === null ? null : Number(it.minLevel);
      const previous = prevClosing.get(id) ?? null;
      sec.rows.push({
        item_id: id,
        name: first.itemName,
        unit: first.unit,
        second_unit: first.secondUnit,
        finished,
        production,
        production_total,
        stock,
        closing,
        second_total: seconds.length ? sum(seconds) : null,
        min_level: minLevel,
        low: isLow(closing, minLevel),
        previous: previous?.qty ?? null,
        comparison: compare({ finished, previousCounted: !!prev, previous, production: production_total, closing, unit: first.unit }),
      });
    }
    const filled = result.filter((s) => s.rows.length);
    return {
      date,
      previous_date: previousDate,
      previous_counted: !!prev,
      versions: versions.map(versionInfo),
      shown: versionInfo(shown),
      sections: filled,
      low: filled.flatMap((s) => s.rows.filter((r) => r.low)),
    };
  });
}

// ---------- history ----------
export interface HistoryRow {
  date: string;
  versions: number;
  latest: VersionInfo;
  first_at: string;
}

/** The last counts, newest first. */
export async function countHistory(user: StockUser, limit = 120): Promise<HistoryRow[]> {
  requireView(user);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ date: counts.countDate, v: countVersions })
      .from(counts)
      .innerJoin(countVersions, eq(countVersions.countId, counts.id))
      .where(eq(counts.tenantId, user.tenantId))
      .orderBy(desc(counts.countDate), asc(countVersions.version));
    const byDate = new Map<string, (typeof rows)[number]["v"][]>();
    for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.v]);
    return [...byDate.entries()].slice(0, limit).map(([date, vs]) => ({ date, versions: vs.length, latest: versionInfo(vs.at(-1)!), first_at: vs[0]!.enteredAt.toISOString() }));
  });
}

export interface ItemDay {
  date: string;
  production: number | null;
  closing: number;
  unit: string;
  comparison: Comparison;
  low: boolean;
}

/** One item over its last counts (latest version of each day), newest first, each compared with the day before. */
export async function itemHistory(user: StockUser, itemId: string, limit = 60) {
  requireView(user);
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select({ item: items, kind: sections.kind, section: sections.name }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(and(eq(items.tenantId, user.tenantId), eq(items.id, itemId)));
    if (!row) throw notFound("Item not found");
    const finished = row.kind === "finished";
    const minLevel = row.item.minLevel === null ? null : Number(row.item.minLevel);
    // latest version of each count, newest first (one more than shown, for the oldest day's comparison)
    const latest = await tx
      .selectDistinctOn([counts.countDate], { date: counts.countDate, versionId: countVersions.id })
      .from(counts)
      .innerJoin(countVersions, eq(countVersions.countId, counts.id))
      .where(eq(counts.tenantId, user.tenantId))
      .orderBy(desc(counts.countDate), desc(countVersions.version))
      .limit(limit + 1);
    const lines = latest.length
      ? await tx.select().from(countLines).where(and(eq(countLines.itemId, itemId), inArray(countLines.versionId, latest.map((l) => l.versionId))))
      : [];
    const perDay = latest.map((d) => {
      const mine = lines.filter((l) => l.versionId === d.versionId);
      const stock = mine.filter((l) => l.kind === "stock");
      const prod = mine.filter((l) => l.kind === "production");
      return { date: d.date, counted: stock.length > 0, closing: sum(stock.map((l) => Number(l.qty))), production: prod.length ? sum(prod.map((l) => Number(l.qty))) : null, unit: stock[0]?.unit ?? row.item.unit };
    });
    const days: ItemDay[] = [];
    for (const [i, d] of perDay.entries()) {
      if (i >= limit || !d.counted) continue;
      const before = perDay.find((p) => p.date === addDays(d.date, -1));
      days.push({
        date: d.date,
        production: d.production,
        closing: d.closing,
        unit: d.unit,
        low: isLow(d.closing, minLevel),
        comparison: compare({
          finished,
          previousCounted: !!before,
          previous: before?.counted ? { qty: before.closing, unit: before.unit } : null,
          production: d.production ?? 0,
          closing: d.closing,
          unit: d.unit,
        }),
      });
    }
    return {
      item: { id: row.item.id, name: row.item.name, unit: row.item.unit, second_unit: row.item.secondUnit, section: row.section, finished, min_level: minLevel, status: row.item.status },
      days,
    };
  });
}

// ---------- Recent changes (setup) ----------
export interface ChangeView {
  at: string;
  by: string;
  text: string;
}

/** Every setup change (sections, items, limits, on/off) and count corrections, newest first. Owner and support. */
export async function recentChanges(user: StockUser, limit = 200): Promise<ChangeView[]> {
  if (!user.isSupport) requireOwner(user);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, user.tenantId), or(like(auditLog.action, "section.%"), like(auditLog.action, "item.%"), like(auditLog.action, "setup.%"), eq(auditLog.action, "count.correct"))))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
    const names = new Map((await tx.select({ id: sections.id, name: sections.name }).from(sections).where(eq(sections.tenantId, user.tenantId))).map((s) => [s.id, s.name]));
    return rows.map((r) => ({ at: r.at.toISOString(), by: String(r.details.by ?? "Someone"), text: describeChange(r.action, r.target, r.details, names) }));
  });
}

// ---------- owner's CSV ----------
/** Every version of every count, one row per line, oldest first. Formulas neutralised (packages/module-kit). */
export async function exportCsv(user: StockUser) {
  requireOwner(user);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ date: counts.countDate, v: countVersions, l: countLines, section: sections.name })
      .from(countLines)
      .innerJoin(countVersions, eq(countVersions.id, countLines.versionId))
      .innerJoin(counts, eq(counts.id, countVersions.countId))
      .innerJoin(items, eq(items.id, countLines.itemId))
      .innerJoin(sections, eq(sections.id, items.sectionId))
      .where(eq(counts.tenantId, user.tenantId))
      .orderBy(asc(counts.countDate), asc(countVersions.version), asc(sections.sortOrder), asc(items.sortOrder), asc(countLines.kind), asc(countLines.lineNo));
    const latest = new Map<string, number>();
    for (const r of rows) latest.set(r.date, Math.max(latest.get(r.date) ?? 0, r.v.version));
    await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action: "export.csv", details: { by: user.name, lines: rows.length } });
    return csv([
      ["Date", "Version", "Latest version", "Entered by", "Entered at", "Correction reason", "Section", "Item", "Production / closing", "Line", "Quantity", "Unit", "Second number", "Second unit", "Remark"],
      ...rows.map((r) => [
        r.date,
        r.v.version,
        r.v.version === latest.get(r.date) ? "yes" : "no",
        r.v.enteredByName,
        csvTime(r.v.enteredAt),
        r.v.reason ?? "",
        r.section,
        r.l.itemName,
        r.l.kind === "production" ? "Production" : "Closing stock",
        r.l.lineNo,
        Number(r.l.qty),
        r.l.unit,
        r.l.secondQty === null ? "" : Number(r.l.secondQty),
        r.l.secondUnit ?? "",
        r.l.remark ?? "",
      ]),
    ]);
  });
}

// ---------- home ----------
/** Today / yesterday status and the newest count (for the low-stock list on the home screen). */
export async function homeStatus(user: StockUser, today: string) {
  requireView(user);
  const yesterday = addDays(today, -1);
  const [t, y, history] = await withTenant(user.tenantId, async (tx) => [await latestVersion(tx, user.tenantId, today), await latestVersion(tx, user.tenantId, yesterday), await tx.select({ date: counts.countDate }).from(counts).where(eq(counts.tenantId, user.tenantId)).orderBy(desc(counts.countDate)).limit(1)] as const);
  return {
    today,
    yesterday,
    todayCount: t ? versionInfo(t.version) : null,
    yesterdayCount: y ? versionInfo(y.version) : null,
    lastDate: history[0]?.date ?? null,
  };
}

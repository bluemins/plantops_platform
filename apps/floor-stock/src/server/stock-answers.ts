// Floor Stock's facts for Sales' Plant answers S1–S4 and the morning report (owner 2026-11-28, P4-a; packages/types
// StockAnswers). Read only, nothing stored; only with a platform lookup ticket (scope stock_answers). Every number uses
// Floor Stock's own rules: the day page (dayView), "Consumable not updated correctly", Can make (canMakeFor) and the
// days-of-stock rule (src/lib/runway.ts). Counts only: no money, no phones.
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { StockAnswers } from "@plantops/types";
import { sum } from "@/lib/compare";
import { addDays, countDay } from "@/lib/days";
import { runway, WINDOW_DAYS, type RunwayDay } from "@/lib/runway";
import type { ProductResult } from "@/lib/recipe";
import { schema, withTenant } from "./db";
import { reader } from "./day-report";
import { kit } from "./kit";
import { canMakeFor, perBox, recipeData } from "./recipes";
import { dayView } from "./views";

const { countLines, countVersions, counts, items, sections } = schema;

async function dayStatus(tenantId: string, date: string): Promise<StockAnswers["days"][number]> {
  const v = await dayView(reader(tenantId), date);
  if (!v) return { date, done: false, counted_at: null, by: null, corrections: 0, not_updated: [] };
  const first = v.versions[0]!;
  return {
    date,
    done: true,
    counted_at: first.entered_at,
    by: first.entered_by,
    corrections: v.versions.length - 1,
    not_updated: v.not_updated.map((m) => ({ name: m.name, unit: m.unit, closing: m.closing, expected: m.expected, also: m.also.slice(0, 10) })),
  };
}

function canMakeOf(r: ProductResult | undefined): StockAnswers["products"][number]["can_make"] {
  if (!r || r.status === "no_recipe") return { state: "no_recipe", boxes: null, bottles: null, limiting: [], problems: [] };
  if (r.status === "problem") return { state: "problem", boxes: null, bottles: null, limiting: [], problems: r.problems.map((p) => (p.kind === "not_counted" ? `${p.material} not counted` : `${p.material}: measure doesn't match`)) };
  return { state: "ok", boxes: r.boxes, bottles: r.bottles, limiting: r.limiting, problems: [] };
}

export async function stockAnswers(tenantId: string, now = new Date()): Promise<StockAnswers> {
  const today = countDay(now);
  const yesterday = addDays(today, -1);
  const [yDay, tDay] = await Promise.all([dayStatus(tenantId, yesterday), dayStatus(tenantId, today)]);
  const products = await kit.products(tenantId);

  return withTenant(tenantId, async (tx) => {
    const [latest] = await tx.select().from(counts).where(eq(counts.tenantId, tenantId)).orderBy(desc(counts.countDate)).limit(1);
    const rows = await tx.select({ item: items, section: sections }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(eq(items.tenantId, tenantId));
    rows.sort((a, b) => a.section.sortOrder - b.section.sortOrder || a.item.sortOrder - b.item.sortOrder || a.item.createdAt.getTime() - b.item.createdAt.getTime());
    const active = rows.filter((r) => r.section.status === "active" && r.item.status === "active");
    const finished = active.filter((r) => r.section.kind === "finished");
    const stock = active.filter((r) => r.section.kind === "stock");

    // the window's counts, latest version of each
    const from = latest ? addDays(latest.countDate, -(WINDOW_DAYS - 1)) : today;
    const windowCounts = latest
      ? await tx.select().from(counts).where(and(eq(counts.tenantId, tenantId), gte(counts.countDate, from), lte(counts.countDate, latest.countDate))).orderBy(asc(counts.countDate))
      : [];
    const versions = windowCounts.length
      ? await tx.select().from(countVersions).where(inArray(countVersions.countId, windowCounts.map((c) => c.id))).orderBy(desc(countVersions.version))
      : [];
    const latestOf = new Map<string, string>();
    for (const v of versions) if (!latestOf.has(v.countId)) latestOf.set(v.countId, v.id);
    const vIds = [...latestOf.values()];
    const lines = vIds.length ? await tx.select().from(countLines).where(inArray(countLines.versionId, vIds)) : [];
    const linesOf = (versionId: string | undefined) => lines.filter((l) => l.versionId === versionId);

    const days: RunwayDay[] = windowCounts.map((c) => {
      const mine = linesOf(latestOf.get(c.id));
      const production = new Map<string, number>();
      const closing = new Map<string, { qty: number; second: number | null; unit: string }>();
      for (const l of mine) {
        if (l.kind === "production") production.set(l.itemId, sum([production.get(l.itemId) ?? 0, Number(l.qty)]));
        else {
          const cur = closing.get(l.itemId);
          const second = l.secondQty === null ? (cur?.second ?? null) : sum([cur?.second ?? 0, Number(l.secondQty)]);
          closing.set(l.itemId, { qty: sum([cur?.qty ?? 0, Number(l.qty)]), second, unit: l.unit });
        }
      }
      return { date: c.countDate, production, closing };
    });
    const last = days.at(-1);

    const data = await recipeData(tx, tenantId);
    const run = runway(
      days,
      finished.map((r) => ({ item_id: r.item.id, unit: r.item.unit, per_box: products ? perBox(r.item, data.recipes.get(r.item.id), products) : null, lines: data.recipes.get(r.item.id)?.lines ?? null })),
      stock.map((r) => ({ item_id: r.item.id, unit: r.item.unit, content: data.contents.get(r.item.id) ?? null, made_from: data.recipes.get(r.item.id)?.lines ?? null })),
    );
    const latestLines = latest ? linesOf(latestOf.get(latest.id)) : [];
    const groups = latestLines.length && products ? await canMakeFor(tx, tenantId, latestLines, products) : [];
    const results = new Map(groups.flatMap((g) => g.products).map((p) => [p.item_id, p]));
    const prodRun = new Map(run.products.map((p) => [p.item_id, p]));
    const matRun = new Map(run.materials.map((m) => [m.item_id, m]));

    return {
      count_day: today,
      days: [yDay, tDay],
      last_counted_on: latest?.countDate ?? null,
      history: { counted_days: run.counted_days, from: run.from, to: run.to, enough: run.enough },
      products: finished.map((r) => {
        const pr = prodRun.get(r.item.id)!;
        return {
          sku_id: r.item.skuId,
          item_id: r.item.id,
          name: r.item.name,
          unit: r.item.unit,
          closing: last?.closing.get(r.item.id)?.qty ?? null,
          can_make: canMakeOf(results.get(r.item.id)),
          sold_per_day: pr.sold_per_day,
          days_of_stock: pr.days_of_stock,
          why: pr.why,
        };
      }),
      materials: stock.map((r) => {
        const m = matRun.get(r.item.id)!;
        return { item_id: r.item.id, name: r.item.name, unit: r.item.unit, closing: last?.closing.get(r.item.id)?.qty ?? null, per_day: m.per_day, days_left: m.days_left, why: m.why };
      }),
    };
  });
}

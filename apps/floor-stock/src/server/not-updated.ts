// What the "Consumable not updated correctly" check needs from the database (rule: src/lib/not-updated.ts): the plant's
// recipes, each material's Contents / Made from, and the closing stock of the last count before the day.
import { and, desc, eq, lt } from "drizzle-orm";
import type { TenantSku } from "@plantops/types";
import { sum } from "@/lib/compare";
import { notUpdated, totalsOf, type MaterialSetup, type UsedMaterial } from "@/lib/not-updated";
import { schema, type StockTx } from "./db";
import { perBox, recipeData } from "./recipes";

const { countLines, countVersions, counts, items, sections } = schema;

/** null when the plant has no recipe (nothing to check). `products` null = not loaded: no expected numbers. */
export async function materialSetup(tx: StockTx, tenantId: string, date: string, products: TenantSku[] | null): Promise<MaterialSetup | null> {
  const data = await recipeData(tx, tenantId);
  if (!data.recipes.size) return null;
  const rows = await tx.select({ item: items, kind: sections.kind, sortS: sections.sortOrder }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(eq(items.tenantId, tenantId));
  rows.sort((a, b) => a.sortS - b.sortS || a.item.sortOrder - b.item.sortOrder || a.item.createdAt.getTime() - b.item.createdAt.getTime());

  const [prev] = await tx
    .select({ date: counts.countDate, versionId: countVersions.id })
    .from(counts)
    .innerJoin(countVersions, eq(countVersions.countId, counts.id))
    .where(and(eq(counts.tenantId, tenantId), lt(counts.countDate, date)))
    .orderBy(desc(counts.countDate), desc(countVersions.version))
    .limit(1);
  const prevLines = prev ? await tx.select().from(countLines).where(and(eq(countLines.versionId, prev.versionId), eq(countLines.kind, "stock"))) : [];

  return {
    previous_date: prev?.date ?? null,
    products: rows
      .filter((r) => r.kind === "finished" && data.recipes.get(r.item.id)?.lines.length)
      .map((r) => {
        const recipe = data.recipes.get(r.item.id)!;
        return { item_id: r.item.id, name: r.item.name, unit: r.item.unit, per_box: products ? perBox(r.item, recipe, products) : r.item.skuId ? null : (recipe.case_size ?? 1), lines: recipe.lines };
      }),
    materials: rows
      .filter((r) => r.kind === "stock")
      .map((r) => {
        const mine = prevLines.filter((l) => l.itemId === r.item.id);
        const seconds = mine.filter((l) => l.secondQty !== null).map((l) => Number(l.secondQty));
        return {
          item_id: r.item.id,
          name: r.item.name,
          unit: r.item.unit,
          content: data.contents.get(r.item.id) ?? null,
          made_from: data.recipes.get(r.item.id)?.lines ?? null,
          previous: mine.length ? { qty: sum(mine.map((l) => Number(l.qty))), second: seconds.length ? sum(seconds) : null, unit: mine[0]!.unit } : null,
        };
      }),
  };
}

/** The flagged materials of saved lines (one version of a count). */
export async function notUpdatedFor(
  tx: StockTx,
  tenantId: string,
  date: string,
  lines: { itemId: string; kind: "production" | "stock"; qty: string | number; secondQty?: string | number | null }[],
  products: TenantSku[] | null,
): Promise<UsedMaterial[]> {
  const setup = await materialSetup(tx, tenantId, date, products);
  if (!setup) return [];
  const t = totalsOf(lines.map((l) => ({ item_id: l.itemId, kind: l.kind, qty: Number(l.qty), second_qty: l.secondQty == null ? null : Number(l.secondQty) })));
  return notUpdated(setup, t.production, t.closing);
}

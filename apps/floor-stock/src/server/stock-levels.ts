// Floor Stock's last count for Sales' Plant answers O1 (owner 2026-11-28; packages/types StockLevels): the closing stock
// of each finished product that is linked to a PlantOps product, from the latest version of the newest count. Read only,
// nothing stored; only with a platform lookup ticket (scope stock_levels). Counts only: no money, no people.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { StockLevels } from "@plantops/types";
import { sum } from "@/lib/compare";
import { schema, withTenant } from "./db";

const { countLines, countVersions, counts, items, sections } = schema;

export async function stockLevels(tenantId: string): Promise<StockLevels> {
  return withTenant(tenantId, async (tx) => {
    const [count] = await tx.select().from(counts).where(eq(counts.tenantId, tenantId)).orderBy(desc(counts.countDate)).limit(1);
    if (!count) return { counted_on: null, counted_at: null, items: [] };
    const [version] = await tx.select().from(countVersions).where(eq(countVersions.countId, count.id)).orderBy(desc(countVersions.version)).limit(1);
    if (!version) return { counted_on: null, counted_at: null, items: [] };
    const lines = await tx.select().from(countLines).where(and(eq(countLines.versionId, version.id), eq(countLines.kind, "stock"))).orderBy(asc(countLines.lineNo));
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const itemRows = ids.length ? await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids))) : [];
    const finished = new Set(
      (await tx.select({ id: sections.id }).from(sections).where(and(eq(sections.tenantId, tenantId), eq(sections.kind, "finished")))).map((s) => s.id),
    );
    const per = new Map<string, { sku_id: string; name: string; unit: string; closing: number }>();
    for (const it of itemRows) {
      if (!it.skuId || !finished.has(it.sectionId)) continue;
      const mine = lines.filter((l) => l.itemId === it.id);
      const cur = per.get(it.skuId);
      const closing = sum(mine.map((l) => Number(l.qty)));
      // two items on one product (rare): their closing stock adds up
      per.set(it.skuId, { sku_id: it.skuId, name: cur?.name ?? mine[0]!.itemName, unit: cur?.unit ?? mine[0]!.unit, closing: sum([cur?.closing ?? 0, closing]) });
    }
    return { counted_on: count.countDate, counted_at: version.enteredAt.toISOString(), items: [...per.values()] };
  });
}

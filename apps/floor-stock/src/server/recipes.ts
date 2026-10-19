// "Can make" setup (approved 2026-10-11, docs/FLOOR_STOCK_CAN_MAKE_PLAN.md), set on the Sections & items screen:
//   * Contents (stock items): what 1 counted unit holds ("1 packet = 25,000 g"), a damage allowance, loose pieces
//   * Recipe (finished items): what 1 bottle needs ("18.5 g Preform 18.5 g + 1 Blue cap + 1 Label 1L")
//   * Made from (stock items counted in pieces, owner 2026-10-16): what 1 piece is made from ("1 BM 1L Empty Bottle
//     = 18.5 g Preform 18.5"), one step deep only. Stored as a recipe on the stock item.
// Owner only (checked here: the database can't tell an owner from a store keeper). Every save is audited. Nothing is
// deleted: a recipe line taken out is switched off. The result is worked out when a screen opens (src/lib/recipe.ts).
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { TenantSku } from "@plantops/types";
import { canMake, kindOf, MEASURES, sameKind, type CanMakeGroup, type Content, type Measure, type MaterialStock, type Product } from "@/lib/recipe";
import { sum } from "@/lib/compare";
import { schema, withTenant, type StockTx } from "./db";
import { badRequest, notFound } from "./http";
import { kit } from "./kit";
import { actorOf, requireOwner, type StockUser } from "./session";

const { auditLog, countLines, items, materialContents, recipeLines, recipes, sections } = schema;

// ---------- inputs ----------
const twoDecimals = (n: number) => Math.round(n * 100) / 100 === n;
const Amount = z
  .number()
  .gt(0, "Enter an amount above 0")
  .max(9_999_999_999, "That number is too large")
  .refine(twoDecimals, "At most 2 decimals (use g instead of kg for small amounts)");
const Measure = z.enum(MEASURES);

export const ContentInput = z.object({
  content_qty: Amount,
  content_measure: Measure,
  second_is_pieces: z.boolean().default(false),
  damage_pct: z
    .number()
    .min(0, "Damage can't be negative")
    .lt(100, "Damage must be below 100%")
    .refine((n) => Math.round(n * 10_000) / 10_000 === n, "At most 4 decimals")
    .default(0),
});
export const RecipeInput = z.object({
  /** only for an item without a linked product (otherwise the product's pack size is used) */
  case_size: z.number().int("Bottles per box must be a whole number").positive("Bottles per box must be at least 1").max(10_000).nullish(),
  lines: z.array(z.object({ material_item_id: z.uuid(), qty: Amount, measure: Measure })).max(30, "At most 30 materials"),
});

// ---------- what the setup screen shows ----------
export interface RecipeView {
  case_size: number | null;
  lines: { material_item_id: string; qty: number; measure: Measure }[];
}

const contentOf = (r: typeof materialContents.$inferSelect): Content => ({
  qty: Number(r.contentQty),
  measure: r.contentMeasure,
  second_is_pieces: r.secondIsPieces,
  damage_pct: Number(r.damagePct),
});

/** Every item's contents and every product's active recipe (by item id). */
export async function recipeData(tx: StockTx, tenantId: string) {
  const contents = new Map((await tx.select().from(materialContents).where(eq(materialContents.tenantId, tenantId))).map((r) => [r.itemId, contentOf(r)]));
  const recs = await tx.select().from(recipes).where(and(eq(recipes.tenantId, tenantId), eq(recipes.status, "active")));
  const lines = recs.length
    ? await tx.select().from(recipeLines).where(and(eq(recipeLines.tenantId, tenantId), eq(recipeLines.status, "active"), inArray(recipeLines.recipeId, recs.map((r) => r.id))))
    : [];
  const byProduct = new Map<string, RecipeView>(
    recs.map((r) => [
      r.productItemId,
      {
        case_size: r.caseSize,
        lines: lines
          .filter((l) => l.recipeId === r.id)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((l) => ({ material_item_id: l.materialItemId, qty: Number(l.qty), measure: l.measure })),
      },
    ]),
  );
  return { contents, recipes: byProduct };
}

// ---------- helpers ----------
async function itemWithSection(tx: StockTx, tenantId: string, id: string) {
  const [row] = await tx.select({ item: items, kind: sections.kind }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(and(eq(items.tenantId, tenantId), eq(items.id, id)));
  return row ?? null;
}

const contentKind = (c: Content | undefined) => (c ? kindOf(c.measure) : "pieces");
const describeLine = (l: { qty: number; measure: string }, name: string) => `${l.qty} ${l.measure} ${name}`;

async function audit(tx: StockTx, user: StockUser, action: string, target: string, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details: { by: user.name, ...details } });
}

// ---------- Contents (owner) ----------
export async function setContent(user: StockUser, itemId: string, input: z.infer<typeof ContentInput>) {
  requireOwner(user, "Only the plant owner can set what an item holds");
  return withTenant(user.tenantId, async (tx) => {
    const row = await itemWithSection(tx, user.tenantId, itemId);
    if (!row) throw notFound("Item not found");
    if (row.kind !== "stock") throw badRequest("Contents are set on raw material and consumable items, not on finished goods");
    const [madeFrom] = await tx.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.tenantId, user.tenantId), eq(recipes.productItemId, itemId), eq(recipes.status, "active")));
    if (madeFrom && input.content_measure !== "pcs") throw badRequest(`${row.item.name} is made from other materials, so 1 ${row.item.unit} must hold a number of pieces (pcs)`);
    if (input.second_is_pieces && !row.item.secondUnit) throw badRequest(`${row.item.name} has no second number to count as loose pieces`);
    if (input.second_is_pieces && input.content_measure !== "pcs") throw badRequest("Loose pieces only make sense when 1 unit holds a number of pieces (pcs)");

    // recipes already using this material must keep working: same kind of measure (weight stays weight)
    const used = await tx
      .select({ measure: recipeLines.measure, product: items.name })
      .from(recipeLines)
      .innerJoin(recipes, eq(recipes.id, recipeLines.recipeId))
      .innerJoin(items, eq(items.id, recipes.productItemId))
      .where(and(eq(recipeLines.tenantId, user.tenantId), eq(recipeLines.materialItemId, itemId), eq(recipeLines.status, "active"), eq(recipes.status, "active")));
    const clash = used.find((u) => !sameKind(u.measure, input.content_measure));
    if (clash) throw badRequest(`The recipe of ${clash.product} uses ${row.item.name} in ${clash.measure}. Change that recipe first.`);

    const [cur] = await tx.select().from(materialContents).where(and(eq(materialContents.tenantId, user.tenantId), eq(materialContents.itemId, itemId))).for("update");
    const before = cur ? contentOf(cur) : null;
    const next: Content = { qty: input.content_qty, measure: input.content_measure, second_is_pieces: input.second_is_pieces, damage_pct: input.damage_pct };
    if (before && JSON.stringify(before) === JSON.stringify(next)) return { id: itemId, changed: false };
    const values = {
      contentQty: String(next.qty),
      contentMeasure: next.measure,
      secondIsPieces: next.second_is_pieces,
      damagePct: String(next.damage_pct),
      updatedBy: user.userId,
      updatedByName: user.name,
      updatedAt: new Date(),
    };
    if (cur) await tx.update(materialContents).set(values).where(eq(materialContents.id, cur.id));
    else await tx.insert(materialContents).values({ tenantId: user.tenantId, itemId, ...values });
    await audit(tx, user, "material.content", itemId, { name: row.item.name, unit: row.item.unit, from: before, to: next });
    return { id: itemId, changed: true };
  });
}

// ---------- Recipe (owner) ----------
export async function setRecipe(user: StockUser, productId: string, input: z.infer<typeof RecipeInput>) {
  requireOwner(user, "Only the plant owner can set a recipe");
  const ids = input.lines.map((l) => l.material_item_id);
  if (new Set(ids).size !== ids.length) throw badRequest("Each material can be in the recipe only once");
  return withTenant(user.tenantId, async (tx) => {
    const product = await itemWithSection(tx, user.tenantId, productId);
    if (!product) throw notFound("Item not found");
    if (product.item.status !== "active") throw badRequest(`${product.item.name} is switched off`);
    // a recipe on a stock item = what 1 piece of it is made from
    const madeFrom = product.kind === "stock";
    const contents = new Map((await tx.select().from(materialContents).where(eq(materialContents.tenantId, user.tenantId))).map((r) => [r.itemId, contentOf(r)]));
    const otherRecipes = new Map<string, RecipeView>([...(await recipeData(tx, user.tenantId)).recipes].filter(([id]) => id !== productId));
    if (madeFrom && input.lines.length) {
      if (input.case_size != null) throw badRequest("Bottles per box are set on finished goods only");
      const c = contents.get(productId);
      if (c && c.measure !== "pcs") throw badRequest(`${product.item.name} is set as 1 ${product.item.unit} = ${c.qty} ${c.measure}. "Made from" needs it counted in pieces (pcs).`);
      if (ids.includes(productId)) throw badRequest(`${product.item.name} can't be made from itself`);
      const stockIds = new Set((await tx.select({ id: items.id }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(and(eq(items.tenantId, user.tenantId), eq(sections.kind, "stock")))).map((r) => r.id));
      const usedBy = [...otherRecipes].find(([id, r]) => stockIds.has(id) && r.lines.some((l) => l.material_item_id === productId));
      if (usedBy) throw badRequest(`${product.item.name} is already a material other items are made from. "Made from" goes one step only.`);
    }

    const mats = ids.length
      ? await tx.select({ item: items, kind: sections.kind }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(and(eq(items.tenantId, user.tenantId), inArray(items.id, ids)))
      : [];
    for (const l of input.lines) {
      const m = mats.find((x) => x.item.id === l.material_item_id);
      if (!m) throw badRequest("A material in this recipe is not one of this plant's items");
      if (m.kind !== "stock") throw badRequest(`${m.item.name} is a finished goods item; a recipe uses raw material and consumables`);
      if (m.item.status !== "active") throw badRequest(`${m.item.name} is switched off`);
      if (madeFrom && otherRecipes.get(m.item.id)?.lines.length) throw badRequest(`${m.item.name} is itself made from other materials. "Made from" goes one step only.`);
      const have = contentKind(contents.get(m.item.id));
      if (kindOf(l.measure) !== have) {
        const c = contents.get(m.item.id);
        throw badRequest(
          c
            ? `${m.item.name} is set as 1 ${m.item.unit} = ${c.qty} ${c.measure}, so its amount must be a ${have} too (not ${l.measure})`
            : `${m.item.name} is counted in single pieces, so use pcs (or first set what 1 ${m.item.unit} holds with Contents)`,
        );
      }
    }

    const [cur] = await tx.select().from(recipes).where(and(eq(recipes.tenantId, user.tenantId), eq(recipes.productItemId, productId))).for("update");
    const who = { updatedBy: user.userId, updatedByName: user.name, updatedAt: new Date() };
    const status = input.lines.length ? ("active" as const) : ("off" as const);
    let recipeId: string;
    if (cur) {
      recipeId = cur.id;
      await tx.update(recipes).set({ caseSize: input.case_size ?? null, status, ...who }).where(eq(recipes.id, cur.id));
    } else {
      const [r] = await tx
        .insert(recipes)
        .values({ tenantId: user.tenantId, productItemId: productId, caseSize: input.case_size ?? null, status, createdBy: user.userId, createdByName: user.name, ...who })
        .returning({ id: recipes.id });
      recipeId = r!.id;
    }

    // match the lines: update or switch back on the ones kept, add new ones, switch off the ones taken out
    const existing = await tx.select().from(recipeLines).where(eq(recipeLines.recipeId, recipeId));
    for (const l of input.lines) {
      const old = existing.find((e) => e.materialItemId === l.material_item_id);
      if (old) {
        if (old.status !== "active" || Number(old.qty) !== l.qty || old.measure !== l.measure) {
          await tx.update(recipeLines).set({ qty: String(l.qty), measure: l.measure, status: "active", ...who }).where(eq(recipeLines.id, old.id));
        }
      } else {
        await tx.insert(recipeLines).values({ tenantId: user.tenantId, recipeId, materialItemId: l.material_item_id, qty: String(l.qty), measure: l.measure, createdBy: user.userId, createdByName: user.name, ...who });
      }
    }
    for (const old of existing) {
      if (old.status === "active" && !ids.includes(old.materialItemId)) await tx.update(recipeLines).set({ status: "off", ...who }).where(eq(recipeLines.id, old.id));
    }

    const nameOf = new Map(mats.map((m) => [m.item.id, m.item.name]));
    const allNames = new Map((await tx.select({ id: items.id, name: items.name }).from(items).where(eq(items.tenantId, user.tenantId))).map((i) => [i.id, i.name]));
    const wasActive = cur?.status === "active";
    await audit(tx, user, "recipe.set", productId, {
      name: product.item.name,
      from: wasActive ? existing.filter((e) => e.status === "active").map((e) => describeLine({ qty: Number(e.qty), measure: e.measure }, allNames.get(e.materialItemId) ?? "?")) : [],
      to: input.lines.map((l) => describeLine(l, nameOf.get(l.material_item_id)!)),
      case_size: input.case_size ?? null,
      ...(madeFrom ? { made_from: true, unit: product.item.unit } : {}),
    });
    return { id: productId, lines: input.lines.length };
  });
}

// ---------- the result, for one version of a count ----------
/** "Can make" for one saved version (plant products loaded only when the plant has a recipe). */
/** `allowed`: a Stock viewer's sections (null = all); see canMakeFor. */
export async function canMakeForVersion(tenantId: string, versionId: string, allowed: Set<string> | null = null): Promise<CanMakeGroup[]> {
  const any = await withTenant(tenantId, (tx) => tx.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.tenantId, tenantId), eq(recipes.status, "active"))).limit(1));
  if (!any.length) return [];
  const products = await kit.products(tenantId);
  return withTenant(tenantId, async (tx) => canMakeFor(tx, tenantId, await tx.select().from(countLines).where(eq(countLines.versionId, versionId)), products, allowed));
}

/** Bottles per box: the linked product's pack size; an item without a product: its case_size, else 1. */
function perBox(item: typeof items.$inferSelect, recipe: RecipeView | undefined, products: TenantSku[]): number | null {
  if (item.skuId) {
    const p = products.find((s) => s.id === item.skuId);
    return p ? p.units_per_pack : null; // products couldn't be loaded: bottles only
  }
  return recipe?.case_size ?? 1;
}

/**
 * "Can make" for one version's lines. Empty when the plant has no recipe yet (so nothing shows until the owner sets
 * one). Products are today's active finished items, in the plant's order. With `allowed` (a Stock viewer's sections,
 * owner 2026-10-19) a product is shown only when its own section and the section of every material it uses (and of what
 * those are made from) are allowed.
 */
export async function canMakeFor(tx: StockTx, tenantId: string, lines: (typeof countLines.$inferSelect)[], products: TenantSku[], allowed: Set<string> | null = null): Promise<CanMakeGroup[]> {
  const data = await recipeData(tx, tenantId);
  if (!data.recipes.size) return [];
  const rows = await tx.select({ item: items, section: sections }).from(items).innerJoin(sections, eq(sections.id, items.sectionId)).where(eq(items.tenantId, tenantId));
  rows.sort((a, b) => a.section.sortOrder - b.section.sortOrder || a.item.sortOrder - b.item.sortOrder || a.item.createdAt.getTime() - b.item.createdAt.getTime());

  const sectionOf = new Map(rows.map((r) => [r.item.id, r.section.id]));
  const seen = (itemId: string) => !allowed || allowed.has(sectionOf.get(itemId) ?? "");
  const allSeen = (productId: string) =>
    seen(productId) &&
    (data.recipes.get(productId)?.lines ?? []).every((l) => seen(l.material_item_id) && (data.recipes.get(l.material_item_id)?.lines ?? []).every((m) => seen(m.material_item_id)));
  const finished: Product[] = rows
    .filter((r) => r.section.kind === "finished" && r.section.status === "active" && r.item.status === "active" && allSeen(r.item.id))
    .map((r) => {
      const recipe = data.recipes.get(r.item.id);
      return { item_id: r.item.id, name: r.item.name, unit: r.item.unit, per_box: perBox(r.item, recipe, products), lines: recipe?.lines ?? null };
    });
  const stock = lines.filter((l) => l.kind === "stock");
  const materials: MaterialStock[] = rows
    .filter((r) => r.section.kind === "stock")
    .map((r) => {
      const mine = stock.filter((l) => l.itemId === r.item.id);
      const seconds = mine.filter((l) => l.secondQty !== null).map((l) => Number(l.secondQty));
      return {
        item_id: r.item.id,
        name: r.item.name,
        counted: mine.length > 0,
        closing: sum(mine.map((l) => Number(l.qty))),
        second_total: seconds.length ? sum(seconds) : null,
        content: data.contents.get(r.item.id) ?? null,
        made_from: data.recipes.get(r.item.id)?.lines ?? null,
      };
    });
  return canMake(finished, materials);
}

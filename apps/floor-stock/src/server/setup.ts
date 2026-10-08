// The plant's own sections and items ("Sections & items" screen). Each plant has its own list; nothing is shared.
// Rules (approved 2026-10-04), checked here because the database can't tell an owner from a store keeper:
//   * sections: add / rename / re-order / switch off - owner only
//   * items: owner or store keeper add (choosing the section) and edit name / units / product / order
//   * owner only: set or change a limit, move an item to another section, switch off an item that has a limit
//   * a store keeper's save that touches an owner-only field is refused as a whole
//   * nothing is deleted (switched off instead); every change goes into the audit log ("Recent changes")
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { TenantSku } from "@plantops/types";
import { starterTemplate } from "@/lib/template";
import { schema, withTenant, type StockTx } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { kit } from "./kit";
import type { OnOff, SectionKind } from "./schema";
import { actorOf, requireCount, requireOwner, type StockUser } from "./session";

const { auditLog, items, sections } = schema;

// ---------- what the screens get ----------
export interface ItemView {
  id: string;
  section_id: string;
  name: string;
  unit: string;
  second_unit: string | null;
  sku_id: string | null;
  min_level: number | null;
  status: OnOff;
}
export interface SectionView {
  id: string;
  name: string;
  kind: SectionKind;
  status: OnOff;
  items: ItemView[];
}

const num = (v: string | null) => (v === null ? null : Number(v));
const itemView = (r: typeof items.$inferSelect): ItemView => ({
  id: r.id,
  section_id: r.sectionId,
  name: r.name,
  unit: r.unit,
  second_unit: r.secondUnit,
  sku_id: r.skuId,
  min_level: num(r.minLevel),
  status: r.status,
});

/** Every section with its items, in the plant's order (switched-off ones included; screens filter). */
export async function listSetup(user: StockUser): Promise<SectionView[]> {
  return withTenant(user.tenantId, async (tx) => {
    const secs = await tx.select().from(sections).where(eq(sections.tenantId, user.tenantId)).orderBy(asc(sections.sortOrder), asc(sections.createdAt));
    const its = await tx.select().from(items).where(eq(items.tenantId, user.tenantId)).orderBy(asc(items.sortOrder), asc(items.createdAt));
    return secs.map((s) => ({ id: s.id, name: s.name, kind: s.kind, status: s.status, items: its.filter((i) => i.sectionId === s.id).map(itemView) }));
  });
}

// ---------- inputs ----------
const Name = (max: number) => z.string().trim().min(1, "Please enter a name").max(max, `At most ${max} characters`);
const Unit = z.string().trim().min(1, "Please enter a unit").max(20, "At most 20 characters");
const Limit = z
  .number()
  .min(0, "A limit can't be negative")
  .max(9_999_999_999, "That limit is too large")
  .refine((n) => Math.round(n * 100) / 100 === n, "At most 2 decimals");
const Status = z.enum(["active", "off"]);
const Ids = z.array(z.uuid()).min(1).max(500);

export const SectionInput = z.object({ name: Name(60), kind: z.enum(["finished", "stock"]) });
export const SectionPatch = z.object({ name: Name(60).optional(), status: Status.optional() });
export const ItemInput = z.object({
  section_id: z.uuid(),
  name: Name(80),
  unit: Unit,
  second_unit: Unit.nullish(),
  sku_id: z.uuid().nullish(),
  min_level: Limit.nullish(),
});
export const ItemPatch = z.object({
  section_id: z.uuid().optional(),
  name: Name(80).optional(),
  unit: Unit.optional(),
  second_unit: Unit.nullable().optional(),
  sku_id: z.uuid().nullable().optional(),
  min_level: Limit.nullable().optional(),
  status: Status.optional(),
});
export const SectionOrder = z.object({ ids: Ids });
export const ItemOrder = z.object({ section_id: z.uuid(), ids: Ids });

// ---------- helpers ----------
async function audit(tx: StockTx, user: StockUser, action: string, target: string | null, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details: { by: user.name, ...details } });
}

/** The unique-name indexes turn into a plain message. */
async function namedSave<T>(what: "section" | "item", fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") throw conflict(what === "section" ? "There is already a section with this name" : "This section already has an item with this name");
    throw err;
  }
}

/** A product link must be one of this plant's products (from the platform). */
async function checkProduct(user: StockUser, skuId: string | null | undefined): Promise<TenantSku | null> {
  if (!skuId) return null;
  const products = await kit.products(user.tenantId);
  if (!products.length) throw badRequest("PlantOps products could not be loaded right now. Please try again in a minute.");
  const p = products.find((s) => s.id === skuId);
  if (!p) throw badRequest("That product is not one of this plant's products");
  return p;
}

async function activeSection(tx: StockTx, user: StockUser, id: string) {
  const [s] = await tx.select().from(sections).where(and(eq(sections.tenantId, user.tenantId), eq(sections.id, id)));
  if (!s) throw notFound("Section not found");
  if (s.status !== "active") throw badRequest(`The section "${s.name}" is switched off`);
  return s;
}

const nextOrder = async (tx: StockTx, table: typeof sections | typeof items, where: ReturnType<typeof eq>) => {
  const [r] = await tx.select({ max: sql<number>`coalesce(max(${table.sortOrder}), 0)::int` }).from(table).where(where);
  return (r?.max ?? 0) + 1;
};

// ---------- sections (owner only) ----------
export async function createSection(user: StockUser, input: z.infer<typeof SectionInput>) {
  requireOwner(user, "Only the plant owner can add a section");
  return withTenant(user.tenantId, (tx) =>
    namedSave("section", async () => {
      const sortOrder = await nextOrder(tx, sections, eq(sections.tenantId, user.tenantId));
      const [s] = await tx
        .insert(sections)
        .values({ tenantId: user.tenantId, name: input.name, kind: input.kind, sortOrder, createdBy: user.userId, createdByName: user.name })
        .returning();
      await audit(tx, user, "section.add", s!.id, { name: s!.name, kind: s!.kind });
      return { id: s!.id };
    }),
  );
}

export async function updateSection(user: StockUser, id: string, patch: z.infer<typeof SectionPatch>) {
  requireOwner(user, "Only the plant owner can change sections");
  return withTenant(user.tenantId, (tx) =>
    namedSave("section", async () => {
      const [cur] = await tx.select().from(sections).where(and(eq(sections.tenantId, user.tenantId), eq(sections.id, id))).for("update");
      if (!cur) throw notFound("Section not found");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (patch.name !== undefined && patch.name !== cur.name) changes.name = { from: cur.name, to: patch.name };
      if (patch.status !== undefined && patch.status !== cur.status) changes.status = { from: cur.status, to: patch.status };
      if (!Object.keys(changes).length) return { id, changed: false };
      await tx
        .update(sections)
        .set({ name: patch.name ?? cur.name, status: patch.status ?? cur.status, updatedAt: new Date() })
        .where(eq(sections.id, id));
      await audit(tx, user, "section.update", id, { name: patch.name ?? cur.name, changes });
      return { id, changed: true };
    }),
  );
}

/** New order of ALL the plant's sections (top first). */
export async function reorderSections(user: StockUser, input: z.infer<typeof SectionOrder>) {
  requireOwner(user, "Only the plant owner can re-order sections");
  return withTenant(user.tenantId, async (tx) => {
    const all = await tx.select({ id: sections.id }).from(sections).where(eq(sections.tenantId, user.tenantId));
    if (!sameSet(all.map((s) => s.id), input.ids)) throw badRequest("The list of sections has changed. Please reload the page.");
    for (const [i, id] of input.ids.entries()) await tx.update(sections).set({ sortOrder: i + 1 }).where(eq(sections.id, id));
    await audit(tx, user, "section.reorder", null, {});
    return { ok: true };
  });
}

// ---------- items ----------
export async function createItem(user: StockUser, input: z.infer<typeof ItemInput>) {
  requireCount(user);
  if (input.min_level != null && !user.isOwner) throw forbidden("Only the plant owner can set a limit");
  await checkProduct(user, input.sku_id);
  return withTenant(user.tenantId, (tx) =>
    namedSave("item", async () => {
      const section = await activeSection(tx, user, input.section_id);
      const sortOrder = await nextOrder(tx, items, eq(items.sectionId, section.id));
      const [it] = await tx
        .insert(items)
        .values({
          tenantId: user.tenantId,
          sectionId: section.id,
          name: input.name,
          unit: input.unit,
          secondUnit: input.second_unit ?? null,
          skuId: input.sku_id ?? null,
          minLevel: input.min_level == null ? null : String(input.min_level),
          sortOrder,
          createdBy: user.userId,
          createdByName: user.name,
        })
        .returning();
      await audit(tx, user, "item.add", it!.id, { name: it!.name, section: section.name, unit: it!.unit, second_unit: it!.secondUnit, sku_id: it!.skuId, min_level: num(it!.minLevel) });
      return { id: it!.id };
    }),
  );
}

/**
 * Edit an item. Only fields that really change count, so a form that sends every field is fine. A store keeper
 * whose change touches an owner-only field gets the whole save refused, with the reason.
 */
export async function updateItem(user: StockUser, id: string, patch: z.infer<typeof ItemPatch>) {
  requireCount(user);
  return withTenant(user.tenantId, (tx) =>
    namedSave("item", async () => {
      const [cur] = await tx.select().from(items).where(and(eq(items.tenantId, user.tenantId), eq(items.id, id))).for("update");
      if (!cur) throw notFound("Item not found");
      const before = itemView(cur);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ["section_id", "name", "unit", "second_unit", "sku_id", "min_level", "status"] as const) {
        const to = patch[key];
        if (to !== undefined && to !== before[key]) changes[key] = { from: before[key], to };
      }
      if (!Object.keys(changes).length) return { id, changed: false };

      if (!user.isOwner) {
        if (changes.min_level) throw forbidden("Only the plant owner can set or change a limit");
        if (changes.section_id) throw forbidden("Only the plant owner can move an item to another section");
        if (changes.status?.to === "off" && before.min_level !== null) throw forbidden("This item has a limit, so only the plant owner can switch it off");
      }
      let sectionName: string | undefined;
      if (changes.section_id) sectionName = (await activeSection(tx, user, patch.section_id!)).name;
      if (changes.sku_id && patch.sku_id) await checkProduct(user, patch.sku_id);

      const next = { ...before, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])) } as ItemView;
      await tx
        .update(items)
        .set({
          sectionId: next.section_id,
          name: next.name,
          unit: next.unit,
          secondUnit: next.second_unit,
          skuId: next.sku_id,
          minLevel: next.min_level === null ? null : String(next.min_level),
          status: next.status,
          // a moved item goes to the bottom of its new section
          ...(changes.section_id ? { sortOrder: await nextOrder(tx, items, eq(items.sectionId, next.section_id)) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(items.id, id));
      await audit(tx, user, "item.update", id, { name: next.name, ...(sectionName ? { to_section: sectionName } : {}), changes });
      return { id, changed: true };
    }),
  );
}

/** New order of ALL the items of one section (top first). Owner or store keeper. */
export async function reorderItems(user: StockUser, input: z.infer<typeof ItemOrder>) {
  requireCount(user);
  return withTenant(user.tenantId, async (tx) => {
    const all = await tx.select({ id: items.id }).from(items).where(and(eq(items.tenantId, user.tenantId), eq(items.sectionId, input.section_id)));
    if (!all.length) throw notFound("Section not found");
    if (!sameSet(all.map((i) => i.id), input.ids)) throw badRequest("The list of items has changed. Please reload the page.");
    for (const [i, id] of input.ids.entries()) await tx.update(items).set({ sortOrder: i + 1 }).where(eq(items.id, id));
    await audit(tx, user, "item.reorder", input.section_id, {});
    return { ok: true };
  });
}

// ---------- starter list ----------
/** Owner, first start only: create the generic starter sections and items (the plant then edits them). */
export async function applyTemplate(user: StockUser) {
  requireOwner(user, "Only the plant owner can set up sections");
  const products = await kit.products(user.tenantId);
  const template = starterTemplate(products);
  return withTenant(user.tenantId, async (tx) => {
    // one plant's setup at a time, so two clicks can't both create the list
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('floor_stock.template'), hashtext(${user.tenantId}))`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sections).where(eq(sections.tenantId, user.tenantId));
    if (n > 0) throw conflict("This plant already has sections");
    let itemCount = 0;
    for (const [si, sec] of template.entries()) {
      const [s] = await tx
        .insert(sections)
        .values({ tenantId: user.tenantId, name: sec.name, kind: sec.kind, sortOrder: si + 1, createdBy: user.userId, createdByName: user.name })
        .returning({ id: sections.id });
      if (sec.items.length) {
        await tx.insert(items).values(
          sec.items.map((it, ii) => ({
            tenantId: user.tenantId,
            sectionId: s!.id,
            name: it.name,
            unit: it.unit,
            secondUnit: it.second_unit ?? null,
            skuId: it.sku_id ?? null,
            sortOrder: ii + 1,
            createdBy: user.userId,
            createdByName: user.name,
          })),
        );
      }
      itemCount += sec.items.length;
    }
    await audit(tx, user, "setup.template", null, { sections: template.length, items: itemCount, products: products.length });
    return { sections: template.length, items: itemCount, products: products.length };
  });
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && new Set(b).size === b.length && b.every((id) => a.includes(id));
}

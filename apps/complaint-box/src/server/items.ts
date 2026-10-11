// The plant's item list: the products and equipment a complaint can be about (docs/COMPLAINT_BOX_PHASE_PLAN.md
// "Item list"). Rules, checked here on the server through the access table:
//   * only the owner adds, renames, re-orders, switches off / on and creates the starter list
//   * PlantOps support sees the list read-only; complaint desk / plant staff only pick from it (Phase 4)
//   * nothing is deleted (switched off instead); old complaints keep the item name copied into them
//   * every change goes into the audit log ("Recent changes")
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { productLabel } from "@plantops/module-kit";
import { describeChange } from "@/lib/changes";
import { NAME_MAX, starterItems } from "@/lib/starter";
import { requireAccess } from "./access";
import { schema, withTenant, type CbTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import { kit } from "./kit";
import type { OnOff } from "./schema";
import { actorOf, type CbUser } from "./session";

const { auditLog, complaints, items } = schema;

// ---------- what the screens get ----------
export interface ItemView {
  id: string;
  name: string;
  sku_id: string | null;
  status: OnOff;
  /** complaints about this item, all statuses (worked out now, never stored) */
  complaint_count: number;
}

// ---------- inputs ----------
const Name = z.string().trim().min(1, "Please enter a name").max(NAME_MAX, `At most ${NAME_MAX} characters`);
export const ItemInput = z.object({ name: Name, sku_id: z.uuid().nullish() });
/** The product link is chosen once, when the item is added (the database refuses changing it). */
export const ItemPatch = z.object({ name: Name.optional(), status: z.enum(["active", "off"]).optional() }).strict();
export const ItemOrder = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
export const StarterInput = z.object({ keys: z.array(z.string().min(1).max(60)).min(1, "Tick at least one item").max(200) });

// ---------- helpers ----------
async function audit(tx: CbTx, user: CbUser, action: string, target: string | null, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details: { by: user.name, ...details } });
}

/** The unique-name index (active items) turns into a plain message. */
async function namedSave<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") throw conflict("There is already an item with this name");
    throw err;
  }
}

const nextOrder = async (tx: CbTx, tenantId: string) => {
  const [r] = await tx.select({ max: sql<number>`coalesce(max(${items.sortOrder}), 0)::int` }).from(items).where(eq(items.tenantId, tenantId));
  return (r?.max ?? 0) + 1;
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(b).size === b.length && b.every((id) => a.includes(id));

// ---------- reading ----------
/** Every item with its complaint count, in the plant's order (switched-off ones included; screens filter). */
export async function listItems(user: CbUser): Promise<ItemView[]> {
  requireAccess(user, "view_items");
  return withTenant(user.tenantId, async (tx) => {
    const counts = tx
      .select({ itemId: complaints.itemId, n: sql<number>`count(*)::int`.as("n") })
      .from(complaints)
      .where(eq(complaints.tenantId, user.tenantId))
      .groupBy(complaints.itemId)
      .as("counts");
    const rows = await tx
      .select({ item: items, n: counts.n })
      .from(items)
      .leftJoin(counts, eq(counts.itemId, items.id))
      .where(eq(items.tenantId, user.tenantId))
      .orderBy(asc(items.sortOrder), asc(items.createdAt));
    return rows.map(({ item, n }) => ({ id: item.id, name: item.name, sku_id: item.skuId, status: item.status, complaint_count: n ?? 0 }));
  });
}

/** What the "log a complaint" form offers: active items only, in the plant's order. */
export async function pickableItems(user: CbUser) {
  requireAccess(user, "log");
  return withTenant(user.tenantId, (tx) =>
    tx
      .select({ id: items.id, name: items.name })
      .from(items)
      .where(and(eq(items.tenantId, user.tenantId), eq(items.status, "active")))
      .orderBy(asc(items.sortOrder), asc(items.createdAt)),
  );
}

/** Inside a save: the item a new complaint is about must be an active item of the same plant. */
export async function itemForComplaint(tx: CbTx, tenantId: string, itemId: string) {
  const [it] = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId)));
  if (!it) throw badRequest("Please choose an item from the list");
  if (it.status !== "active") throw badRequest(`"${it.name}" is no longer in the item list. Please choose another item.`);
  return it;
}

// ---------- changes (owner only) ----------
export async function createItem(user: CbUser, input: z.infer<typeof ItemInput>) {
  requireAccess(user, "manage_items");
  let product: string | null = null;
  if (input.sku_id) {
    const p = (await kit.products(user.tenantId)).find((s) => s.id === input.sku_id);
    if (!p) throw badRequest("That product is not one of this plant's PlantOps products");
    product = productLabel(p);
  }
  return withTenant(user.tenantId, (tx) =>
    namedSave(async () => {
      const [it] = await tx
        .insert(items)
        .values({ tenantId: user.tenantId, name: input.name, skuId: input.sku_id ?? null, sortOrder: await nextOrder(tx, user.tenantId), createdBy: user.userId, createdByName: user.name })
        .returning();
      await audit(tx, user, "item.add", it!.id, { name: it!.name, ...(product ? { product } : {}) });
      return { id: it!.id, name: it!.name };
    }),
  );
}

/** Rename and / or switch off / on. Only real changes are saved and audited. */
export async function updateItem(user: CbUser, id: string, patch: z.infer<typeof ItemPatch>) {
  requireAccess(user, "manage_items");
  return withTenant(user.tenantId, (tx) =>
    namedSave(async () => {
      const [cur] = await tx.select().from(items).where(and(eq(items.tenantId, user.tenantId), eq(items.id, id)));
      if (!cur) throw notFound("Item not found");
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (patch.name !== undefined && patch.name !== cur.name) changes.name = { from: cur.name, to: patch.name };
      if (patch.status !== undefined && patch.status !== cur.status) changes.status = { from: cur.status, to: patch.status };
      if (!Object.keys(changes).length) return { id, name: cur.name, status: cur.status, changed: false };
      const [next] = await tx
        .update(items)
        .set({ ...(changes.name ? { name: patch.name } : {}), ...(changes.status ? { status: patch.status } : {}), updatedAt: new Date() })
        .where(and(eq(items.tenantId, user.tenantId), eq(items.id, id)))
        .returning();
      await audit(tx, user, "item.update", id, { name: next!.name, changes });
      return { id, name: next!.name, status: next!.status, changed: true };
    }),
  );
}

/** The new order of ALL the plant's items (top first). */
export async function reorderItems(user: CbUser, input: z.infer<typeof ItemOrder>) {
  requireAccess(user, "manage_items");
  return withTenant(user.tenantId, async (tx) => {
    const all = await tx.select({ id: items.id }).from(items).where(eq(items.tenantId, user.tenantId));
    if (!sameSet(all.map((i) => i.id), input.ids)) throw badRequest("The list has changed. Please reload the page.");
    for (const [i, itemId] of input.ids.entries()) {
      await tx.update(items).set({ sortOrder: i + 1 }).where(and(eq(items.tenantId, user.tenantId), eq(items.id, itemId)));
    }
    await audit(tx, user, "item.reorder", null, {});
    return { ok: true };
  });
}

// ---------- starter list ----------
/** What the starter list would create for this plant now (the screen shows it with tick boxes). */
export async function starterFor(user: CbUser) {
  return starterItems(await kit.products(user.tenantId));
}

/** Owner, while the plant has no items: create the ticked entries of the starter list. */
export async function applyStarter(user: CbUser, input: z.infer<typeof StarterInput>) {
  requireAccess(user, "manage_items");
  const offered = await starterFor(user);
  const unknown = input.keys.filter((k) => !offered.some((o) => o.key === k));
  if (unknown.length) throw badRequest("The starter list has changed. Please reload the page.");
  const chosen = offered.filter((o) => input.keys.includes(o.key));
  return withTenant(user.tenantId, async (tx) => {
    // one plant at a time, so a double tap can't create the list twice
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('complaint_box.starter'), hashtext(${user.tenantId}))`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.tenantId, user.tenantId));
    if (n > 0) throw conflict("This plant already has items");
    await tx.insert(items).values(
      chosen.map((c, i) => ({ tenantId: user.tenantId, name: c.name, skuId: c.sku_id, sortOrder: i + 1, createdBy: user.userId, createdByName: user.name })),
    );
    await audit(tx, user, "items.starter", null, { items: chosen.length });
    return { items: chosen.length };
  });
}

// ---------- Recent changes ----------
export interface ChangeView {
  at: string;
  by: string;
  text: string;
}

/** Every item-list change and CSV export, newest first. Owner, and PlantOps support read-only. */
export async function recentChanges(user: CbUser, limit = 200): Promise<ChangeView[]> {
  requireAccess(user, "view_changes");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, user.tenantId), or(like(auditLog.action, "item.%"), like(auditLog.action, "items.%"), eq(auditLog.action, "export.csv"))))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
    return rows.map((r) => ({ at: r.at.toISOString(), by: String(r.details.by ?? "Someone"), text: describeChange(r.action, r.details) }));
  });
}

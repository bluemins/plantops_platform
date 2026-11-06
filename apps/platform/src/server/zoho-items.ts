// Import Zoho Items into the plant's products (owner only; docs/ZOHO_IMPORT_PHASE_PLAN.md section 4). The browser reads
// the CSV and sends the items; the file is never stored. Preview saves nothing. Confirm works the plan out again inside
// ONE transaction and saves only if it is still exactly what the owner saw (same fingerprint), otherwise 409.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PACK_TYPES, planItems, ZOHO_ITEMS_MAX, type ExistingSku, type ItemLink, type ItemsPlan } from "@/lib/zoho-items";
import { audit } from "./audit";
import type { CurrentUser } from "./auth";
import { selectSkus } from "./business";
import { schema, withTenant, type PlatformTx } from "./db";
import { badRequest, conflict } from "./http";

const { auditLog, tenantSkus, zohoItemLinks } = schema;

const Item = z.object({
  line: z.number().int().min(1).max(1_000_000),
  zoho_id: z.string().min(1).max(60),
  name: z.string().max(500),
  sku: z.string().max(200),
  hsn: z.string().max(50),
  cost_rate: z.number().min(0).max(10_000_000).nullable(),
  active: z.boolean(),
  sold: z.boolean(),
});
const Spec = z.object({
  volume_ml: z.number().int().min(1).max(100000),
  units_per_pack: z.number().int().min(1).max(1000),
  pack_type: z.enum(PACK_TYPES),
});
export const ZohoItemsInput = z.object({
  file_name: z.string().trim().max(200).default(""),
  items: z.array(Item).min(1, "The file has no items").max(ZOHO_ITEMS_MAX, `At most ${ZOHO_ITEMS_MAX} items in one file`),
  match: z.record(z.string().max(40), z.union([z.uuid(), z.literal("new")])).default({}),
  specs: z.record(z.string().max(40), Spec).default({}),
});
export const ZohoItemsConfirm = ZohoItemsInput.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });

export type ZohoItemsPreview = ItemsPlan & { fingerprint: string };

async function existing(tx: PlatformTx, tenantId: string): Promise<ExistingSku[]> {
  return (await selectSkus(tx, tenantId)).map((s) => ({
    id: s.id,
    name: s.name,
    sku_code: s.skuCode,
    volume_ml: s.volumeMl,
    units_per_pack: s.unitsPerPack,
    pack_type: s.packType,
    status: s.status,
    hsn: s.hsn,
    cost_rate: s.costRate === null ? null : Number(s.costRate),
  }));
}

async function links(tx: PlatformTx, tenantId: string): Promise<ItemLink[]> {
  const rows = await tx.select().from(zohoItemLinks).where(eq(zohoItemLinks.tenantId, tenantId));
  return rows.map((l) => ({
    sku_id: l.skuId,
    zoho_id: l.zohoItemId,
    sku: l.zohoSku,
    name: l.zohoName,
    hsn: l.zohoHsn,
    cost_rate: l.zohoCost === null ? null : Number(l.zohoCost),
    active: l.zohoActive,
  }));
}

/** Has this plant run the import before (v0.37.0, before links were kept)? */
async function importedBefore(tx: PlatformTx, tenantId: string) {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, "sku.zoho_import")))
    .limit(1);
  return !!row;
}

/** What confirm would do, as one hash: any change in the products or the file since the preview changes it. */
export function fingerprint(plan: ItemsPlan) {
  const what = { u: plan.updated.map((u) => [u.id, u.changes]), a: plan.added, c: plan.to_choose.map((c) => c.sku), l: plan.links };
  return createHash("sha256").update(JSON.stringify(what)).digest("hex");
}

const work = async (tx: PlatformTx, tenantId: string, input: z.infer<typeof ZohoItemsInput>) => {
  const ctx = { links: await links(tx, tenantId), importedBefore: await importedBefore(tx, tenantId) };
  const plan = planItems(input.items, await existing(tx, tenantId), { match: input.match, specs: input.specs }, ctx);
  return { ...plan, fingerprint: fingerprint(plan) };
};

export const previewZohoItems = (admin: CurrentUser, input: z.infer<typeof ZohoItemsInput>): Promise<ZohoItemsPreview> =>
  withTenant(admin.tenantId, (tx) => work(tx, admin.tenantId, input));

const STALE = "The products changed since the preview. Please check the preview again.";

export const confirmZohoItems = (admin: CurrentUser, input: z.infer<typeof ZohoItemsConfirm>) =>
  withTenant(admin.tenantId, async (tx) => {
    // one import at a time per plant, so two confirms can't both pass the fingerprint check
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform.zoho_items'), hashtext(${admin.tenantId}))`);
    const plan = await work(tx, admin.tenantId, input);
    if (plan.fingerprint !== input.fingerprint) throw conflict(STALE);
    if (plan.to_choose.length) throw badRequest(`Choose a product or "New product" for: ${plan.to_choose.map((c) => c.sku).join(", ")}`);
    const actor = `user:${admin.userId}` as const;

    // Codes first set to a placeholder, then to the new code: a product may take a code another product is giving up
    // in the same import (the unique index is checked per statement).
    const recoded = plan.updated.filter((u) => u.changes.some((c) => c.field === "sku_code"));
    for (const u of recoded) {
      await tx.update(tenantSkus).set({ skuCode: `ZOHO-TMP-${u.id.slice(0, 8).toUpperCase()}` }).where(and(eq(tenantSkus.tenantId, admin.tenantId), eq(tenantSkus.id, u.id)));
    }
    for (const u of plan.updated) {
      const set: Partial<typeof tenantSkus.$inferInsert> = { updatedAt: new Date() };
      for (const c of u.changes) {
        if (c.field === "name") set.name = String(c.to);
        if (c.field === "sku_code") set.skuCode = String(c.to);
        if (c.field === "hsn") set.hsn = c.to === null ? null : String(c.to);
        if (c.field === "cost_rate") set.costRate = c.to === null ? null : Number(c.to).toFixed(2);
        if (c.field === "status") set.status = c.to as "active" | "inactive";
      }
      await tx.update(tenantSkus).set(set).where(and(eq(tenantSkus.tenantId, admin.tenantId), eq(tenantSkus.id, u.id)));
    }
    const newIds = new Map<string, string>();
    if (plan.added.length) {
      const rows = await tx.insert(tenantSkus).values(
        plan.added.map((a) => ({
          tenantId: admin.tenantId,
          name: a.name,
          skuCode: a.sku,
          volumeMl: a.spec.volume_ml,
          unitsPerPack: a.spec.units_per_pack,
          packType: a.spec.pack_type,
          status: a.active ? ("active" as const) : ("inactive" as const),
          hsn: a.hsn,
          costRate: a.cost_rate === null ? null : a.cost_rate.toFixed(2),
          createdBy: actor,
        })),
      ).returning({ id: tenantSkus.id, sku: tenantSkus.skuCode });
      for (const r of rows) newIds.set(r.sku!, r.id);
    }
    // what Zoho says now becomes the next import's starting point (an owner's later edit is then kept)
    for (const l of plan.links) {
      const skuId = l.sku_id ?? newIds.get(l.new_sku!)!;
      const values = {
        zohoItemId: l.zoho_id,
        zohoSku: l.sku,
        zohoName: l.name,
        zohoHsn: l.hsn,
        zohoCost: l.cost_rate === null ? null : l.cost_rate.toFixed(2),
        zohoActive: l.active,
        importedAt: new Date(),
        importedBy: actor,
      };
      await tx.insert(zohoItemLinks).values({ tenantId: admin.tenantId, skuId, ...values }).onConflictDoUpdate({ target: [zohoItemLinks.tenantId, zohoItemLinks.skuId], set: values });
    }
    const keptEdits = [...plan.updated, ...plan.unchanged].reduce((n, p) => n + p.kept.length, 0);
    const counts = { updated: plan.updated.length, added: plan.added.length, unchanged: plan.unchanged.length, skipped: plan.skipped.length, kept: plan.kept.length, kept_edits: keptEdits };
    await audit(tx, {
      tenantId: admin.tenantId,
      actor,
      action: "sku.zoho_import",
      target: admin.tenantId,
      details: { file: input.file_name || null, ...counts, updates: plan.updated, new_products: plan.added.map((a) => ({ sku: a.sku, name: a.name, ...a.spec })) },
    });
    return counts;
  });

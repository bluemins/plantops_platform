// Each product's unit and default rate (docs/ORDER_CAPTURE_PHASE_PLAN.md "Products and rates"). Rules, checked here
// on the server through the access table:
//   * products are the plant's ACTIVE PlantOps products (Business details → Products), read through the platform
//   * only the owner changes units and rates; PlantOps support sees them read-only
//   * a product with no saved row uses the default unit and no rate (typed on each order)
//   * every save that changes something is one audit row ("Recent changes")
import { eq } from "drizzle-orm";
import { z } from "zod";
import { productLabel } from "@plantops/module-kit";
import type { TenantSku } from "@plantops/types";
import { defaultUnit, packText, RATE_RE, toRate, UNIT_MAX } from "@/lib/rates";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { productRates } = schema;

export interface RateView {
  sku_id: string;
  product: string;
  /** "24 per box", "jar" */
  pack: string;
  unit: string;
  /** "90.00", or null = not set (typed on each order) */
  default_rate: string | null;
}

export const RatesInput = z.object({
  rates: z
    .array(
      z.object({
        sku_id: z.uuid(),
        unit: z.string().trim().min(1, "Please enter a unit").max(UNIT_MAX, `A unit has at most ${UNIT_MAX} characters`),
        default_rate: z.string().trim().refine((v) => v === "" || RATE_RE.test(v), "A rate is a number of rupees with at most 2 decimals, e.g. 90 or 92.50"),
      }),
    )
    .max(500),
});

/** The plant's active products (empty if the platform can't be reached). */
export async function activeProducts(tenantId: string): Promise<TenantSku[]> {
  return (await kit.products(tenantId)).filter((s) => s.status === "active");
}

/** Unit and default rate of every active product: the saved row, or the default unit and no rate. */
export async function effectiveRates(tx: OcTx, tenantId: string, products: TenantSku[]): Promise<RateView[]> {
  const saved = new Map((await tx.select().from(productRates).where(eq(productRates.tenantId, tenantId))).map((r) => [r.skuId, r]));
  return products.map((p) => {
    const row = saved.get(p.id);
    const unit = row?.unit ?? defaultUnit(p);
    return { sku_id: p.id, product: productLabel(p), pack: packText(p, unit), unit, default_rate: row?.defaultRate ?? null };
  });
}

export async function listRates(user: OcUser): Promise<RateView[]> {
  requireAccess(user, "view_rates");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, (tx) => effectiveRates(tx, user.tenantId, products));
}

/** Save the Rates screen. Only rows that changed are written; one audit row lists the changes. */
export async function saveRates(user: OcUser, input: z.infer<typeof RatesInput>) {
  requireAccess(user, "rates");
  const products = new Map((await activeProducts(user.tenantId)).map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const r of input.rates) {
    if (!products.has(r.sku_id)) throw badRequest("One of these products is not an active PlantOps product of this plant. Reload the page and try again.");
    if (seen.has(r.sku_id)) throw badRequest("A product appears twice");
    seen.add(r.sku_id);
  }
  return withTenant(user.tenantId, async (tx) => {
    const current = new Map((await effectiveRates(tx, user.tenantId, [...products.values()])).map((r) => [r.sku_id, r]));
    const changes: { product: string; unit?: { from: string; to: string }; rate?: { from: string | null; to: string | null } }[] = [];
    for (const r of input.rates) {
      const now = current.get(r.sku_id)!;
      const rate = toRate(r.default_rate);
      if (now.unit === r.unit && now.default_rate === rate) continue;
      await tx
        .insert(productRates)
        .values({ tenantId: user.tenantId, skuId: r.sku_id, unit: r.unit, defaultRate: rate, updatedBy: user.userId })
        .onConflictDoUpdate({ target: [productRates.tenantId, productRates.skuId], set: { unit: r.unit, defaultRate: rate, updatedBy: user.userId, updatedAt: new Date() } });
      changes.push({
        product: now.product,
        ...(now.unit !== r.unit ? { unit: { from: now.unit, to: r.unit } } : {}),
        ...(now.default_rate !== rate ? { rate: { from: now.default_rate, to: rate } } : {}),
      });
    }
    if (changes.length) await audit(tx, user, "rates.set", null, { rates: changes });
    return { changed: changes.length };
  });
}

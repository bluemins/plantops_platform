// The plant's products with the brand shown for each (Rates brand, else the guess), and the line → product matcher
// (src/lib/brand.ts lineMatcher). Shared by Drop's Home and points, so both read a bill line the same way.
import { eq } from "drizzle-orm";
import type { TenantSku } from "@plantops/types";
import { effectiveBrand, lineMatcher, type BrandProduct } from "@/lib/brand";
import { schema, type OcTx } from "../db";

export async function productMatcher(tx: OcTx, tenantId: string, skus: TenantSku[]) {
  const rates = await tx.select({ skuId: schema.productRates.skuId, brand: schema.productRates.brand }).from(schema.productRates).where(eq(schema.productRates.tenantId, tenantId));
  const saved = new Map(rates.map((r) => [r.skuId, r.brand]));
  const products: BrandProduct[] = skus.map((p) => ({ id: p.id, name: p.name, sku_code: p.sku_code, volume_ml: p.volume_ml, brand: effectiveBrand(saved.get(p.id), p.name) }));
  return { products, of: lineMatcher(products) };
}

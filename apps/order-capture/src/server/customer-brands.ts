// Brands a customer buys (owner, 2026-11-15; mock-up https://claude.ai/artifact/JWrek4DzXeTiHb62Xa1JD1): New order and
// Change order list only these brands' products for the customer ("Show all brands" for a one-off). Rules:
//   * kept as a history (customer_brand_changes, 0024): the newest row is the current setting, nothing is deleted
//   * an empty list = every brand (the default for every customer until someone sets theirs)
//   * '' stands for the products with no brand on Rates ("Other")
//   * brands come from Rates (owner's brand, else the guess from the name); a saved brand no longer on Rates stays
//     until unticked, so a rename never silently hides a customer's products (the picker shows all when nothing matches)
//   * owner and Order desk change it; Accounts, Marketing staff and support read; every change is a Recent changes row
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { brandPalette, type BrandPalette } from "@/lib/brand";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, notFound } from "./http";
import { lastRates } from "./orders";
import { activeProducts, effectiveRates, type RateView } from "./rates";
import type { OcUser } from "./session";

const { customerBrandChanges, customers, orderLines, orders } = schema;

export const SetBrandsInput = z.object({ brands: z.array(z.string().trim().max(40)).max(30) }).strict();

/** How a brand value is shown: '' is the products with no brand. */
export const brandLabel = (b: string) => b || "Other (no brand)";
const key = (b: string) => b.trim().toLowerCase();
const sortBrands = (list: string[]) => [...list].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));

/** The customer's saved brands ([] = every brand) and who saved them last. */
export async function savedBrands(tx: OcTx, tenantId: string, customerId: string) {
  const [row] = await tx
    .select()
    .from(customerBrandChanges)
    .where(and(eq(customerBrandChanges.tenantId, tenantId), eq(customerBrandChanges.customerId, customerId)))
    .orderBy(desc(customerBrandChanges.createdAt))
    .limit(1);
  return { brands: row?.brands ?? [], changedByName: row?.changedByName ?? null, changedAt: row?.createdAt ?? null };
}

/** The brands of the plant's active products, as on Rates; '' when some product has no brand. */
function brandsOf(rates: RateView[]) {
  const seen = new Map<string, string>();
  for (const r of rates) if (!seen.has(key(r.brand))) seen.set(key(r.brand), r.brand);
  return sortBrands([...seen.values()]);
}

export interface BrandsCardView {
  customer_id: string;
  name: string;
  /** [] = every brand */
  brands: string[];
  /** what can be ticked: the brands on Rates, plus any saved brand no longer there */
  choices: string[];
  /** brands of the products on the customer's earlier (not cancelled) orders */
  from_orders: string[];
  changed_by: string | null;
  changed_at: string | null;
  can_set: boolean;
}

/** A customer's "Brands they buy" card (owner, Order desk, Accounts, Marketing staff, support). */
export async function brandsCard(user: OcUser, customerId: string): Promise<BrandsCardView> {
  requireAccess(user, "brands_view");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId)));
    if (!c) throw notFound("Customer not found");
    const rates = await effectiveRates(tx, user.tenantId, products);
    const saved = await savedBrands(tx, user.tenantId, customerId);
    const bought = Object.keys(await lastRates(tx, user.tenantId, customerId));
    const fromOrders = brandsOf(rates.filter((r) => bought.includes(r.sku_id)));
    const choices = brandsOf(rates);
    for (const b of saved.brands) if (!choices.some((x) => key(x) === key(b))) choices.push(b);
    return {
      customer_id: customerId,
      name: c.name,
      brands: sortBrands(saved.brands),
      choices: sortBrands(choices),
      from_orders: fromOrders,
      changed_by: saved.changedByName,
      changed_at: saved.changedAt?.toISOString() ?? null,
      can_set: can(user, "brands_set"),
    };
  });
}

/** Owner and Order desk: the brands this customer buys ([] = every brand). */
export async function setBrands(user: OcUser, customerId: string, input: z.infer<typeof SetBrandsInput>) {
  requireAccess(user, "brands_set");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId))).for("update");
    if (!c) throw notFound("Customer not found");
    const now = await savedBrands(tx, user.tenantId, customerId);
    const allowed = new Map([...brandsOf(await effectiveRates(tx, user.tenantId, products)), ...now.brands].map((b) => [key(b), b]));
    const brands: string[] = [];
    for (const b of input.brands) {
      const canon = allowed.get(key(b));
      if (canon === undefined) throw badRequest(`"${b}" is not a brand on Rates`);
      if (!brands.includes(canon)) brands.push(canon);
    }
    const next = sortBrands(brands);
    if (JSON.stringify(next) === JSON.stringify(sortBrands(now.brands))) return { changed: false };
    await tx.insert(customerBrandChanges).values({ tenantId: user.tenantId, customerId, brands: next, changedBy: user.userId, changedByName: user.name });
    await audit(tx, user, "customer.brands", customerId, { name: c.name, brands: next.map(brandLabel) });
    return { changed: true };
  });
}

/**
 * The customer list's brand labels (owner, 2026-11-15; mock-up https://claude.ai/artifact/F4xKTCKEAfjioGbsadR3gr), for
 * everyone who sees the list: per customer their ticked "Brands they buy", else the brands of the products on their
 * earlier (not cancelled) orders, as on the Brands card; none = no label. "Other (no brand)" is never a label. Also the
 * plant's palette, so each brand has its own colour.
 */
export async function listBrandLabels(user: OcUser, customerIds: string[]): Promise<{ labels: Record<string, string[]>; palette: BrandPalette }> {
  requireAccess(user, "view_customers");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const rates = await effectiveRates(tx, user.tenantId, products);
    const palette = brandPalette(rates.map((r) => r.brand));
    if (customerIds.length === 0) return { labels: {}, palette };
    const ids = sql`array[${sql.join(customerIds.map((id) => sql`${id}::uuid`), sql`, `)}]`;
    const saved = await tx.execute<{ customer_id: string; brands: string[] }>(sql`
      select distinct on (customer_id) customer_id, brands
        from ${customerBrandChanges}
       where tenant_id = ${user.tenantId} and customer_id = any(${ids})
       order by customer_id, created_at desc`);
    const bought = await tx.execute<{ customer_id: string; sku_id: string }>(sql`
      select distinct o.customer_id, l.sku_id
        from ${orders} o
        join ${orderLines} l on l.order_id = o.id and l.version = o.version and l.tenant_id = o.tenant_id
       where o.tenant_id = ${user.tenantId} and o.customer_id = any(${ids}) and o.status <> 'cancelled' and not l.free`);
    const brandOfSku = new Map(rates.map((r) => [r.sku_id, r.brand]));
    const labels: Record<string, string[]> = {};
    for (const r of saved.rows) if (r.brands.length) labels[r.customer_id] = sortBrands(r.brands).filter(Boolean);
    const fromOrders = new Map<string, string[]>();
    for (const r of bought.rows) {
      if (labels[r.customer_id]) continue;
      const b = brandOfSku.get(r.sku_id);
      if (!b) continue;
      const list = fromOrders.get(r.customer_id) ?? [];
      if (!list.some((x) => key(x) === key(b))) list.push(b);
      fromOrders.set(r.customer_id, list);
    }
    for (const [id, list] of fromOrders) labels[id] = sortBrands(list);
    return { labels, palette };
  });
}

/** What the order screens need for a customer's picker: their brands ([] = all) and the products they bought before. */
export async function pickerFor(tx: OcTx, tenantId: string, customerId: string) {
  const saved = await savedBrands(tx, tenantId, customerId);
  return { brands: saved.brands, lastRates: await lastRates(tx, tenantId, customerId) };
}

/** The same for Change order (owner and Order desk), by the order's id. */
export async function changePicker(user: OcUser, orderId: string) {
  requireAccess(user, "enter");
  return withTenant(user.tenantId, async (tx) => {
    const [o] = await tx.select({ customerId: orders.customerId }).from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, orderId)));
    if (!o) throw notFound("Order not found");
    return pickerFor(tx, user.tenantId, o.customerId);
  });
}

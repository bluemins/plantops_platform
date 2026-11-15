// Brands a customer buys (owner, 2026-11-15; mock-up https://claude.ai/artifact/JWrek4DzXeTiHb62Xa1JD1): New order and
// Change order list only these brands' products for the customer ("Show all brands" for a one-off). Rules:
//   * kept as a history (customer_brand_changes, 0024): the newest row is the current setting, nothing is deleted
//   * an empty list = every brand (the default for every customer until someone sets theirs)
//   * '' stands for the products with no brand on Rates ("Other")
//   * brands come from Rates (owner's brand, else the guess from the name); a saved brand no longer on Rates stays
//     until unticked, so a rename never silently hides a customer's products (the picker shows all when nothing matches)
//   * owner and Order desk change it; Accounts, Marketing staff and support read; every change is a Recent changes row
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, notFound } from "./http";
import { lastRates } from "./orders";
import { activeProducts, effectiveRates, type RateView } from "./rates";
import type { OcUser } from "./session";

const { customerBrandChanges, customers, orders } = schema;

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

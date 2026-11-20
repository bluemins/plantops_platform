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

const { billLines, bills, customerBrandChanges, customers, orderLines, orders } = schema;

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
 * earlier (not cancelled) orders and bills (bills since 2026-11-20); none = no label. "Other (no brand)" is never a label. Also the
 * plant's palette, so each brand has its own colour.
 */
export async function listBrandLabels(user: OcUser, customerIds: string[]): Promise<{ labels: Record<string, string[]>; palette: BrandPalette }> {
  requireAccess(user, "view_customers");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const rates = await effectiveRates(tx, user.tenantId, products);
    const palette = brandPalette(rates.map((r) => r.brand));
    if (customerIds.length === 0) return { labels: {}, palette };
    return { labels: await labelsOf(tx, user.tenantId, rates, customerIds), palette };
  });
}

/** The labels (see listBrandLabels) of the given customers, or of every customer of the plant (null). */
export async function labelsOf(tx: OcTx, tenantId: string, rates: RateView[], customerIds: string[] | null) {
  const only = (col: ReturnType<typeof sql>) =>
    customerIds ? sql`and ${col} = any(array[${sql.join(customerIds.map((id) => sql`${id}::uuid`), sql`, `)}])` : sql``;
  const saved = await tx.execute<{ customer_id: string; brands: string[] }>(sql`
    select distinct on (customer_id) customer_id, brands
      from ${customerBrandChanges}
     where tenant_id = ${tenantId} ${only(sql`customer_id`)}
     order by customer_id, created_at desc`);
  const bought = await tx.execute<{ customer_id: string; sku_id: string }>(sql`
    select distinct o.customer_id, l.sku_id
      from ${orders} o
      join ${orderLines} l on l.order_id = o.id and l.version = o.version and l.tenant_id = o.tenant_id
     where o.tenant_id = ${tenantId} ${only(sql`o.customer_id`)} and o.status <> 'cancelled' and not l.free
    union
    -- and the products on their bills, Zoho-imported ones too (owner, 2026-11-20): many customers came from Zoho with
    -- bills but no PlantOps order yet; a Zoho bill reaches its customer through the matched Zoho contact
    select distinct coalesce(b.customer_id, zc.customer_id) as customer_id, l.sku_id
      from ${bills} b
      join ${billLines} l on l.tenant_id = b.tenant_id and l.bill_id = b.id
      left join order_capture.zoho_contacts zc on zc.tenant_id = b.tenant_id and zc.id = b.zoho_contact_id
     where b.tenant_id = ${tenantId} and b.cancelled_at is null and l.sku_id is not null and not l.free
       and coalesce(b.customer_id, zc.customer_id) is not null ${only(sql`coalesce(b.customer_id, zc.customer_id)`)}`);
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
  for (const id of Object.keys(labels)) if (!labels[id]!.length) delete labels[id];
  return labels;
}

/** "No brand yet" in the customer list's brand filter (`?b=_`). */
export const NO_BRAND = "_";

export interface BrandIndex {
  /** every customer's labels (same rule as listBrandLabels) */
  labels: Record<string, string[]>;
  palette: BrandPalette;
  /** the brands with at least one customer (switched-off counted only with "Show switched-off"), A–Z */
  chips: { brand: string; count: number }[];
  /** customers with no label */
  none: number;
  /** the customer ids of each chip (by brand in lower case) and of NO_BRAND */
  ids: Record<string, string[]>;
}

/**
 * The customer list's brand filter (owner, 2026-11-16; mock-up https://claude.ai/artifact/Xe7FYe8DnR4APvLu8RzxXy): a
 * customer is under a brand when it is one of their labels on the list, so a customer with two brands is under both and
 * one with none is under "No brand yet". Everyone who sees the list may use it.
 */
export async function customerBrandIndex(user: OcUser, opts: { showOff?: boolean } = {}): Promise<BrandIndex> {
  requireAccess(user, "view_customers");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const rates = await effectiveRates(tx, user.tenantId, products);
    const palette = brandPalette(rates.map((r) => r.brand));
    const labels = await labelsOf(tx, user.tenantId, rates, null);
    const where = [eq(customers.tenantId, user.tenantId)];
    if (!opts.showOff) where.push(eq(customers.active, true));
    const rows = await tx.select({ id: customers.id }).from(customers).where(and(...where));
    // the name shown on a chip: as on Rates, else as first seen on a customer
    const shown = new Map(rates.filter((r) => r.brand).map((r) => [key(r.brand), r.brand]));
    const ids: Record<string, string[]> = { [NO_BRAND]: [] };
    for (const { id } of rows) {
      const ls = labels[id];
      if (!ls?.length) {
        ids[NO_BRAND]!.push(id);
        continue;
      }
      for (const b of ls) {
        if (!shown.has(key(b))) shown.set(key(b), b);
        (ids[key(b)] ??= []).push(id);
      }
    }
    const chips = sortBrands(Object.keys(ids).filter((k) => k !== NO_BRAND).map((k) => shown.get(k)!)).map((brand) => ({ brand, count: ids[key(brand)]!.length }));
    return { labels, palette, chips, none: ids[NO_BRAND]!.length, ids };
  });
}

/** The brand picked in the address (`?b=`): a chip's brand in lower case, NO_BRAND, or undefined (none / unknown). */
export function pickBrand(index: BrandIndex, v: string): string | undefined {
  if (v === NO_BRAND) return index.none > 0 ? NO_BRAND : undefined;
  const k = key(v);
  return k && k !== NO_BRAND && index.ids[k] ? k : undefined;
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

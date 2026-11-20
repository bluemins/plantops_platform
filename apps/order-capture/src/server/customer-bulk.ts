// Change many customers at once (owner, 2026-11-20; mock-up https://claude.ai/artifact/5qiMi1ZN47SAHKMiUNK8mz): Select
// on the customer list, tick customers, then ONE change per save: Brands they buy (add or replace), Place, Payment
// terms, or the Drop app on / off. Rules:
//   * the owner only (customers_bulk), even for fields Order desk / Marketing staff change one customer at a time
//   * at most 500 customers per save
//   * each customer goes through the same function as the one-customer screen (same checks, same Recent changes row),
//     in its own transaction: one refused customer (e.g. switched off, for Drop) is skipped with the reason, the rest saved
//   * the answer counts changed / already like that / skipped (with names and reasons)
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { BILL_TERMS, type BillTerms } from "@/lib/ledger";
import { PLACE_MAX, PLACE_MIN } from "@/lib/upload";
import { requireAccess } from "./access";
import { labelsOf, savedBrands, setBrands } from "./customer-brands";
import { updateCustomerDetails } from "./customer-details";
import { schema, withTenant } from "./db";
import { brandChoices, setDrop } from "./drop/manage";
import { dropAppOfPlant } from "./drop/config";
import { dropAccess } from "./drop/shops";
import { badRequest, HttpError } from "./http";
import { activeProducts, effectiveRates } from "./rates";
import type { OcUser } from "./session";

const { customers } = schema;

export const BULK_MAX = 500;

const Brand = z.string().trim().max(40);
export const BulkInput = z
  .object({
    ids: z.array(z.string().uuid()).min(1, "Tick at least one customer").max(BULK_MAX, `At most ${BULK_MAX} customers at once`),
    change: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("brands"), mode: z.enum(["add", "replace"]), brands: z.array(Brand).max(30) }).strict(),
      z.object({ kind: z.literal("place"), place: z.string().trim().min(PLACE_MIN, `Place: at least ${PLACE_MIN} characters`).max(PLACE_MAX) }).strict(),
      z.object({ kind: z.literal("terms"), terms: z.enum(BILL_TERMS as [BillTerms, ...BillTerms[]]).nullable() }).strict(),
      /** brands: the extra Drop brands; empty = keep each shop's as they are */
      z.object({ kind: z.literal("drop"), enabled: z.boolean(), brands: z.array(Brand).max(10).default([]) }).strict(),
    ]),
  })
  .strict();
export type BulkInput = z.input<typeof BulkInput>;

export interface BulkResult {
  changed: number;
  same: number;
  skipped: { name: string; reason: string }[];
}

/** What the Change… panel offers: the plant's brands, places in use (most used first), and Drop's brands (null = no Drop). */
export async function bulkSetup(user: OcUser) {
  requireAccess(user, "customers_bulk");
  const products = await activeProducts(user.tenantId);
  const app = dropAppOfPlant(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const rates = await effectiveRates(tx, user.tenantId, products);
    const brands = [...new Map(rates.map((r) => [r.brand.toLowerCase(), r.brand])).values()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const places = await tx.execute<{ place: string; n: number }>(sql`
      select place, count(*)::int as n from ${customers}
       where tenant_id = ${user.tenantId} and active
       group by place order by count(*) desc, place limit 300`);
    const drop = app ? { main: app.brand, choices: await brandChoices(tx, user.tenantId, app.brand) } : null;
    return { brands, places: places.rows.map((r) => ({ place: r.place, count: r.n })), drop, max: BULK_MAX };
  });
}

export async function bulkChange(user: OcUser, input: z.infer<typeof BulkInput>): Promise<BulkResult> {
  requireAccess(user, "customers_bulk");
  const ids = [...new Set(input.ids)];
  const { change } = input;
  if (change.kind === "drop" && !dropAppOfPlant(user.tenantId)) throw badRequest("The Drop app isn't set up for this plant yet (ask PlantOps).");

  // names (for the skipped list) and, for "add" brands, what each customer has now: their saved brands, else the tags
  // the list shows (from orders and bills), so adding a brand never hides one they already buy
  const products = change.kind === "brands" ? await activeProducts(user.tenantId) : [];
  const { names, base, dropNow } = await withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), inArray(customers.id, ids)));
    const names = new Map(rows.map((r) => [r.id, r.name]));
    const base = new Map<string, string[]>();
    if (change.kind === "brands" && change.mode === "add") {
      const labels = await labelsOf(tx, user.tenantId, await effectiveRates(tx, user.tenantId, products), rows.map((r) => r.id));
      for (const r of rows) {
        const saved = (await savedBrands(tx, user.tenantId, r.id)).brands;
        base.set(r.id, saved.length ? saved : (labels[r.id] ?? []));
      }
    }
    const dropNow = new Map<string, string[]>();
    if (change.kind === "drop" && !change.brands.length) for (const r of rows) dropNow.set(r.id, (await dropAccess(tx, user.tenantId, r.id)).brands);
    return { names, base, dropNow };
  });

  const result: BulkResult = { changed: 0, same: 0, skipped: [] };
  for (const id of ids) {
    const name = names.get(id);
    if (!name) {
      result.skipped.push({ name: "(unknown customer)", reason: "Not found in this plant." });
      continue;
    }
    try {
      let changed: boolean;
      if (change.kind === "brands") {
        const brands = change.mode === "add" ? [...(base.get(id) ?? []), ...change.brands] : change.brands;
        changed = (await setBrands(user, id, { brands })).changed;
      } else if (change.kind === "place") {
        changed = (await updateCustomerDetails(user, id, { place: change.place })).changed.length > 0;
      } else if (change.kind === "terms") {
        changed = (await updateCustomerDetails(user, id, { payment_terms: change.terms })).changed.length > 0;
      } else {
        changed = (await setDrop(user, id, { enabled: change.enabled, brands: change.brands.length ? change.brands : (dropNow.get(id) ?? []) })).changed;
      }
      if (changed) result.changed++;
      else result.same++;
    } catch (err) {
      // a plain refusal for this one customer (400 / 404 / 409) skips it; anything else stops the save
      if (err instanceof HttpError && err.status < 500 && err.status !== 401 && err.status !== 403) result.skipped.push({ name, reason: err.message });
      else throw err;
    }
  }
  return result;
}

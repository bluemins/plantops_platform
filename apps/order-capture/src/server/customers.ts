// The plant's customers (docs/ORDER_CAPTURE_PHASE_PLAN.md "Customers"): name, phone, place - nothing else. Rules,
// checked here on the server through the access table:
//   * owner and Order desk add, edit name / place and switch customers off / on; PlantOps support only reads
//   * the phone (normalised Indian mobile) is the customer's identity: one customer per phone per plant (the
//     database's unique index is the final guard) and it can never be changed - a different number is a new customer
//   * customers are switched off, never deleted; old orders keep their own copy of name / phone / place
//   * every change goes into the audit log ("Recent changes")
import { and, asc, eq, ilike, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { clean, NAME_MAX, NAME_MIN, PHONE_TYPED_MAX, PLACE_MAX, PLACE_MIN } from "@/lib/upload";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, notFound } from "./http";
import type { OcUser } from "./session";

const { customers } = schema;

export interface CustomerView {
  id: string;
  name: string;
  phone: string;
  place: string;
  active: boolean;
}
const view = (c: typeof customers.$inferSelect): CustomerView => ({ id: c.id, name: c.name, phone: c.phone, place: c.place, active: c.active });

// ---------- inputs ----------
const Name = z.string().transform(clean).pipe(z.string().min(NAME_MIN, "Please enter the customer's name (at least 2 letters)").max(NAME_MAX, `A name has at most ${NAME_MAX} characters`));
const Place = z.string().transform(clean).pipe(z.string().min(PLACE_MIN, "Please enter the place (at least 2 letters)").max(PLACE_MAX, `A place has at most ${PLACE_MAX} characters`));
export const CustomerInput = z.object({ name: Name, phone: z.string().trim().max(PHONE_TYPED_MAX, "Please enter a 10-digit mobile number"), place: Place }).strict();
/** The phone is not here on purpose: it can't be changed. A request that sends one is refused (strict). */
export const CustomerPatch = z
  .object({
    name: Name.optional(),
    place: Place.optional(),
    active: z.boolean().optional(),
    phone: z.never({ error: "The phone can't be changed: a different number is a new customer" }).optional(),
  })
  .strict();

/** The customer with this (normalised) phone in this plant, switched on or off. */
export async function findByPhone(tx: OcTx, tenantId: string, phone: string) {
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)));
  return c ?? null;
}

const isUniqueViolation = (err: unknown) => ((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) === "23505";

// ---------- reading ----------
/**
 * The list screen: switched-on customers by name (and switched-off ones when asked), searched by name, place or
 * phone digits; at most `limit`. `off` = how many are switched off, for the "Show switched-off" tick.
 */
export async function listCustomers(user: OcUser, opts: { q?: string; showOff?: boolean; limit?: number } = {}) {
  requireAccess(user, "read");
  const q = (opts.q ?? "").trim();
  const digits = normalisePhone(q) ?? q.replace(/\D/g, "");
  return withTenant(user.tenantId, async (tx) => {
    const where = [eq(customers.tenantId, user.tenantId)];
    if (!opts.showOff) where.push(eq(customers.active, true));
    if (q) {
      const text = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(customers.name, text), ilike(customers.place, text), ...(digits.length >= 3 ? [like(customers.phone, `%${digits}%`)] : []))!);
    }
    const limit = opts.limit ?? 200;
    const rows = await tx.select().from(customers).where(and(...where)).orderBy(asc(sql`lower(${customers.name})`), asc(customers.place)).limit(limit + 1);
    const [counts] = await tx
      .select({ total: sql<number>`count(*)::int`, off: sql<number>`count(*) filter (where not ${customers.active})::int` })
      .from(customers)
      .where(eq(customers.tenantId, user.tenantId));
    return { customers: rows.slice(0, limit).map(view), more: rows.length > limit, total: counts?.total ?? 0, off: counts?.off ?? 0 };
  });
}

// ---------- changes (owner and Order desk) ----------
/**
 * Add a customer. A phone that is already in the list never makes a second customer: the existing one comes back
 * (`created: false`) so the screen can show it (and switch it back on).
 */
export async function createCustomer(user: OcUser, input: z.infer<typeof CustomerInput>): Promise<{ created: boolean; customer: CustomerView }> {
  requireAccess(user, "customers");
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Please enter a 10-digit mobile number");
  try {
    return await withTenant(user.tenantId, async (tx) => {
      const have = await findByPhone(tx, user.tenantId, phone);
      if (have) return { created: false, customer: view(have) };
      const [c] = await tx
        .insert(customers)
        .values({ tenantId: user.tenantId, name: input.name, phoneTyped: input.phone, phone, place: input.place, createdBy: user.userId, createdByName: user.name })
        .returning();
      await audit(tx, user, "customer.add", c!.id, { name: c!.name, place: c!.place, phone });
      return { created: true, customer: view(c!) };
    });
  } catch (err) {
    // someone else added the same number at the same moment: the database's one-per-phone rule refused ours
    if (!isUniqueViolation(err)) throw err;
    const have = await withTenant(user.tenantId, (tx) => findByPhone(tx, user.tenantId, phone));
    return { created: false, customer: view(have!) };
  }
}

/** Edit name / place, or switch off / on. The phone never changes. Nothing changed = nothing written. */
export async function updateCustomer(user: OcUser, id: string, patch: z.infer<typeof CustomerPatch>): Promise<CustomerView> {
  requireAccess(user, "customers");
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)));
    if (!c) throw notFound("Customer not found");
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (patch.name !== undefined && patch.name !== c.name) changes.name = { from: c.name, to: patch.name };
    if (patch.place !== undefined && patch.place !== c.place) changes.place = { from: c.place, to: patch.place };
    if (patch.active !== undefined && patch.active !== c.active) changes.active = { from: c.active, to: patch.active };
    if (!Object.keys(changes).length) return view(c);
    const [u] = await tx
      .update(customers)
      .set({ name: patch.name ?? c.name, place: patch.place ?? c.place, active: patch.active ?? c.active, updatedAt: new Date() })
      .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)))
      .returning();
    await audit(tx, user, "customer.update", id, { name: u!.name, phone: u!.phone, changes });
    return view(u!);
  });
}

// The staff side of Drop (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 1; mock-ups 1–4): a customer's Drop card (switch,
// brands, phones, last login), extra phones, Make main phone, and the owner's Drop shops list. Rules:
//   * owner: everything; Order desk: sees the card and adds / removes extra phones; PlantOps support: reads
//   * switching a shop off, removing a phone or switching the customer off ends those sessions (session.ts checks every
//     request, so nothing outlives it)
//   * a phone belongs to one shop only: the clash is named here, and the database trigger refuses it anyway
//   * every change is an audit row shown in Recent changes (drop.*)
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { can, requireAccess } from "../access";
import { audit } from "../audit";
import { schema, withTenant, type OcTx } from "../db";
import { badRequest, conflict, notFound } from "../http";
import { activeProducts, effectiveRates } from "../rates";
import type { OcUser } from "../session";
import { dropAppOfPlant } from "./config";
import { customerOfPhone, dropAccess, extraPhoneOwner, extraPhones } from "./shops";
import type { SessionEndReason } from "../schema";

const { appAccessChanges, appPhoneChanges, appSessions, customers } = schema;

export const SetDropInput = z
  .object({ enabled: z.boolean(), brands: z.array(z.string().trim().min(1).max(40)).max(10).default([]) })
  .strict();
export const PhoneInput = z.object({ phone: z.string().trim().min(1, "Please enter the mobile number").max(30) }).strict();
export const MakeMainInput = z.object({ phone: z.string().trim().max(30), reason: z.string().trim().max(200) }).strict();

const NOT_SET_UP = "The Drop app isn't set up for this plant yet (ask PlantOps).";

async function customerRow(tx: OcTx, tenantId: string, id: string, lock = false) {
  const q = tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));
  const [c] = lock ? await q.for("update") : await q;
  if (!c) throw notFound("Customer not found");
  return c;
}

/** End the open sessions of a shop (or of one of its phones). */
export async function endSessions(tx: OcTx, tenantId: string, customerId: string, reason: SessionEndReason, phone?: string) {
  await tx
    .update(appSessions)
    .set({ endedAt: new Date(), endReason: reason })
    .where(and(eq(appSessions.tenantId, tenantId), eq(appSessions.customerId, customerId), isNull(appSessions.endedAt), ...(phone ? [eq(appSessions.phone, phone)] : [])));
}

/** Brands the owner may tick for a shop: those on Rates (owner's, else guessed) of active products, minus the main one. */
async function brandChoices(tx: OcTx, tenantId: string, main: string) {
  const rates = await effectiveRates(tx, tenantId, await activeProducts(tenantId));
  const seen = new Map<string, string>();
  for (const r of rates) if (r.brand && r.brand.toLowerCase() !== main.toLowerCase() && !seen.has(r.brand.toLowerCase())) seen.set(r.brand.toLowerCase(), r.brand);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

async function lastLogins(tx: OcTx, tenantId: string, customerId: string) {
  const r = await tx.execute<{ phone: string; at: Date | string }>(sql`
    select phone, max(created_at) as at from order_capture.app_sessions
     where tenant_id = ${tenantId} and customer_id = ${customerId} group by phone`);
  return new Map(r.rows.map((x) => [x.phone, new Date(x.at).toISOString()]));
}

export interface DropCardView {
  name: string;
  /** false = DROP_APPS has no app for this plant: the card says so and nothing can be switched on */
  set_up: boolean;
  main_brand: string | null;
  enabled: boolean;
  brands: string[];
  brand_choices: string[];
  changed_by: string | null;
  changed_at: string | null;
  customer_active: boolean;
  main: { phone: string; last_login: string | null };
  extras: { phone: string; added_by: string; added_at: string; last_login: string | null }[];
  can: { manage: boolean; phones: boolean };
}

/** A customer's Drop card (owner, Order desk, support). */
export async function dropCard(user: OcUser, customerId: string): Promise<DropCardView> {
  requireAccess(user, "drop_view");
  const app = dropAppOfPlant(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const c = await customerRow(tx, user.tenantId, customerId);
    // one after another: a transaction is one database connection
    const access = await dropAccess(tx, user.tenantId, customerId);
    const extras = await extraPhones(tx, user.tenantId, customerId);
    const logins = await lastLogins(tx, user.tenantId, customerId);
    const choices = app ? await brandChoices(tx, user.tenantId, app.brand) : [];
    return {
      name: c.name,
      set_up: app !== null,
      main_brand: app?.brand ?? null,
      enabled: access.enabled,
      brands: access.brands,
      brand_choices: [...new Set([...choices, ...access.brands])].sort((a, b) => a.localeCompare(b)),
      changed_by: access.changedByName,
      changed_at: access.changedAt?.toISOString() ?? null,
      customer_active: c.active,
      main: { phone: c.phone, last_login: logins.get(c.phone) ?? null },
      extras: extras.map((e) => ({ phone: e.phone, added_by: e.addedByName, added_at: e.addedAt.toISOString(), last_login: logins.get(e.phone) ?? null })),
      can: { manage: can(user, "drop_manage"), phones: can(user, "drop_phones") },
    };
  });
}

/** Owner: switch a shop on / off for Drop and choose the brands it sees besides the main one. */
export async function setDrop(user: OcUser, customerId: string, input: z.infer<typeof SetDropInput>) {
  requireAccess(user, "drop_manage");
  const app = dropAppOfPlant(user.tenantId);
  if (!app) throw conflict(NOT_SET_UP);
  return withTenant(user.tenantId, async (tx) => {
    const c = await customerRow(tx, user.tenantId, customerId, true);
    if (input.enabled && !c.active) throw conflict("This customer is switched off. Switch the customer on first.");
    const choices = await brandChoices(tx, user.tenantId, app.brand);
    const now = await dropAccess(tx, user.tenantId, customerId);
    const allowed = new Map([...choices, ...now.brands].map((b) => [b.toLowerCase(), b]));
    const brands: string[] = [];
    for (const b of input.brands) {
      const canon = allowed.get(b.toLowerCase());
      if (!canon) throw badRequest(`"${b}" is not a brand on Rates`);
      if (!brands.includes(canon)) brands.push(canon);
    }
    brands.sort((a, b) => a.localeCompare(b));
    const brandsChanged = brands.join("|") !== [...now.brands].sort((a, b) => a.localeCompare(b)).join("|");
    if (now.enabled === input.enabled && !brandsChanged) return { changed: false };
    await tx.insert(appAccessChanges).values({ tenantId: user.tenantId, customerId, enabled: input.enabled, brands, changedBy: user.userId, changedByName: user.name });
    if (now.enabled !== input.enabled) await audit(tx, user, "drop.switch", customerId, { name: c.name, enabled: input.enabled });
    if (brandsChanged) await audit(tx, user, "drop.brands", customerId, { name: c.name, brands, main: app.brand });
    if (!input.enabled) await endSessions(tx, user.tenantId, customerId, "switched_off");
    return { changed: true };
  });
}

/** Why this phone can't be added to this shop, or null. */
async function phoneClash(tx: OcTx, tenantId: string, customerId: string, phone: string): Promise<string | null> {
  const found = await customerOfPhone(tx, tenantId, phone);
  if (!found) return null;
  const pretty = `${phone.slice(0, 5)} ${phone.slice(5)}`;
  if (found.customer.id === customerId) return found.isMain ? `${pretty} is already this shop's main phone.` : `${pretty} is already an extra phone of this shop.`;
  return found.isMain
    ? `${pretty} is already the main phone of ${found.customer.name}. A phone can belong to one shop only.`
    : `${pretty} is already an extra phone of ${found.customer.name}. A phone can belong to one shop only.`;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505";

/** Owner / Order desk: add an extra phone (it sees the same as the main phone). */
export async function addPhone(user: OcUser, customerId: string, input: z.infer<typeof PhoneInput>) {
  requireAccess(user, "drop_phones");
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Please enter a 10-digit Indian mobile number");
  try {
    return await withTenant(user.tenantId, async (tx) => {
      const c = await customerRow(tx, user.tenantId, customerId);
      const clash = await phoneClash(tx, user.tenantId, customerId, phone);
      if (clash) throw conflict(clash);
      await tx.insert(appPhoneChanges).values({ tenantId: user.tenantId, customerId, phone, action: "add", changedBy: user.userId, changedByName: user.name });
      await audit(tx, user, "drop.phone_add", customerId, { name: c.name, phone });
      return { phone };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This number was just added to another shop. A phone can belong to one shop only.");
    throw err;
  }
}

/** Owner / Order desk: remove an extra phone; it is logged out at once. */
export async function removePhone(user: OcUser, customerId: string, input: z.infer<typeof PhoneInput>) {
  requireAccess(user, "drop_phones");
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Please enter a 10-digit Indian mobile number");
  return withTenant(user.tenantId, async (tx) => {
    const c = await customerRow(tx, user.tenantId, customerId);
    if ((await extraPhoneOwner(tx, user.tenantId, phone)) !== customerId) throw notFound("This number is not an extra phone of this shop");
    await tx.insert(appPhoneChanges).values({ tenantId: user.tenantId, customerId, phone, action: "remove", changedBy: user.userId, changedByName: user.name });
    await endSessions(tx, user.tenantId, customerId, "phone_removed", phone);
    await audit(tx, user, "drop.phone_remove", customerId, { name: c.name, phone });
    return { ok: true };
  });
}

/**
 * Owner: an extra phone becomes the main phone (the customer's mobile in Sales) and the old main phone stays as an extra
 * phone. Same rule as changing the mobile on Edit: a reason, and the "customer.details" audit row. Nobody is logged out.
 */
export async function makeMain(user: OcUser, customerId: string, input: z.infer<typeof MakeMainInput>) {
  requireAccess(user, "drop_manage");
  const phone = normalisePhone(input.phone);
  if (!phone) throw badRequest("Please enter a 10-digit Indian mobile number");
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("Making another phone the main one needs a reason (e.g. owner changed his number).");
  return withTenant(user.tenantId, async (tx) => {
    const c = await customerRow(tx, user.tenantId, customerId, true);
    if ((await extraPhoneOwner(tx, user.tenantId, phone)) !== customerId) throw notFound("This number is not an extra phone of this shop");
    const old = c.phone;
    await tx.update(customers).set({ phone, phoneTyped: phone, updatedAt: new Date() }).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId)));
    const by = { tenantId: user.tenantId, customerId, changedBy: user.userId, changedByName: user.name };
    await tx.insert(appPhoneChanges).values({ ...by, phone, action: "remove" });
    await tx.insert(appPhoneChanges).values({ ...by, phone: old, action: "add" });
    await audit(tx, user, "customer.details", customerId, { name: c.name, phone, changes: { phone: { from: old, to: phone } }, reason });
    await audit(tx, user, "drop.make_main", customerId, { name: c.name, from: old, to: phone, reason });
    return { phone, extra: old };
  });
}

export interface DropShopView {
  id: string;
  name: string;
  place: string;
  phones: number;
  brands: string[];
  last_login: string | null;
}

/** Owner (and support): the shops switched on for Drop, with the pilot's three numbers. */
export async function dropShops(user: OcUser) {
  requireAccess(user, "drop_shops");
  const app = dropAppOfPlant(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const r = await tx.execute<{ id: string; name: string; place: string; brands: string[]; extras: number; last_login: Date | string | null; used_week: boolean }>(sql`
      with access as (
        select distinct on (customer_id) customer_id, enabled, brands
          from order_capture.app_access_changes where tenant_id = ${user.tenantId}
         order by customer_id, created_at desc, id desc
      ), extras as (
        select customer_id, count(*)::int as n from (
          select distinct on (customer_id, phone) customer_id, action from order_capture.app_phone_changes
           where tenant_id = ${user.tenantId} order by customer_id, phone, created_at desc, id desc
        ) x where action = 'add' group by customer_id
      ), logins as (
        select customer_id, max(created_at) as last_login, bool_or(last_seen_at > now() - interval '7 days') as used_week
          from order_capture.app_sessions where tenant_id = ${user.tenantId} group by customer_id
      )
      select c.id, c.name, c.place, a.brands, coalesce(e.n, 0) as extras, l.last_login, coalesce(l.used_week, false) as used_week
        from access a join order_capture.customers c on c.tenant_id = ${user.tenantId} and c.id = a.customer_id
        left join extras e on e.customer_id = c.id
        left join logins l on l.customer_id = c.id
       where a.enabled
       order by l.last_login desc nulls last, c.name`);
    const shops: DropShopView[] = r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      place: x.place,
      phones: 1 + Number(x.extras),
      brands: [app?.brand ?? "", ...x.brands].filter(Boolean),
      last_login: x.last_login ? new Date(x.last_login).toISOString() : null,
    }));
    return {
      set_up: app !== null,
      shops,
      counts: { on: shops.length, logged_in: shops.filter((s) => s.last_login).length, used_week: r.rows.filter((x) => x.used_week).length },
    };
  });
}

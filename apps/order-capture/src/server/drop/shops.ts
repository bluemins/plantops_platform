// Which shops may use Drop, and their phones (docs/CUSTOMER_APP_PHASE_PLAN.md "Who can use Drop"). Both are kept as
// histories (app_access_changes, app_phone_changes): the newest row wins, nothing is changed or deleted. The main phone
// is the customer's mobile (customers.phone); extra phones log in to the same shop and see the same. A phone belongs to
// one shop only (checked here, and by a database trigger as the backstop).
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type OcTx } from "../db";

const { appAccessChanges, customers } = schema;

export interface DropAccess {
  enabled: boolean;
  /** brands shown besides the plant's main brand */
  brands: string[];
  changedByName: string | null;
  changedAt: Date | null;
}

const OFF: DropAccess = { enabled: false, brands: [], changedByName: null, changedAt: null };

/** The shop's current Drop setting (no row = off). */
export async function dropAccess(tx: OcTx, tenantId: string, customerId: string): Promise<DropAccess> {
  const [r] = await tx
    .select()
    .from(appAccessChanges)
    .where(and(eq(appAccessChanges.tenantId, tenantId), eq(appAccessChanges.customerId, customerId)))
    .orderBy(desc(appAccessChanges.createdAt), desc(appAccessChanges.id))
    .limit(1);
  return r ? { enabled: r.enabled, brands: r.brands, changedByName: r.changedByName, changedAt: r.createdAt } : OFF;
}

export interface ExtraPhone {
  phone: string;
  addedByName: string;
  addedAt: Date;
}

/** The newest row per (customer, phone) that is 'add'; optionally one customer's. */
async function activeExtras(tx: OcTx, tenantId: string, customerId?: string) {
  const rows = await tx.execute<{ customer_id: string; phone: string; changed_by_name: string; created_at: Date | string }>(sql`
    select customer_id, phone, changed_by_name, created_at from (
      select distinct on (customer_id, phone) customer_id, phone, action, changed_by_name, created_at
      from order_capture.app_phone_changes
      where tenant_id = ${tenantId} ${customerId ? sql`and customer_id = ${customerId}` : sql``}
      order by customer_id, phone, created_at desc, id desc
    ) newest where action = 'add' order by created_at`);
  return rows.rows.map((r) => ({ customerId: r.customer_id, phone: r.phone, addedByName: r.changed_by_name, addedAt: new Date(r.created_at) }));
}

/** One shop's active extra phones, oldest first. */
export async function extraPhones(tx: OcTx, tenantId: string, customerId: string): Promise<ExtraPhone[]> {
  return (await activeExtras(tx, tenantId, customerId)).map(({ phone, addedByName, addedAt }) => ({ phone, addedByName, addedAt }));
}

/** Every active extra phone of the plant → its shop (for the customer upload and the Zoho match). */
export async function extraPhoneOwners(tx: OcTx, tenantId: string): Promise<Map<string, string>> {
  return new Map((await activeExtras(tx, tenantId)).map((e) => [e.phone, e.customerId]));
}

/** The shop this phone is an active extra phone of, or null. */
export async function extraPhoneOwner(tx: OcTx, tenantId: string, phone: string): Promise<string | null> {
  const r = await tx.execute<{ owner: string | null }>(sql`select order_capture.app_phone_owner(${tenantId}::uuid, ${phone}) as owner`);
  return r.rows[0]?.owner ?? null;
}

export type CustomerRow = typeof customers.$inferSelect;

/** The customer whose main phone this is, else whose active extra phone it is; null = nobody's. */
export async function customerOfPhone(tx: OcTx, tenantId: string, phone: string): Promise<{ customer: CustomerRow; isMain: boolean } | null> {
  const [main] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)));
  if (main) return { customer: main, isMain: true };
  const owner = await extraPhoneOwner(tx, tenantId, phone);
  if (!owner) return null;
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, owner)));
  return c ? { customer: c, isMain: false } : null;
}

/** Whether this phone may log in to Drop now: it is the main or an extra phone of an active, switched-on shop. */
export async function shopForLogin(tx: OcTx, tenantId: string, phone: string) {
  const found = await customerOfPhone(tx, tenantId, phone);
  if (!found || !found.customer.active) return null;
  const access = await dropAccess(tx, tenantId, found.customer.id);
  return access.enabled ? { customer: found.customer, access } : null;
}

/** Why a session of this shop / phone must end now, or null when it may go on. */
export async function sessionProblem(tx: OcTx, tenantId: string, customerId: string, phone: string) {
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (!c || !c.active) return "customer_off" as const;
  if (!(await dropAccess(tx, tenantId, customerId)).enabled) return "switched_off" as const;
  if (c.phone !== phone && (await extraPhoneOwner(tx, tenantId, phone)) !== customerId) return "phone_removed" as const;
  return null;
}


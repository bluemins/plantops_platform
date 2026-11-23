// Promise to pay (owner, 2026-11-23): saved from the Accounts desk. Never touches a bill or a payment.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { paise, rupees } from "@/lib/ledger";
import type { PromiseRow } from "@/lib/promises";
import { requireAccess } from "./access";
import { deskCustomerDues } from "./accounts-desk";
import { audit } from "./audit";
import { withTenant } from "./db";
import { badRequest } from "./http";
import { istToday } from "./ledger";
import type { OcUser } from "./session";

export const MAX_PROMISE_DAYS = 90;

export const PromiseInput = z.object({
  customer_key: z.string().regex(/^[cz]:[0-9a-f-]{36}$/i, "Pick a customer"),
  promised_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the promised date"),
  amount: z
    .string()
    .trim()
    .regex(/^(\d{1,10}(\.\d{1,2})?)?$/, "Amount: a number with at most 2 decimals")
    .optional(),
  note: z.string().trim().max(200, "Note: at most 200 characters").optional(),
});

/** Every promise of the plant; a Zoho contact's promise follows the customer it is linked to now (as Receivables does). */
export async function allPromises(tenantId: string): Promise<PromiseRow[]> {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ id: string; customer_key: string; promised_on: string; amount: string | null; note: string | null; by: string; created_on: string; created_at: string }>(sql`
      select p.id,
             coalesce('c:' || coalesce(p.customer_id, zc.customer_id)::text, 'z:' || p.zoho_contact_id::text) as customer_key,
             p.promised_on::text, p.amount::text, p.note, p.created_by_name as by,
             (p.created_at at time zone 'Asia/Kolkata')::date::text as created_on,
             to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as created_at
        from order_capture.payment_promises p
        left join order_capture.zoho_contacts zc on zc.tenant_id = p.tenant_id and zc.id = p.zoho_contact_id
       where p.tenant_id = ${tenantId}`);
    return rows.map((r) => ({ ...r, amount: r.amount === null ? null : paise(r.amount) }));
  });
}

export async function addPromise(user: OcUser, raw: z.input<typeof PromiseInput>, today = istToday()) {
  requireAccess(user, "payment_promise");
  const parsed = PromiseInput.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the promise");
  const p = parsed.data;
  const last = new Date(Date.parse(today) + MAX_PROMISE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const real = new Date(`${p.promised_on}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== p.promised_on) throw badRequest("Pick a real date");
  if (p.promised_on < today) throw badRequest("The promised date can't be in the past");
  if (p.promised_on > last) throw badRequest(`The promised date must be within ${MAX_PROMISE_DAYS} days`);
  const dues = await deskCustomerDues(user, today);
  const who = dues.find((d) => d.key.toLowerCase() === p.customer_key.toLowerCase());
  if (!who) throw badRequest("This customer doesn't owe anything now");
  const amount = p.amount ? paise(p.amount) : null;
  if (amount !== null && amount <= 0n) throw badRequest("Amount must be more than zero");
  if (amount !== null && amount > who.due) throw badRequest(`Amount can't be more than the ${rupees(who.due)} due`);
  const id = who.key.slice(2);
  return withTenant(user.tenantId, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into order_capture.payment_promises (tenant_id, customer_id, zoho_contact_id, promised_on, amount, note, created_by, created_by_name)
      values (${user.tenantId}, ${who.key.startsWith("c:") ? id : null}, ${who.key.startsWith("z:") ? id : null}, ${p.promised_on},
              ${amount === null ? null : rupees(amount)}, ${p.note || null}, ${user.userId}, ${user.name})
      returning id`);
    await audit(tx, user, "customer.promise", id, { name: who.name, promised_on: p.promised_on, amount: amount === null ? null : rupees(amount) });
    return { id: rows[0]!.id };
  });
}

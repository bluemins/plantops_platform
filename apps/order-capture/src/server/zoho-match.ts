// The Match screen (owner only; docs/ZOHO_IMPORT_PHASE_PLAN.md, "Match after import"): every Zoho contact next to the
// plant's customers, so nothing is missed. The import links only exact, unique mobiles; here the owner links the rest
// (suggestions by mobile and by name), changes a link, or adds a contact as a new customer. A contact's bills and
// payments follow its link (bills point at the contact, the contact at the customer).
import { and, eq, isNull, sql } from "drizzle-orm";
import { normalisePhone } from "@plantops/module-kit/phone";
import { z } from "zod";
import { newestFirst } from "@/lib/by-mobile";
import { suggest } from "@/lib/name-match";
import { customerName, placeFromName } from "@/lib/zoho-import";
import { requireAccess } from "./access";
import { audit } from "./audit";
import { insertCustomer } from "./customers";
import { schema, withTenant } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const { customers, zohoContacts } = schema;

export type MatchContact = {
  id: string;
  name: string;
  mobile: string | null;
  gstin: string | null;
  customer: { id: string; name: string; phone: string } | null;
  bills: number;
  billed: string;
  last_bill: string | null;
  /** for a contact not matched yet: likely customers (same mobile first, then by name) */
  suggestions: { id: string; name: string; phone: string; place: string; why: "mobile" | "name"; score: number }[];
  /** what "Add as new customer" starts from */
  place_guess: string;
};
export type MatchCustomer = {
  id: string;
  name: string;
  phone: string;
  place: string;
  active: boolean;
  contacts: number;
  /** for a customer with no Zoho contact: unmatched contacts that look like them */
  suggestions: { id: string; name: string; mobile: string | null; score: number }[];
};

export async function matchData(user: OcUser) {
  requireAccess(user, "zoho_match");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; name: string; mobile: string | null; gstin: string | null; customer_id: string | null; bills: number; billed: string; last_bill: string | null }>(sql`
      select c.id, c.name, c.mobile, c.gstin, c.customer_id,
             count(b.id)::int as bills, coalesce(sum(b.total), 0)::text as billed, max(b.bill_date)::text as last_bill
        from order_capture.zoho_contacts c
        left join order_capture.bills b on b.tenant_id = c.tenant_id and b.zoho_contact_id = c.id and b.cancelled_at is null
       where c.tenant_id = ${user.tenantId}
       group by c.id
       order by c.name`);
    const cust = await tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone, place: customers.place, active: customers.active })
      .from(customers)
      .where(eq(customers.tenantId, user.tenantId))
      .orderBy(customers.name);
    const byId = new Map(cust.map((c) => [c.id, c]));
    const byPhone = new Map(cust.map((c) => [c.phone, c]));
    const linkedCount = new Map<string, number>();
    for (const r of rows.rows) if (r.customer_id) linkedCount.set(r.customer_id, (linkedCount.get(r.customer_id) ?? 0) + 1);

    const contacts: MatchContact[] = rows.rows.map((r) => {
      const linked = r.customer_id ? byId.get(r.customer_id)! : null;
      let suggestions: MatchContact["suggestions"] = [];
      if (!linked) {
        const same = r.mobile ? byPhone.get(r.mobile) : undefined;
        const byName = suggest(r.name, cust).map((s) => ({ ...s.item, why: "name" as const, score: s.score }));
        suggestions = [...(same ? [{ ...same, why: "mobile" as const, score: 1 }] : []), ...byName.filter((s) => s.id !== same?.id)]
          .slice(0, 3)
          .map(({ id, name, phone, place, why, score }) => ({ id, name, phone, place, why, score }));
      }
      return {
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        gstin: r.gstin,
        customer: linked ? { id: linked.id, name: linked.name, phone: linked.phone } : null,
        bills: r.bills,
        billed: r.billed,
        last_bill: r.last_bill,
        suggestions,
        place_guess: placeFromName(r.name),
      };
    });
    const unmatched = contacts.filter((c) => !c.customer);
    const customerRows: MatchCustomer[] = cust.map((c) => ({
      ...c,
      contacts: linkedCount.get(c.id) ?? 0,
      suggestions: linkedCount.has(c.id) ? [] : suggest(c.name, unmatched).map((s) => ({ id: s.item.id, name: s.item.name, mobile: s.item.mobile, score: s.score })),
    }));
    return {
      contacts,
      customers: customerRows,
      counts: {
        contacts: contacts.length,
        linked: contacts.length - unmatched.length,
        unmatched: unmatched.length,
        customers: cust.length,
        customers_with_zoho: linkedCount.size,
        customers_without_zoho: cust.length - linkedCount.size,
      },
    };
  });
}
export type MatchData = Awaited<ReturnType<typeof matchData>>;

export const MatchAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), contact_id: z.uuid(), customer_id: z.uuid() }),
  z.object({ action: z.literal("unlink"), contact_id: z.uuid() }),
  z.object({
    action: z.literal("new_customer"),
    contact_id: z.uuid(),
    name: z.string().trim().min(2, "Name: at least 2 letters").max(100),
    phone: z.string().trim().min(1, "Mobile is needed for a customer").max(30),
    place: z.string().trim().min(2, "Place: at least 2 letters").max(200),
  }),
  // every contact not matched yet that has no mobile → one customer (found by this mobile, or added with this name)
  z.object({
    action: z.literal("link_no_mobile"),
    name: z.string().trim().min(2, "Name: at least 2 letters").max(100),
    phone: z.string().trim().min(1, "Mobile is needed for a customer").max(30),
    place: z.string().trim().min(2, "Place: at least 2 letters").max(200),
  }),
  // every contact not matched yet with a mobile → the customer with that mobile, else one new customer per mobile
  z.object({ action: z.literal("link_by_mobile") }),
]);

/**
 * "Link by mobile" (owner): the same mobile is the same customer. A contact whose mobile is already a customer's is
 * linked to that customer; otherwise the first contact with that mobile (billed most recently) becomes a new customer
 * (Zoho name, place from the brackets) and every contact with that mobile is linked to it, so all of them come into
 * PlantOps; merging names comes later (owner, 2026-11-07). One audit row per contact, so each can be unlinked alone.
 */
async function linkByMobile(user: OcUser) {
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; name: string; mobile: string; mobile_typed: string | null; last_bill: string | null }>(sql`
      select c.id, c.name, c.mobile, c.mobile_typed, (select max(b.bill_date)::text from order_capture.bills b
              where b.tenant_id = c.tenant_id and b.zoho_contact_id = c.id and b.cancelled_at is null) as last_bill
        from order_capture.zoho_contacts c
       where c.tenant_id = ${user.tenantId} and c.customer_id is null and c.mobile is not null`);
    const cust = await tx.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(eq(customers.tenantId, user.tenantId));
    const byPhone = new Map(cust.map((c) => [c.phone, c]));
    let linked = 0;
    let added = 0;
    for (const c of newestFirst(rows.rows)) {
      let target = byPhone.get(c.mobile);
      let isNew = false;
      if (!target) {
        const phone = normalisePhone(c.mobile);
        if (!phone) continue;
        const made = await insertCustomer(tx, user, { name: customerName(c.name), phoneTyped: c.mobile_typed ?? c.mobile, phone, place: placeFromName(c.name) }, { from_zoho: c.name, by_mobile_bulk: true });
        target = made.customer;
        isNew = made.created;
        byPhone.set(c.mobile, target);
        if (isNew) added++;
      }
      await tx.update(zohoContacts).set({ customerId: target.id, updatedAt: new Date() }).where(and(eq(zohoContacts.tenantId, user.tenantId), eq(zohoContacts.id, c.id)));
      await audit(tx, user, "zoho.match", c.id, { contact: c.name, customer: target.name, phone: target.phone, new_customer: isNew, by_mobile_bulk: true, was: null });
      linked++;
    }
    return { ok: true, linked, new_customers: added };
  });
}

/**
 * "Link all with no mobile" (owner): the Zoho contacts not matched yet and without a mobile all go to one customer,
 * e.g. a walk-in "Retail Customer". That customer is the one with this mobile if there is one (its name and place are
 * kept), else a new customer. One audit row per contact, so each can still be unlinked on its own.
 */
async function linkNoMobile(user: OcUser, input: { name: string; phone: string; place: string }) {
  const phone = normalisePhone(input.phone.replace(/^'+/, ""));
  if (!phone) throw badRequest("Mobile: a 10-digit Indian mobile number");
  return withTenant(user.tenantId, async (tx) => {
    const made = await insertCustomer(tx, user, { name: input.name, phoneTyped: input.phone, phone, place: input.place }, { for_zoho_without_mobile: true });
    const target = made.customer;
    const linked = await tx
      .update(zohoContacts)
      .set({ customerId: target.id, updatedAt: new Date() })
      .where(and(eq(zohoContacts.tenantId, user.tenantId), isNull(zohoContacts.customerId), isNull(zohoContacts.mobile)))
      .returning({ id: zohoContacts.id, name: zohoContacts.name });
    for (const c of linked) await audit(tx, user, "zoho.match", c.id, { contact: c.name, customer: target.name, phone: target.phone, no_mobile_bulk: true, was: null });
    return { ok: true, customer_id: target.id, customer_name: target.name, new_customer: made.created, linked: linked.length };
  });
}

export async function matchAction(user: OcUser, input: z.infer<typeof MatchAction>) {
  requireAccess(user, "zoho_match");
  if (input.action === "link_no_mobile") return linkNoMobile(user, input);
  if (input.action === "link_by_mobile") return linkByMobile(user);
  return withTenant(user.tenantId, async (tx) => {
    const [contact] = await tx.select().from(zohoContacts).where(and(eq(zohoContacts.tenantId, user.tenantId), eq(zohoContacts.id, input.contact_id)));
    if (!contact) throw notFound("Zoho contact not found");
    const setLink = async (customerId: string | null) => {
      await tx.update(zohoContacts).set({ customerId, updatedAt: new Date() }).where(and(eq(zohoContacts.tenantId, user.tenantId), eq(zohoContacts.id, contact.id)));
    };

    if (input.action === "unlink") {
      if (!contact.customerId) return { ok: true };
      await setLink(null);
      await audit(tx, user, "zoho.unmatch", contact.id, { contact: contact.name, customer_id: contact.customerId });
      return { ok: true };
    }
    if (input.action === "link") {
      const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, input.customer_id)));
      if (!c) throw notFound("Customer not found");
      if (contact.customerId === c.id) return { ok: true };
      await setLink(c.id);
      await audit(tx, user, "zoho.match", contact.id, { contact: contact.name, customer: c.name, phone: c.phone, was: contact.customerId });
      return { ok: true };
    }
    // a new customer from this contact, then linked to it
    const phone = normalisePhone(input.phone.replace(/^'+/, ""));
    if (!phone) throw badRequest("Mobile: a 10-digit Indian mobile number");
    const made = await insertCustomer(tx, user, { name: input.name, phoneTyped: input.phone, phone, place: input.place }, { from_zoho: contact.name });
    if (!made.created) throw conflict(`${phone} is already your customer ${made.customer.name}: link to them instead`);
    await setLink(made.customer.id);
    await audit(tx, user, "zoho.match", contact.id, { contact: contact.name, customer: made.customer.name, phone, new_customer: true, was: contact.customerId });
    return { ok: true, customer_id: made.customer.id };
  });
}

// The Calls tab (docs/CALLS_PHASE_PLAN.md "Calls tab", mock-up screen 4) and the owner's "Not an order number" list.
// Rules, checked here on the server through the access table:
//   * owner, Order desk and Delivery staff see the waiting numbers and mark them Attended; PlantOps support only reads
//   * Attended covers every waiting ring of that number up to its newest one; a later ring is waiting again
//   * a new Indian mobile is saved to the customer list with name + place through the list's own rule (insertCustomer);
//     a known customer is never renamed from here; landline / hidden numbers are only marked Attended
//   * a number on the "Not an order number" list is left out everywhere, also its rings from before it was listed;
//     Remove brings them back. The list is the owner's (labels can be private); support reads it
//   * the last delivered order is shown as products and quantities only, never rates or amounts
import { sql } from "drizzle-orm";
import { z } from "zod";
import { fmtDateTime } from "@plantops/module-kit/format";
import { normalisePhone } from "@plantops/module-kit/phone";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { isIgnored, isMobile, lockNumber } from "./calls";
import { insertCustomer, Name, Place } from "./customers";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const IST = "Asia/Kolkata";
export const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
/** "10:02" today, "3 Nov, 10:02" another day. */
const when = (d: Date, today: string) => (istDay(d) === today ? hhmm(d) : fmtDateTime(d.toISOString()));
/** The start of the India day `ymd` as a moment. */
export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

/** Numbers on the "Not an order number" list right now (newest row 'add'), as a SQL subquery. */
export const LISTED = sql`(select x.phone from (select distinct on (c.phone) c.phone, c.action from order_capture.ignored_number_changes c
  order by c.phone, c.created_at desc, c.id desc) x where x.action = 'add')`;
/** A ring of call_events `e`: an incoming, or a missed with no ring_id; missed when it is one or another marks it. */
export const RING = sql`(e.event = 'incoming' or e.ring_id is null)`;
export const MISSED = sql`(e.event = 'missed' or exists (select 1 from order_capture.call_events m where m.tenant_id = e.tenant_id and m.ring_id = e.id))`;
/** The newest Attended of e's number (rings after it are waiting). */
export const LAST_UPTO = sql`coalesce((select max(a.upto) from order_capture.call_attended a where a.tenant_id = e.tenant_id and a.phone = e.phone), '-infinity')`;

export type CardAction = "known" | "new" | "plain";
export interface WaitingCard {
  phone: string;
  /** what the card shows as the number: "98765 43210", landline digits, or "Hidden number" */
  number: string;
  customer: { name: string; place: string } | null;
  rings: { at: string; label: string; missed: boolean }[];
  /** products and quantities of the last delivered order, no rates or amounts */
  last_order: string | null;
  /** known customer: Attended; new mobile: name + place to save; landline / hidden: Attended only */
  action: CardAction;
}
export interface AttendedRow {
  name: string;
  place: string | null;
  rings: number;
  by: string;
  at: string;
  outcome: "known" | "new_customer" | "wrong_number";
}
export interface CallsTab {
  today: { calls: number; numbers: number };
  waiting: WaitingCard[];
  attended: AttendedRow[];
}

export const numberText = (phone: string) => (phone === "hidden" ? "Hidden number" : isMobile(phone) ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone);

async function customersByPhone(tx: OcTx, tenantId: string, phones: string[]) {
  const mobiles = phones.filter(isMobile);
  if (!mobiles.length) return new Map<string, { id: string; name: string; place: string }>();
  const { rows } = await tx.execute<{ id: string; name: string; place: string; phone: string }>(
    sql`select id, name, place, phone from order_capture.customers where tenant_id = ${tenantId} and phone in (${sql.join(mobiles.map((p) => sql`${p}`), sql`, `)})`,
  );
  return new Map(rows.map((r) => [r.phone, r]));
}

/** "2 × Bluemins 20L Jar, 1 × Dispenser · delivered 28 Oct" for the customer's newest delivered order, else null. */
async function lastOrderText(tx: OcTx, tenantId: string, customerId: string) {
  const { rows } = await tx.execute<{ product_name: string; quantity: number; at: Date }>(sql`
    select l.product_name, l.quantity, coalesce(o.delivered_at, o.status_changed_at) as at
      from (select * from order_capture.orders where tenant_id = ${tenantId} and customer_id = ${customerId} and status = 'delivered'
             order by coalesce(delivered_at, status_changed_at) desc, ref_no desc limit 1) o
      join order_capture.order_lines l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.version = o.version
     order by l.line_no`);
  if (!rows.length) return null;
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" }).format(new Date(rows[0]!.at));
  return `${rows.map((r) => `${r.quantity} × ${r.product_name}`).join(", ")} · delivered ${day}`;
}

/** Everything the Calls tab shows. */
export async function callsTab(user: OcUser, now = new Date()): Promise<CallsTab> {
  requireAccess(user, "calls_view");
  const today = istDay(now);
  const from = dayStart(today);
  return withTenant(user.tenantId, async (tx) => {
    const t = user.tenantId;
    const { rows: waitingRings } = await tx.execute<{ id: string; phone: string; created_at: Date; missed: boolean }>(sql`
      select e.id, e.phone, e.created_at, ${MISSED} as missed from order_capture.call_events e
       where e.tenant_id = ${t} and ${RING} and e.created_at > ${LAST_UPTO} and e.phone not in ${LISTED}
       order by e.created_at, e.id`);
    const [counts] = (
      await tx.execute<{ calls: number; numbers: number }>(sql`
        select count(*)::int as calls, count(distinct e.phone)::int as numbers from order_capture.call_events e
         where e.tenant_id = ${t} and ${RING} and e.created_at >= ${from} and e.phone not in ${LISTED}`)
    ).rows;

    const byPhone = new Map<string, typeof waitingRings>();
    for (const r of waitingRings) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r]);
    const phones = [...byPhone.keys()].slice(0, 200); // oldest waiting first (rings are in time order)

    const { rows: attendedRows } = await tx.execute<{ phone: string; customer_id: string | null; outcome: AttendedRow["outcome"]; attended_by_name: string; created_at: Date; rings: number }>(sql`
      select a.phone, a.customer_id, a.outcome, a.attended_by_name, a.created_at,
             (select count(*)::int from order_capture.call_events e
               where e.tenant_id = a.tenant_id and e.phone = a.phone and ${RING} and e.created_at <= a.upto
                 and e.created_at > coalesce((select max(b.upto) from order_capture.call_attended b
                                               where b.tenant_id = a.tenant_id and b.phone = a.phone and b.created_at < a.created_at), '-infinity')) as rings
        from order_capture.call_attended a
       where a.tenant_id = ${t} and a.created_at >= ${from} and a.phone not in ${LISTED}
       order by a.created_at desc, a.id desc`);

    const people = await customersByPhone(tx, t, [...phones, ...attendedRows.map((a) => a.phone)]);
    const waiting: WaitingCard[] = [];
    for (const phone of phones) {
      const c = people.get(phone) ?? null;
      waiting.push({
        phone,
        number: numberText(phone),
        customer: c ? { name: c.name, place: c.place } : null,
        rings: byPhone.get(phone)!.map((r) => ({ at: new Date(r.created_at).toISOString(), label: when(new Date(r.created_at), today), missed: r.missed })),
        last_order: c ? await lastOrderText(tx, t, c.id) : null,
        action: c ? "known" : isMobile(phone) ? "new" : "plain",
      });
    }
    const attended = attendedRows.map((a) => {
      const c = people.get(a.phone);
      return {
        name: c && a.outcome !== "wrong_number" ? c.name : numberText(a.phone),
        place: c && a.outcome !== "wrong_number" ? c.place : a.outcome === "wrong_number" ? "Wrong number" : null,
        rings: a.rings,
        by: a.attended_by_name,
        at: hhmm(new Date(a.created_at)),
        outcome: a.outcome,
      };
    });
    return { today: { calls: counts?.calls ?? 0, numbers: counts?.numbers ?? 0 }, waiting, attended };
  });
}

// ---------- Attended ----------
export const AttendInput = z
  .object({
    phone: z.string().regex(/^([0-9]{1,15}|hidden)$/, "Unknown number"),
    name: Name.optional(),
    place: Place.optional(),
    wrong_number: z.boolean().optional(),
  })
  .strict();

/**
 * Marks a number Attended: all its waiting rings, up to the newest. A second tap when nothing is waiting any more is
 * refused (409 "Already attended by Raju at 10:33"); a ring that came meanwhile is covered by it.
 */
export async function attendCall(user: OcUser, input: z.infer<typeof AttendInput>) {
  requireAccess(user, "calls_attend");
  const { phone } = input;
  const t = user.tenantId;
  return withTenant(t, async (tx) => {
    await lockNumber(tx, t, phone);
    if (await isIgnored(tx, t, phone)) throw conflict("This number is on Not an order number");
    const { rows: rings } = await tx.execute<{ created_at: Date }>(sql`
      select e.created_at from order_capture.call_events e
       where e.tenant_id = ${t} and e.phone = ${phone} and ${RING} and e.created_at > ${LAST_UPTO}
       order by e.created_at desc`);
    if (!rings.length) {
      const [last] = await tx
        .select({ by: schema.callAttended.attendedByName, at: schema.callAttended.createdAt })
        .from(schema.callAttended)
        .where(sql`${schema.callAttended.tenantId} = ${t} and ${schema.callAttended.phone} = ${phone}`)
        .orderBy(sql`${schema.callAttended.createdAt} desc`)
        .limit(1);
      if (last) throw conflict(`Already attended by ${last.by} at ${hhmm(last.at)}`);
      throw notFound("No call from this number");
    }
    const upto = new Date(rings[0]!.created_at);

    let outcome: "known" | "new_customer" | "wrong_number" = "known";
    let customerId: string | null = null;
    if (input.wrong_number) outcome = "wrong_number";
    else if (isMobile(phone)) {
      const known = (await customersByPhone(tx, t, [phone])).get(phone);
      if (known) customerId = known.id; // never renamed from Calls
      else {
        if (!input.name || !input.place) throw badRequest("Please enter the caller's name and place");
        const saved = await insertCustomer(tx, user, { name: input.name, phoneTyped: phone, phone, place: input.place }, { from: "call" });
        customerId = saved.customer.id;
        outcome = saved.created ? "new_customer" : "known"; // added by someone else meanwhile: linked, no second one
      }
    }
    await tx.insert(schema.callAttended).values({ tenantId: t, phone, upto, outcome, customerId, attendedBy: user.userId, attendedByName: user.name });
    const action = outcome === "known" ? "call.attended" : outcome === "new_customer" ? "call.attended_new_customer" : "call.wrong_number";
    await audit(tx, user, action, customerId, { phone, rings: rings.length });
    return { outcome, customer_id: customerId, rings: rings.length };
  });
}

// ---------- Not an order number ----------
export interface IgnoredRow {
  phone: string;
  number: string;
  label: string;
  by: string;
  at: string;
  /** the customer with this number, if any (the page warns) */
  customer: string | null;
}

/** The numbers on the list now, newest first. */
export async function ignoredList(user: OcUser): Promise<IgnoredRow[]> {
  requireAccess(user, "view_ignored");
  return withTenant(user.tenantId, async (tx) => {
    const { rows } = await tx.execute<{ phone: string; label: string; changed_by_name: string; created_at: Date }>(sql`
      select x.phone, x.label, x.changed_by_name, x.created_at from (
        select distinct on (c.phone) c.phone, c.action, c.label, c.changed_by_name, c.created_at from order_capture.ignored_number_changes c
         where c.tenant_id = ${user.tenantId} order by c.phone, c.created_at desc, c.id desc) x
       where x.action = 'add' order by x.created_at desc`);
    const people = await customersByPhone(tx, user.tenantId, rows.map((r) => r.phone));
    return rows.map((r) => ({ phone: r.phone, number: numberText(r.phone), label: r.label, by: r.changed_by_name, at: fmtDateTime(new Date(r.created_at).toISOString()), customer: people.get(r.phone)?.name ?? null }));
  });
}

export const IgnoredInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), phone: z.string().max(40), label: z.string().trim().min(1, "Please write who this is (e.g. Brother)").max(40, "At most 40 characters") }).strict(),
  z.object({ action: z.literal("remove"), phone: z.string().max(40) }).strict(),
]);

/** How a typed number is matched: an Indian mobile in any spelling, else its digits; hidden / empty can't be listed. */
function listNumber(typed: string) {
  const phone = normalisePhone(typed) ?? typed.replace(/\D/g, "");
  if (!phone) throw badRequest("Please enter a phone number");
  if (phone.length > 15) throw badRequest("A phone number has at most 15 digits");
  return phone;
}

/** Owner: add a number to the list (its calls are no longer stored or shown) or remove it. */
export async function setIgnored(user: OcUser, input: z.infer<typeof IgnoredInput>) {
  requireAccess(user, "calls_ignore");
  const phone = listNumber(input.phone);
  return withTenant(user.tenantId, async (tx) => {
    await lockNumber(tx, user.tenantId, phone);
    const listed = await isIgnored(tx, user.tenantId, phone);
    if (input.action === "add" && listed) return { changed: false, phone };
    if (input.action === "remove" && !listed) throw notFound("This number is not on the list");
    const label = input.action === "add" ? input.label : null;
    await tx.insert(schema.ignoredNumberChanges).values({ tenantId: user.tenantId, phone, action: input.action, label, changedBy: user.userId, changedByName: user.name });
    await audit(tx, user, `ignored.${input.action}`, null, { phone, ...(label ? { label } : {}) });
    return { changed: true, phone };
  });
}

/** How many numbers are waiting (the Calls switch on the order list); 0 for anyone who can't see Calls. */
export async function waitingCount(user: OcUser) {
  if (!can(user, "calls_view")) return 0;
  return withTenant(user.tenantId, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(sql`
      select count(distinct e.phone)::int as n from order_capture.call_events e
       where e.tenant_id = ${user.tenantId} and ${RING} and e.created_at > ${LAST_UPTO} and e.phone not in ${LISTED}`);
    return rows[0]?.n ?? 0;
  });
}

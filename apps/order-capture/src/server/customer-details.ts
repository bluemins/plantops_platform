// Customer page Part 2 (docs/CUSTOMER_PAGE_PHASE_PLAN.md; migration 0010): the owner edits every customer field
// (calling name, place, mobile with a reason, GST details, contact, delivery, terms), comments, contact persons, and
// the shop location ("Save my location here" by whoever stands at the shop; a pasted Google Maps link by the owner).
// Rules (D8): the customer's name is the CALLING name everywhere in Sales; the GST details are a separate block used
// only by GST bills and the Zoho file. Every change is audited; comments and locations are never changed or deleted.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { GST_STATES, gstinProblem, gstinState, normaliseGstin } from "@plantops/types";
import { BILL_TERMS, type BillTerms } from "@/lib/ledger";
import { isShortMapLink, MAX_ACCURACY_M, parseMapPosition } from "@/lib/customer-page";
import { NAME_MAX, NAME_MIN, PLACE_MAX, PLACE_MIN } from "@/lib/upload";
import { can, requireAccess } from "./access";
import { audit } from "./audit";
import { schema, withTenant, type OcTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { OcUser } from "./session";

const { customers, customerComments, customerPersons, customerLocations } = schema;
type CustomerRow = typeof customers.$inferSelect;

/** Input checks give plain 400 messages (a route that passes raw JSON would otherwise answer 500). */
function check<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
}

/** "" or spaces = clear the field (null); undefined = leave it as it is. */
const opt = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .refine((s) => s === "" || s.length >= min, `At least ${min} characters`)
    .transform((s) => (s === "" ? null : s))
    .optional();

export const CustomerDetailsInput = z.object({
  name: z.string().trim().min(NAME_MIN, `Name: at least ${NAME_MIN} characters`).max(NAME_MAX).optional(),
  place: z.string().trim().min(PLACE_MIN, `Place: at least ${PLACE_MIN} characters`).max(PLACE_MAX).optional(),
  phone: z.string().trim().max(30).optional(),
  /** required when the mobile changes */
  phone_reason: z.string().trim().max(200).optional(),
  // GST details
  legal_name: opt(200, 2),
  gst_treatment: z.enum(schema.GST_TREATMENTS).nullable().optional(),
  gstin: opt(30),
  state_code: z.string().trim().regex(/^(\d{2})?$/, "GST state: pick one from the list").transform((s) => (s === "" ? null : s)).optional(),
  billing_address: opt(300, 2),
  billing_city: opt(80, 2),
  billing_pin: z.string().trim().regex(/^([1-9]\d{5})?$/, "PIN code: 6 digits").transform((s) => (s === "" ? null : s)).optional(),
  // contact
  email: z
    .string()
    .trim()
    .max(120)
    .refine((s) => s === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "Email: not a valid address")
    .transform((s) => (s === "" ? null : s.toLowerCase()))
    .optional(),
  other_phone: z
    .string()
    .trim()
    .max(30)
    .transform((s) => s.replace(/[\s\-.()+]/g, ""))
    .refine((s) => s === "" || /^\d{6,15}$/.test(s), "Other phone: 6 to 15 digits")
    .transform((s) => (s === "" ? null : s))
    .optional(),
  customer_type: z.enum(schema.CUSTOMER_TYPES).nullable().optional(),
  // delivery and terms
  delivery_address: opt(300, 2),
  delivery_landmark: opt(150, 2),
  payment_terms: z.enum(BILL_TERMS as [BillTerms, ...BillTerms[]]).nullable().optional(),
});
export type CustomerDetailsInput = z.input<typeof CustomerDetailsInput>;

/** column ↔ input field, in the order the Edit form shows them (also the words in the timeline / Recent changes) */
const FIELDS = [
  ["name", "name", "calling name"],
  ["place", "place", "place"],
  ["legalName", "legal_name", "legal name"],
  ["gstTreatment", "gst_treatment", "GST treatment"],
  ["gstin", "gstin", "GSTIN"],
  ["stateCode", "state_code", "GST state"],
  ["billingAddress", "billing_address", "billing address"],
  ["billingCity", "billing_city", "billing city"],
  ["billingPin", "billing_pin", "PIN code"],
  ["email", "email", "email"],
  ["otherPhone", "other_phone", "other phone"],
  ["customerType", "customer_type", "customer type"],
  ["deliveryAddress", "delivery_address", "delivery address"],
  ["deliveryLandmark", "delivery_landmark", "landmark"],
  ["paymentTerms", "payment_terms", "payment terms"],
] as const satisfies readonly (readonly [keyof CustomerRow, keyof z.infer<typeof CustomerDetailsInput>, string])[];
export const FIELD_WORDS: Record<string, string> = Object.fromEntries([...FIELDS.map(([, k, w]) => [k, w]), ["phone", "mobile"], ["active", "on / off"]]);

/**
 * The owner's Edit: every field at once (fields not sent stay as they are). GSTIN is checked (shape + check
 * character); it sets the GST state and "registered" when those are empty. A new mobile needs a reason and must not
 * belong to another customer. Nothing changed = nothing written.
 */
export async function updateCustomerDetails(user: OcUser, id: string, raw: CustomerDetailsInput) {
  requireAccess(user, "customer_edit");
  const input = check(CustomerDetailsInput, raw);
  let gstin = input.gstin;
  if (gstin) {
    gstin = normaliseGstin(gstin);
    const problem = gstinProblem(gstin);
    if (problem) throw badRequest(`Customer ${problem}`);
  }
  if (input.state_code && !GST_STATES[input.state_code]) throw badRequest("GST state: pick one from the list.");
  return withTenant(user.tenantId, async (tx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id))).for("update");
    if (!c) throw notFound("Customer not found");
    const next: Partial<CustomerRow> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const values = { ...input, ...(gstin !== undefined ? { gstin } : {}) } as Record<string, unknown>;
    if (gstin) {
      // a GSTIN tells the state and that the customer is a registered business, unless the owner chose otherwise now
      if (values.state_code === undefined && !c.stateCode) values.state_code = gstinState(gstin);
      if (values.gst_treatment === undefined && !c.gstTreatment) values.gst_treatment = "registered";
    }
    for (const [col, key] of FIELDS) {
      const v = values[key];
      if (v === undefined || v === c[col]) continue;
      (next as Record<string, unknown>)[col] = v;
      changes[key] = { from: c[col], to: v };
    }
    let reason: string | null = null;
    if (input.phone !== undefined) {
      const phone = normalisePhone(input.phone);
      if (!phone) throw badRequest("Mobile: a 10-digit Indian mobile number");
      if (phone !== c.phone) {
        reason = input.phone_reason?.trim() ?? "";
        if (reason.length < 3) throw badRequest("Changing the mobile needs a reason (e.g. new number).");
        const [other] = await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.phone, phone)));
        if (other) throw conflict(`${other.name} already has this number. A number belongs to one customer.`);
        next.phone = phone;
        next.phoneTyped = input.phone;
        changes.phone = { from: c.phone, to: phone };
      }
    }
    if (!Object.keys(changes).length) return { changed: [] as string[] };
    await tx.update(customers).set({ ...next, updatedAt: new Date() }).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, id)));
    await audit(tx, user, "customer.details", id, { name: next.name ?? c.name, phone: next.phone ?? c.phone, changes, ...(reason ? { reason } : {}) });
    return { changed: Object.keys(changes) };
  });
}

// ---------- comments ----------

export const CommentInput = z.object({ body: z.string().trim().min(1, "Type the comment").max(500, "At most 500 characters") });

export async function addComment(user: OcUser, customerId: string, raw: z.input<typeof CommentInput>) {
  requireAccess(user, "customer_comment");
  const { body } = check(CommentInput, raw);
  return withTenant(user.tenantId, async (tx) => {
    await mustExist(tx, user.tenantId, customerId);
    const [r] = await tx.insert(customerComments).values({ tenantId: user.tenantId, customerId, body, byUser: user.userId, byName: user.name }).returning();
    return { id: r!.id };
  });
}

// ---------- contact persons ----------

export const PersonInput = z.object({
  name: z.string().trim().min(2, "Name: at least 2 characters").max(100),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((s) => s.replace(/[\s\-.()+]/g, ""))
    .refine((s) => s === "" || /^\d{6,15}$/.test(s), "Phone: 6 to 15 digits")
    .transform((s) => (s === "" ? null : s))
    .optional(),
  role: opt(60, 2),
});

export async function addPerson(user: OcUser, customerId: string, raw: z.input<typeof PersonInput>) {
  requireAccess(user, "customer_edit");
  const p = check(PersonInput, raw);
  return withTenant(user.tenantId, async (tx) => {
    await mustExist(tx, user.tenantId, customerId);
    const [r] = await tx
      .insert(customerPersons)
      .values({ tenantId: user.tenantId, customerId, name: p.name, phone: p.phone ?? null, role: p.role ?? null, byUser: user.userId, byName: user.name })
      .returning();
    await audit(tx, user, "customer.person", customerId, { person: p.name, phone: p.phone ?? null, role: p.role ?? null });
    return { id: r!.id };
  });
}

export async function setPersonActive(user: OcUser, customerId: string, personId: string, active: boolean) {
  requireAccess(user, "customer_edit");
  return withTenant(user.tenantId, async (tx) => {
    const [p] = await tx
      .update(customerPersons)
      .set({ active })
      .where(and(eq(customerPersons.tenantId, user.tenantId), eq(customerPersons.customerId, customerId), eq(customerPersons.id, personId)))
      .returning();
    if (!p) throw notFound("Contact person not found");
    await audit(tx, user, "customer.person", customerId, { person: p.name, active });
    return { active };
  });
}

// ---------- shop location ----------

export const LocationInput = z.discriminatedUnion("source", [
  z.object({ source: z.literal("phone"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy_m: z.number().min(0).max(100_000) }),
  z.object({ source: z.literal("map_link"), link: z.string().trim().min(3).max(2000) }),
]);

/** Opens a maps.app.goo.gl / goo.gl short link (Google only, 3 s, no body read) and returns where it points. */
async function expandShortLink(link: string) {
  try {
    const r = await fetch(link.trim(), { redirect: "manual", signal: AbortSignal.timeout(3000) });
    return r.headers.get("location") ?? "";
  } catch {
    return "";
  }
}

export async function saveLocation(user: OcUser, customerId: string, raw: z.input<typeof LocationInput>, expand = expandShortLink) {
  requireAccess(user, "location_save");
  const input = check(LocationInput, raw);
  let pos: { lat: number; lng: number };
  let accuracy: number | null = null;
  if (input.source === "phone") {
    accuracy = Math.round(input.accuracy_m);
    if (accuracy > MAX_ACCURACY_M) throw badRequest(`Location too rough (±${accuracy} m). Step outside, wait a few seconds and try again (needs ±${MAX_ACCURACY_M} m or better).`);
    pos = { lat: Math.round(input.lat * 1e6) / 1e6, lng: Math.round(input.lng * 1e6) / 1e6 };
  } else {
    requireAccess(user, "customer_edit"); // a pasted link: the owner (who may not be at the shop)
    let found = parseMapPosition(input.link);
    if (!found && isShortMapLink(input.link)) found = parseMapPosition(await expand(input.link));
    if (!found) throw badRequest("No position found in that link. In Google Maps, press and hold the shop's spot, then copy the numbers shown (e.g. 21.0234, 83.7841).");
    pos = found;
  }
  return withTenant(user.tenantId, async (tx) => {
    const c = await mustExist(tx, user.tenantId, customerId);
    await tx.insert(customerLocations).values({
      tenantId: user.tenantId,
      customerId,
      kind: "set",
      lat: String(pos.lat),
      lng: String(pos.lng),
      accuracyM: accuracy,
      source: input.source,
      byUser: user.userId,
      byName: user.name,
    });
    await audit(tx, user, "customer.location", customerId, { name: c.name, kind: "set", source: input.source, accuracy_m: accuracy });
    return { ...pos, accuracy_m: accuracy };
  });
}

export const ClearLocationInput = z.object({ reason: z.string().trim().min(3, "Say why (e.g. wrong shop)").max(200) });

export async function clearLocation(user: OcUser, customerId: string, raw: z.input<typeof ClearLocationInput>) {
  requireAccess(user, "location_clear");
  const { reason } = check(ClearLocationInput, raw);
  return withTenant(user.tenantId, async (tx) => {
    const c = await mustExist(tx, user.tenantId, customerId);
    const now = await latestLocation(tx, user.tenantId, customerId);
    if (!now) throw conflict("This customer has no shop location to clear.");
    await tx.insert(customerLocations).values({ tenantId: user.tenantId, customerId, kind: "clear", reason, byUser: user.userId, byName: user.name });
    await audit(tx, user, "customer.location", customerId, { name: c.name, kind: "clear", reason });
    return { cleared: true };
  });
}

export interface LocationView {
  lat: string;
  lng: string;
  accuracy_m: number | null;
  source: "phone" | "map_link" | "field_visit";
  by: string;
  at: string;
}

/** The customer's shop location now: the newest row, unless it is a clear. */
export async function latestLocation(tx: OcTx, tenantId: string, customerId: string): Promise<LocationView | null> {
  const [r] = await tx
    .select()
    .from(customerLocations)
    .where(and(eq(customerLocations.tenantId, tenantId), eq(customerLocations.customerId, customerId)))
    .orderBy(desc(customerLocations.createdAt))
    .limit(1);
  if (!r || r.kind === "clear") return null;
  return { lat: r.lat!, lng: r.lng!, accuracy_m: r.accuracyM, source: r.source!, by: r.byName, at: r.createdAt.toISOString() };
}

async function mustExist(tx: OcTx, tenantId: string, id: string) {
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));
  if (!c) throw notFound("Customer not found");
  return c;
}

// ---------- the customer page's extra parts (read with the account) ----------

export async function customerExtras(tx: OcTx, tenantId: string, customerId: string) {
  // one after another: a transaction's queries share one connection
  const comments = await tx.select().from(customerComments).where(and(eq(customerComments.tenantId, tenantId), eq(customerComments.customerId, customerId))).orderBy(desc(customerComments.createdAt));
  const persons = await tx.select().from(customerPersons).where(and(eq(customerPersons.tenantId, tenantId), eq(customerPersons.customerId, customerId))).orderBy(customerPersons.createdAt);
  const location = await latestLocation(tx, tenantId, customerId);
  return {
    comments: comments.map((c) => ({ id: c.id, body: c.body, by: c.byName, at: c.createdAt.toISOString() })),
    persons: persons.map((p) => ({ id: p.id, name: p.name, phone: p.phone, role: p.role, active: p.active })),
    location,
  };
}

// ---------- Shop locations (Order desk, Accounts, Delivery staff: no amounts) ----------

/** Search customers by name, place or phone digits for the Shop locations screen. */
export async function shopSearch(user: OcUser, q: string, limit = 30) {
  requireAccess(user, "location_view");
  const term = q.trim().slice(0, 100);
  const digits = term.replace(/\D/g, "");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; name: string; place: string; phone: string; has_location: boolean }>(sql`
      select c.id, c.name, c.place, c.phone,
             coalesce((select l.kind = 'set' from order_capture.customer_locations l
                        where l.tenant_id = c.tenant_id and l.customer_id = c.id order by l.created_at desc limit 1), false) as has_location
        from order_capture.customers c
       where c.tenant_id = ${user.tenantId} and c.active
         and (${term} = '' or c.name ilike ${"%" + term + "%"} or c.place ilike ${"%" + term + "%"}
              or (${digits} <> '' and length(${digits}) >= 4 and c.phone like ${"%" + digits + "%"}))
       order by lower(c.name)
       limit ${limit}`);
    return rows.rows;
  });
}

/** One customer for the Shop locations screen: name, place, phone, delivery details and the location; never money. */
export async function shopView(user: OcUser, customerId: string) {
  requireAccess(user, "location_view");
  return withTenant(user.tenantId, async (tx) => {
    const c = await mustExist(tx, user.tenantId, customerId);
    return {
      id: c.id,
      name: c.name,
      place: c.place,
      phone: c.phone,
      delivery_address: c.deliveryAddress,
      delivery_landmark: c.deliveryLandmark,
      location: await latestLocation(tx, user.tenantId, customerId),
      can_save: can(user, "location_save"),
      can_clear: can(user, "location_clear"),
      can_paste: can(user, "customer_edit"),
    };
  });
}

// What other PlantOps modules may ask Sales, server to server (docs/FIELD_DAY_PHASE_PLAN.md Phase 1). Each call carries a
// 60-second ticket the platform signed for one plant and one scope (verifyLookupRequest); there is no user session.
//   * customers: Attendance's field day searches the customer list. Name, place and whether the shop has a location
//     only: never a phone number (also for a phone search), never orders or amounts.
//   * customer_location: a field staff's visit saves the shop's location. Once per visit (unique visit_id), so a retry
//     never saves twice. Same ±150 m limit as "Save my location here".
import { and, asc, eq, ilike, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { verifyLookupRequest } from "@plantops/auth";
import { normalisePhone } from "@plantops/module-kit/phone";
import type { LookupScope, LookupTicketPayload } from "@plantops/types";
import { MAX_ACCURACY_M } from "@/lib/customer-page";
import { audit } from "./audit";
import { latestLocations } from "./customer-details";
import { schema, withTenant } from "./db";
import { badRequest, HttpError, notFound } from "./http";
import { kit } from "./kit";
import type { OcUser } from "./session";

const { customers, customerLocations } = schema;
export const LOOKUP_SEARCH_LIMIT = 20;

/** The ticket on this request, for this scope; 401 otherwise. */
export async function lookupTicket(req: Request, scope: LookupScope): Promise<LookupTicketPayload> {
  const t = await verifyLookupRequest(req.headers.get("authorization"), { audience: kit.moduleId, keys: kit.keys(), scope }).catch(() => null);
  if (!t) throw new HttpError(401, "Not a valid PlantOps lookup ticket");
  return t;
}

export interface LookupCustomer {
  id: string;
  name: string;
  place: string;
  /** the shop's location now (who saved it, when, how); null = none yet. Never the position itself. */
  location: { at: string; by: string; source: "phone" | "map_link" | "field_visit" } | null;
}

/**
 * Switched-on customers matching `q` by name or place, or by phone when q has 6 or more digits (any spelling: "+91 98…",
 * spaces). Up to 20, A–Z. No phone number in the answer.
 */
export async function lookupCustomers(tenantId: string, rawQ: string): Promise<{ customers: LookupCustomer[] }> {
  const q = rawQ.trim();
  if (q.length < 2 || q.length > 60) throw badRequest("Type 2 to 60 characters");
  const digits = normalisePhone(q) ?? q.replace(/\D/g, "");
  const text = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: customers.id, name: customers.name, place: customers.place })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          eq(customers.active, true),
          or(ilike(customers.name, text), ilike(customers.place, text), ...(digits.length >= 6 ? [like(customers.phone, `%${digits}%`)] : []))!,
        ),
      )
      .orderBy(asc(sql`lower(${customers.name})`), asc(customers.place))
      .limit(LOOKUP_SEARCH_LIMIT);
    const latest = await latestLocations(tx, tenantId, rows.map((r) => r.id));
    return {
      customers: rows.map((r) => {
        const l = latest.get(r.id);
        return { ...r, location: l ? { at: l.at, by: l.by, source: l.source } : null };
      }),
    };
  });
}

export const FieldLocationInput = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0),
    visit_id: z.uuid(),
    set_by_user_id: z.uuid(),
    set_by_name: z.string().trim().min(1).max(80),
  })
  .strict();

/**
 * A field visit saves the shop's location: an active customer of the ticket's plant, ±150 m or better. The same visit
 * again saves nothing more and still answers OK (`already: true`). Recent changes: "Shop location saved (field visit, ±8 m)".
 */
export async function saveFieldLocation(tenantId: string, customerId: string, input: z.infer<typeof FieldLocationInput>) {
  const accuracy = Math.round(input.accuracy_m);
  if (accuracy > MAX_ACCURACY_M) throw badRequest(`Location too rough (±${accuracy} m) to save for the shop (needs ±${MAX_ACCURACY_M} m or better)`);
  const lat = Math.round(input.lat * 1e6) / 1e6;
  const lng = Math.round(input.lng * 1e6) / 1e6;
  return withTenant(tenantId, async (tx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!c || !c.active) throw notFound("Customer not found");
    const [row] = await tx
      .insert(customerLocations)
      .values({ tenantId, customerId, kind: "set", lat: String(lat), lng: String(lng), accuracyM: accuracy, source: "field_visit", visitId: input.visit_id, byUser: input.set_by_user_id, byName: input.set_by_name })
      .onConflictDoNothing({ target: [customerLocations.tenantId, customerLocations.visitId], where: sql`visit_id is not null` })
      .returning({ id: customerLocations.id });
    if (!row) return { saved: true, already: true };
    // the field staff did it, in Attendance: their own user id and name (they hold no Sales role)
    const actor: OcUser = { tenantId, userId: input.set_by_user_id, name: input.set_by_name, roles: [], who: null, isOwner: false, isSupport: false };
    await audit(tx, actor, "customer.location", customerId, { name: c.name, kind: "set", source: "field_visit", accuracy_m: accuracy, visit_id: input.visit_id });
    return { saved: true, already: false };
  });
}

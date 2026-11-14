// Module-to-module lookups (docs/FIELD_DAY_PHASE_PLAN.md "the lookup ticket"). A module that needs something from another
// module for one plant (Attendance's field day: Sales' customer list) asks the platform first. The platform checks the
// pair is in LOOKUPS, the plant is active and both modules are switched on for it, then signs a 60-second ticket for
// the target module and one scope. Nothing is stored. The ticket carries `purpose`, so it is never accepted as a login.
import { eq } from "drizzle-orm";
import { LOOKUP_TOKEN_SECONDS, lookupAllowed, type LookupTicketAnswer, type LookupTicketRequest } from "@plantops/types";
import type { z } from "zod";
import { appDb, schema, withTenant } from "./db";
import { forbidden, HttpError } from "./http";
import { authenticateModule, enabledModules, signPlatformToken } from "./sso";

export async function issueLookupTicket(req: Request, tenantId: string, body: z.infer<typeof LookupTicketRequest>): Promise<LookupTicketAnswer> {
  const from = await authenticateModule(req);
  if (!lookupAllowed(from, body.to, body.scope)) throw forbidden("This module may not ask that");
  const ok = await withTenant(tenantId, async (tx) => {
    const [t] = await tx.select({ status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (t?.status !== "active") return false;
    const enabled = await enabledModules(tx, tenantId);
    return enabled.includes(from) && enabled.includes(body.to);
  });
  if (!ok) throw forbidden("Both modules must be switched on for this plant");
  const [target] = await appDb().select().from(schema.modules).where(eq(schema.modules.id, body.to));
  if (!target || target.status !== "active" || !target.baseUrl) throw new HttpError(503, "That module is not available right now");
  const ticket = await signPlatformToken({ purpose: "lookup", tenant_id: tenantId, from, scope: body.scope }, body.to, LOOKUP_TOKEN_SECONDS);
  return { ticket, url: target.baseUrl };
}

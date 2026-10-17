import { eq } from "drizzle-orm";
import { resolveTenant } from "./auth";
import { schema, withTenant } from "./db";
import { HttpError } from "./http";
import { authenticateModule, enabledModules } from "./sso";

/**
 * The only module that may look a plant up by its code: Job applications' public page knows the plant only from the
 * address (jobs.bluemins.life/<code>). docs/JOB_APPLICATIONS_PHASE_PLAN.md "Which plant a public page belongs to".
 */
const LOOKUP_MODULE = "job_applications";
const CODE = /^[A-Za-z0-9_-]{3,32}$/;

/** One answer for every refusal, so nobody can find out which plant codes exist or which plants use the module. */
const unavailable = () => new HttpError(404, "This page is not available");

/** Plant code -> { tenant_id, name }, only for an active plant with Job applications switched on. Nothing else. */
export async function plantByCode(req: Request, code: string): Promise<{ tenant_id: string; name: string }> {
  const caller = await authenticateModule(req).catch(() => null);
  if (caller !== LOOKUP_MODULE || !CODE.test(code)) throw unavailable();
  const tenantId = await resolveTenant(code); // active plants only, code upper-cased
  if (!tenantId) throw unavailable();
  const plant = await withTenant(tenantId, async (tx) => {
    if (!(await enabledModules(tx, tenantId)).includes(LOOKUP_MODULE)) return null;
    const [t] = await tx.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    return t ?? null;
  });
  if (!plant) throw unavailable();
  return { tenant_id: tenantId, name: plant.name };
}

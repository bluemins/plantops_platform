// How Lab Records talks to the platform (credentials, keys, cached branding/products/plan) - from the module kit.
import { productLabel } from "@plantops/module-kit";
import { kit } from "./kit";

export const MODULE_ID = kit.moduleId as "lab_records";
export const MODULE_LABEL = kit.label;
export const { creds, keys, accountUrl, platformLoginUrl, branding, products } = kit;
export { productLabel };

/**
 * The plan's Lab Records history window in months (super_admin sets it; blank = unlimited). Older records are
 * never deleted - only hidden from screens, search and prints until an upgrade. Platform unreachable: no limit.
 */
export async function historyMonths(tenantId: string): Promise<number | null> {
  const plan = await kit.plan(tenantId);
  return plan?.limits.modules.lab_records?.history_months ?? null;
}

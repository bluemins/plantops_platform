import type { PlatformTx } from "./db";
import { schema } from "./db";

export type Actor = `super_admin:${string}` | `user:${string}` | `module:${string}` | "system";

/** Appends one row to the audit log. The table is append-only at the database level. */
export async function audit(
  tx: PlatformTx,
  entry: { tenantId: string | null; actor: Actor; action: string; target?: string; details?: Record<string, unknown> },
) {
  await tx.insert(schema.auditLog).values({
    tenantId: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    details: entry.details ?? {},
  });
}

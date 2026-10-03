import { schema, type LabTx } from "./db";

/** Appends one row to Lab Records' audit log (append-only at the database level). */
export async function audit(
  tx: LabTx,
  entry: { tenantId: string; actor: string; action: string; target?: string; details?: Record<string, unknown> },
) {
  await tx.insert(schema.auditLog).values({
    tenantId: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    details: entry.details ?? {},
  });
}

/** Drizzle wraps Postgres errors; the code may sit on the error or its cause. */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

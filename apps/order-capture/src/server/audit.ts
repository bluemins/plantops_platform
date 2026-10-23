// The audit log behind "Recent changes": rates, customers, uploads (and CSV exports from Phase 5). Append-only:
// order_app can insert and read, never change or delete (database permissions).
import { and, desc, eq, notLike } from "drizzle-orm";
import { describeChange } from "@/lib/changes";
import { requireAccess } from "./access";
import { schema, withTenant, type OcTx } from "./db";
import { actorOf, type OcUser } from "./session";

const { auditLog } = schema;

export async function audit(tx: OcTx, user: OcUser, action: string, target: string | null, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details: { by: user.name, ...details } });
}

export interface ChangeView {
  at: string;
  by: string;
  text: string;
}

/** Owner (and PlantOps support): every change, newest first, in plain words. The WhatsApp bot's reads and alerts stay out. */
export async function recentChanges(user: OcUser, limit = 200): Promise<ChangeView[]> {
  requireAccess(user, "view_changes");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(auditLog).where(and(eq(auditLog.tenantId, user.tenantId), notLike(auditLog.action, "bot.%"))).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit);
    return rows.map((r) => ({ at: r.at.toISOString(), by: String(r.details.by ?? "Someone"), text: describeChange(r.action, r.details) }));
  });
}

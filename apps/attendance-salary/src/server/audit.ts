// The audit log behind "Recent changes" (Phase 5): settings, new QR, fixes, CSV exports. Append-only:
// attendance_app can insert and read, never change or delete (database permissions). Never holds a QR key.
import { desc, eq } from "drizzle-orm";
import { describeChange } from "@/lib/changes";
import { requireAccess } from "./access";
import { schema, withTenant, type AtTx } from "./db";
import { actorOf, type AtUser } from "./session";

/** Who did it, as Recent changes shows it: "Ramesh (office)" for Office staff, else the name. */
export const byLabel = (user: AtUser) => (!user.isOwner && user.who.includes("office") ? `${user.name} (office)` : user.name);

export async function audit(tx: AtTx, user: AtUser, action: string, target: string | null, details: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, target, details: { by: byLabel(user), ...details } });
}

export interface ChangeView {
  at: string;
  by: string;
  text: string;
}

/** Owner (and PlantOps support): every change, newest first, in plain words. */
export async function recentChanges(user: AtUser, limit = 200): Promise<ChangeView[]> {
  requireAccess(user, "view_changes");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, user.tenantId)).orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id)).limit(limit);
    return rows.map((r) => ({ at: r.at.toISOString(), by: String(r.details.by ?? "Someone"), text: describeChange(r.action, r.details) }));
  });
}

// What the plant owner sees about PlantOps support looking at their data (CLAUDE.md "Support token").
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "./db";
import { forbidden } from "./http";
import type { LabUser } from "./session";

export type SupportViewRow = { path: string; at: string };

/** The latest support views, newest first (owner only). */
export async function listSupportViews(user: LabUser, limit = 200): Promise<SupportViewRow[]> {
  if (!user.isOwner) throw forbidden("Only the plant owner can see this");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.supportViews)
      .where(eq(schema.supportViews.tenantId, user.tenantId))
      .orderBy(desc(schema.supportViews.at))
      .limit(limit);
    return rows.map((r) => ({ path: r.path, at: r.at.toISOString() }));
  });
}

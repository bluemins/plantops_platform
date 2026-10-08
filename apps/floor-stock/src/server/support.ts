// What the plant owner sees about PlantOps support looking at their stock (CLAUDE.md "Support token").
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "./db";
import { requireOwner, type StockUser } from "./session";

export async function listSupportViews(user: StockUser, limit = 200) {
  requireOwner(user);
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.supportViews).where(eq(schema.supportViews.tenantId, user.tenantId)).orderBy(desc(schema.supportViews.at)).limit(limit);
    return rows.map((r) => ({ path: r.path, at: r.at.toISOString() }));
  });
}

// What the plant owner sees about PlantOps support looking at their attendance (CLAUDE.md "Support token").
import { desc, eq } from "drizzle-orm";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import type { AtUser } from "./session";

/** Each support view in words, newest first: "the Today board", "the settings", ... */
export async function listSupportViews(user: AtUser, limit = 200) {
  requireAccess(user, "support_log");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.supportViews).where(eq(schema.supportViews.tenantId, user.tenantId)).orderBy(desc(schema.supportViews.at), desc(schema.supportViews.id)).limit(limit);
    return rows.map((r) => ({ what: describeView(r.path), at: r.at.toISOString() }));
  });
}

export function describeView(path: string) {
  if (path === "/staff") return "the staff list";
  if (path.startsWith("/staff/")) return "a person's attendance and salary";
  if (path.startsWith("/salary")) return "the Salary tab";
  if (path.startsWith("/settings")) return "the settings";
  if (path.startsWith("/changes")) return "Recent changes";
  return "the Today board";
}

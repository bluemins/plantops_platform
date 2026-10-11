// What the plant owner sees about PlantOps support looking at their complaints (CLAUDE.md "Support token").
import { and, desc, eq, inArray } from "drizzle-orm";
import { formatRef } from "@/lib/phone";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import type { CbUser } from "./session";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Each support view in words, newest first: "the complaint list", "complaint C-0042", "a photo or video", ... */
export async function listSupportViews(user: CbUser, limit = 200) {
  requireAccess(user, "support_log");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.supportViews).where(eq(schema.supportViews.tenantId, user.tenantId)).orderBy(desc(schema.supportViews.at), desc(schema.supportViews.id)).limit(limit);
    const ids = [...new Set(rows.filter((r) => r.path.startsWith("/c/")).map((r) => UUID.exec(r.path)?.[0]).filter((x): x is string => Boolean(x)))];
    const refs = new Map(
      ids.length
        ? (await tx.select({ id: schema.complaints.id, refNo: schema.complaints.refNo }).from(schema.complaints).where(and(eq(schema.complaints.tenantId, user.tenantId), inArray(schema.complaints.id, ids)))).map((c) => [c.id, formatRef(c.refNo)])
        : [],
    );
    return rows.map((r) => ({ what: describeView(r.path, refs), at: r.at.toISOString() }));
  });
}

export function describeView(path: string, refs: Map<string, string> = new Map()) {
  if (path.startsWith("/c/")) return `complaint ${refs.get(UUID.exec(path)?.[0] ?? "") ?? ""}`.trim();
  if (path.startsWith("/files/")) return "a photo or video";
  if (path.startsWith("/items")) return "the item list";
  if (path.startsWith("/changes")) return "Recent changes";
  return "the complaint list";
}

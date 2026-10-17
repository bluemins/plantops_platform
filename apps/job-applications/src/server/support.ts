// What the plant owner sees about PlantOps support looking at their job applications (CLAUDE.md "Support token").
import { and, desc, eq, inArray } from "drizzle-orm";
import { formatRef } from "@/lib/apply";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import type { JaUser } from "./session";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Each support view in words, newest first: "the applications list", "application J-0042", "a resume page", ... */
export async function listSupportViews(user: JaUser, limit = 200) {
  requireAccess(user, "support_log");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.supportViews).where(eq(schema.supportViews.tenantId, user.tenantId)).orderBy(desc(schema.supportViews.at), desc(schema.supportViews.id)).limit(limit);
    const ids = [...new Set(rows.filter((r) => r.path.startsWith("/applications/")).map((r) => UUID.exec(r.path)?.[0]).filter((x): x is string => Boolean(x)))];
    const refs = new Map(
      ids.length
        ? (await tx.select({ id: schema.applications.id, refNo: schema.applications.refNo }).from(schema.applications).where(and(eq(schema.applications.tenantId, user.tenantId), inArray(schema.applications.id, ids)))).map((a) => [a.id, formatRef(a.refNo)])
        : [],
    );
    return rows.map((r) => ({ what: describeView(r.path, refs), at: r.at.toISOString() }));
  });
}

export function describeView(path: string, refs: Map<string, string> = new Map()) {
  if (path.startsWith("/applications/")) {
    const ref = refs.get(UUID.exec(path)?.[0] ?? "");
    return ref ? `application ${ref}` : "an application (since removed)";
  }
  if (path.startsWith("/files/")) return "a resume page";
  if (path.startsWith("/openings")) return "the openings";
  if (path.startsWith("/changes")) return "Recent changes";
  return "the applications list";
}

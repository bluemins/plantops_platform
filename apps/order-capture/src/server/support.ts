// What the plant owner sees about PlantOps support looking at their orders (CLAUDE.md "Support token").
import { and, desc, eq, inArray } from "drizzle-orm";
import { formatRef } from "@/lib/ref";
import { requireAccess } from "./access";
import { schema, withTenant } from "./db";
import type { OcUser } from "./session";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Each support view in words, newest first: "the order list", "order O-0042", "the rates", ... */
export async function listSupportViews(user: OcUser, limit = 200) {
  requireAccess(user, "support_log");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.supportViews).where(eq(schema.supportViews.tenantId, user.tenantId)).orderBy(desc(schema.supportViews.at), desc(schema.supportViews.id)).limit(limit);
    const ids = [...new Set(rows.filter((r) => r.path.startsWith("/o/")).map((r) => UUID.exec(r.path)?.[0]).filter((x): x is string => Boolean(x)))];
    const refs = new Map(
      ids.length
        ? (await tx.select({ id: schema.orders.id, refNo: schema.orders.refNo }).from(schema.orders).where(and(eq(schema.orders.tenantId, user.tenantId), inArray(schema.orders.id, ids)))).map((o) => [o.id, formatRef(o.refNo)])
        : [],
    );
    return rows.map((r) => ({ what: describeView(r.path, refs), at: r.at.toISOString() }));
  });
}

export function describeView(path: string, refs: Map<string, string> = new Map()) {
  if (path.startsWith("/o/")) return `order ${refs.get(UUID.exec(path)?.[0] ?? "") ?? ""}`.trim();
  if (path.startsWith("/rates")) return "the rates";
  if (path.startsWith("/customers")) return "the customer list";
  if (path.startsWith("/changes")) return "Recent changes";
  return "the order list";
}

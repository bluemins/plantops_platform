// Who is using Order Capture right now (from the module kit's session cookies). What they may do is in access.ts.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import { pageViewIn, viewOnlyIn, type RoleId } from "@plantops/types";
import type { Who } from "./access";
import { schema, withTenant } from "./db";
import { HttpError } from "./http";
import { kit } from "./kit";

export interface OcUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** the row of the access table this person uses; null = no Order Capture rights */
  who: Who | null;
  /** other capacities held: Order desk + Accounts → ["accounts"]; + Marketing staff → ["marketing"]; Marketing staff +
   * Delivery staff → ["delivery"] */
  also?: Who[];
  isOwner: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

/**
 * Owner wins over a staff role; desk = Order desk; delivery = Delivery staff without Order desk (Calls only); viewer =
 * plant staff / Order viewer without either (read-only, no amounts). Marketing staff come before Delivery staff and the
 * viewers: customers, never orders (an Order viewer who is also Marketing staff sees no orders).
 */
export function whoFor(roles: RoleId[]): Who | null {
  if (roles.includes("tenant_admin")) return "owner";
  if (roles.includes("order_desk")) return "desk";
  if (roles.includes("accounts")) return "accounts";
  if (roles.includes("marketing_staff")) return "marketing";
  // Calls only, also with Plant staff / Order viewer (owner, 2026-11-04)
  if (roles.includes("delivery_staff")) return "delivery";
  if (viewOnlyIn(roles, "order_capture")) return "viewer";
  // a Store keeper: "Purchases received" only (owner, 2026-11-10; docs/PURCHASES_PHASE_PLAN.md P5)
  return pageViewIn(roles, "order_capture") ? "store" : null;
}

export function toOcUser(s: ModuleSession): OcUser {
  const who = whoFor(s.roles);
  const also: Who[] = [];
  if (who === "desk" && s.roles.includes("accounts")) also.push("accounts");
  if ((who === "desk" || who === "accounts") && s.roles.includes("marketing_staff")) also.push("marketing");
  if (who === "marketing" && s.roles.includes("delivery_staff")) also.push("delivery");
  // a Store keeper who also has another Sales role keeps "Purchases received" (owner, 2026-11-10)
  if (who && who !== "owner" && who !== "store" && s.roles.includes("store_keeper")) also.push("store");
  return { tenantId: s.tenant_id, userId: s.user_id, name: s.display_name ?? "Sales user", roles: s.roles, who, also, isOwner: who === "owner", isSupport: false };
}

export const supportUser = (tenantId: string, superAdminId: string): OcUser => ({
  tenantId,
  userId: superAdminId,
  name: "PlantOps support",
  roles: [],
  who: "support",
  isOwner: false,
  isSupport: true,
});

/** For the header: Owner / Order desk / View only / Read-only. */
export function roleLabel(user: OcUser) {
  if (user.isSupport) return "Read-only";
  if (user.who === "viewer") return "View only";
  if (user.who === "delivery") return "Delivery staff";
  if (user.who === "store") return "Store keeper";
  if (user.who === "marketing") return user.also?.includes("delivery") ? "Marketing + Delivery" : "Marketing staff";
  if (user.who === "accounts") return user.also?.includes("marketing") ? "Accounts + Marketing" : "Accounts";
  if (user.also?.includes("accounts")) return user.also.includes("marketing") ? "Order desk + Accounts + Marketing" : "Order desk + Accounts";
  if (user.also?.includes("marketing")) return "Order desk + Marketing";
  return user.isOwner ? "Owner" : "Order desk";
}

export async function currentUser(): Promise<OcUser | null> {
  const who = await kit.currentSession();
  if (!who) return null;
  return who.kind === "support" ? supportUser(who.support.tenant_id, who.support.super_admin_id) : toOcUser(who.session);
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). Support views are logged. */
export async function requirePageUser(path: string): Promise<OcUser> {
  const user = await currentUser();
  if (!user) redirect(kit.platformLoginUrl(path));
  if (user.isSupport) {
    await withTenant(user.tenantId, (tx) =>
      tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: path.slice(0, 300) }),
    );
  }
  return user;
}

export async function requireApiUser(): Promise<OcUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

export const actorOf = (user: OcUser) => `user:${user.userId}`;

// Who is using Order Capture right now (from the module kit's session cookies). What they may do is in access.ts.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import { viewOnlyIn, type RoleId } from "@plantops/types";
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
  /** Order desk who also holds Accounts: ["accounts"] (bills and payments on top of order work) */
  also?: Who[];
  isOwner: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

/**
 * Owner wins over a staff role; desk = Order desk; delivery = Delivery staff without Order desk (Calls only); viewer =
 * plant staff / Order viewer without either (read-only, no amounts).
 */
export function whoFor(roles: RoleId[]): Who | null {
  if (roles.includes("tenant_admin")) return "owner";
  if (roles.includes("order_desk")) return "desk";
  if (roles.includes("accounts")) return "accounts";
  // Calls only, also with Plant staff / Order viewer (owner, 2026-11-04)
  if (roles.includes("delivery_staff")) return "delivery";
  return viewOnlyIn(roles, "order_capture") ? "viewer" : null;
}

export function toOcUser(s: ModuleSession): OcUser {
  const who = whoFor(s.roles);
  const also: Who[] = who === "desk" && s.roles.includes("accounts") ? ["accounts"] : [];
  return { tenantId: s.tenant_id, userId: s.user_id, name: s.display_name ?? "Order Capture user", roles: s.roles, who, also, isOwner: who === "owner", isSupport: false };
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
  if (user.who === "accounts") return "Accounts";
  if (user.also?.includes("accounts")) return "Order desk + Accounts";
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

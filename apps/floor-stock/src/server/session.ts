// Who is using Floor Stock right now (from the module kit's session cookies), and what they may do.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import type { RoleId } from "@plantops/types";
import { schema, withTenant } from "./db";
import { forbidden, HttpError } from "./http";
import { kit } from "./kit";

export interface StockUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** plant owner: sections, limits, moving items, export, the support-access log */
  isOwner: boolean;
  /** enter the daily count, add and edit items (owner or store keeper) */
  canCount: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

export function toStockUser(s: ModuleSession): StockUser {
  const isOwner = s.roles.includes("tenant_admin");
  return {
    tenantId: s.tenant_id,
    userId: s.user_id,
    name: s.display_name ?? "Floor Stock user",
    roles: s.roles,
    isOwner,
    canCount: isOwner || s.roles.includes("store_keeper") || s.roles.includes("plant_staff"),
    isSupport: false,
  };
}

export const supportUser = (tenantId: string, superAdminId: string): StockUser => ({
  tenantId,
  userId: superAdminId,
  name: "PlantOps support",
  roles: [],
  isOwner: false,
  canCount: false,
  isSupport: true,
});

export async function currentUser(): Promise<StockUser | null> {
  const who = await kit.currentSession();
  if (!who) return null;
  return who.kind === "support" ? supportUser(who.support.tenant_id, who.support.super_admin_id) : toStockUser(who.session);
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). Support views are logged. */
export async function requirePageUser(path: string): Promise<StockUser> {
  const user = await currentUser();
  if (!user) redirect(kit.platformLoginUrl(path));
  if (user.isSupport) {
    await withTenant(user.tenantId, (tx) =>
      tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: path.slice(0, 300) }),
    );
  }
  return user;
}

export async function requireApiUser(): Promise<StockUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

/** Daily count, add / edit items: owner or store keeper, never support. */
export function requireCount(user: StockUser) {
  if (user.isSupport) throw forbidden("PlantOps support view is read-only");
  if (!user.canCount) throw forbidden("Only the plant owner or a store keeper can do this");
}

/** Owner-only changes (sections, limits, moving items, ...). Support is never an owner. */
export function requireOwner(user: StockUser, message = "Only the plant owner can do this") {
  if (user.isSupport) throw forbidden("PlantOps support view is read-only");
  if (!user.isOwner) throw forbidden(message);
}

export const actorOf = (user: StockUser) => `user:${user.userId}`;

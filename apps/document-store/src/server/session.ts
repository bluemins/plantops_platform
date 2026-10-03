// Who is using Document Store right now (from the module kit's session cookies), and what they may do.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import type { RoleId } from "@plantops/types";
import { schema, withTenant } from "./db";
import { forbidden, HttpError } from "./http";
import { kit } from "./kit";

export interface DocUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** plant owner: everything, including the export and the support-access log */
  isOwner: boolean;
  /** add, renew, correct, archive documents; change the responsible person (owner or document keeper) */
  canManage: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

export function toDocUser(s: ModuleSession): DocUser {
  const isOwner = s.roles.includes("tenant_admin");
  return {
    tenantId: s.tenant_id,
    userId: s.user_id,
    name: s.display_name ?? "Document user",
    roles: s.roles,
    isOwner,
    canManage: isOwner || s.roles.includes("document_keeper"),
    isSupport: false,
  };
}

export const supportUser = (tenantId: string, superAdminId: string): DocUser => ({
  tenantId,
  userId: superAdminId,
  name: "PlantOps support",
  roles: [],
  isOwner: false,
  canManage: false,
  isSupport: true,
});

/** The daily job reading one plant's documents (it never writes documents; it can't, like support). */
export const systemReader = (tenantId: string): DocUser => ({ ...supportUser(tenantId, "00000000-0000-0000-0000-000000000000"), name: "PlantOps reminders" });

export async function currentUser(): Promise<DocUser | null> {
  const who = await kit.currentSession();
  if (!who) return null;
  return who.kind === "support" ? supportUser(who.support.tenant_id, who.support.super_admin_id) : toDocUser(who.session);
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). Support views are logged. */
export async function requirePageUser(path: string): Promise<DocUser> {
  const user = await currentUser();
  if (!user) redirect(kit.platformLoginUrl(path));
  if (user.isSupport) {
    await withTenant(user.tenantId, (tx) =>
      tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: path.slice(0, 300) }),
    );
  }
  return user;
}

export async function requireApiUser(): Promise<DocUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

/** Add / renew / correct / archive / reassign: owner or document keeper, never support. */
export function requireManage(user: DocUser) {
  if (user.isSupport) throw forbidden("PlantOps support view is read-only");
  if (!user.canManage) throw forbidden("Only the plant owner or a document keeper can do this");
}

export function requireOwner(user: DocUser) {
  if (!user.isOwner) throw forbidden("Only the plant owner can do this");
}

export const actorOf = (user: DocUser) => `user:${user.userId}`;

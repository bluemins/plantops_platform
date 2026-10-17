// Who is using Job applications right now (from the module kit's session cookies). What they may do is in access.ts.
// Only the protected screens use this; the public job page never reads a session.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import { roleWorksIn, type RoleId } from "@plantops/types";
import type { Who } from "./access";
import { schema, withTenant } from "./db";
import { HttpError } from "./http";
import { kit } from "./kit";

export interface JaUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** the row of the access table this person uses; null = no Job applications rights */
  who: Who | null;
  isOwner: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

/** Owner wins over a staff role; HR desk = a role that works in Job applications (roleWorksIn: never plant staff). */
export function whoFor(roles: RoleId[]): Who | null {
  if (roles.includes("tenant_admin")) return "owner";
  return roles.some((r) => roleWorksIn(r, "job_applications")) ? "hr" : null;
}

export function toJaUser(s: ModuleSession): JaUser {
  const who = whoFor(s.roles);
  return { tenantId: s.tenant_id, userId: s.user_id, name: s.display_name ?? "Job applications user", roles: s.roles, who, isOwner: who === "owner", isSupport: false };
}

export const supportUser = (tenantId: string, superAdminId: string): JaUser => ({
  tenantId,
  userId: superAdminId,
  name: "PlantOps support",
  roles: [],
  who: "support",
  isOwner: false,
  isSupport: true,
});

/** For the header: Owner / HR desk / Read-only. */
export function roleLabel(user: JaUser) {
  if (user.isSupport) return "Read-only";
  return user.isOwner ? "Owner" : "HR desk";
}

export async function currentUser(): Promise<JaUser | null> {
  const who = await kit.currentSession();
  if (!who) return null;
  return who.kind === "support" ? supportUser(who.support.tenant_id, who.support.super_admin_id) : toJaUser(who.session);
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). Support views are logged. */
export async function requirePageUser(path: string): Promise<JaUser> {
  const user = await currentUser();
  if (!user) redirect(kit.platformLoginUrl(path));
  if (user.isSupport) {
    await withTenant(user.tenantId, (tx) =>
      tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: path.slice(0, 300) }),
    );
  }
  return user;
}

export async function requireApiUser(): Promise<JaUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

export const actorOf = (user: JaUser) => `user:${user.userId}`;

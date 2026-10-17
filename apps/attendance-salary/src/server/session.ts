// Who is using Attendance right now (from the module kit's session cookies). What they may do is in access.ts.
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import { isEmployee, type RoleId } from "@plantops/types";
import type { Capacity, Who } from "./access";
import { schema, withTenant } from "./db";
import { HttpError } from "./http";
import { kit } from "./kit";

export interface AtUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** what this person is in the access table (several at once); empty = no Attendance rights */
  who: Who;
  isOwner: boolean;
  /** PlantOps support (super_admin) looking read-only: every write is refused */
  isSupport: boolean;
}

/** Every capacity the roles give: owner, employee (Plant staff), office (Office staff), supervisor; [] = nothing. */
export function whoFor(roles: readonly RoleId[]): Who {
  const who: Capacity[] = [];
  if (roles.includes("tenant_admin")) who.push("owner");
  if (isEmployee(roles)) who.push("employee");
  if (roles.includes("office_staff")) who.push("office");
  if (roles.includes("supervisor")) who.push("supervisor");
  return who;
}

export function toAtUser(s: ModuleSession): AtUser {
  const who = whoFor(s.roles);
  return {
    tenantId: s.tenant_id,
    userId: s.user_id,
    name: s.display_name ?? "Attendance user",
    roles: s.roles,
    who,
    isOwner: who.includes("owner"),
    isSupport: false,
  };
}

export const supportUser = (tenantId: string, superAdminId: string): AtUser => ({
  tenantId,
  userId: superAdminId,
  name: "PlantOps support",
  roles: [],
  who: ["support"],
  isOwner: false,
  isSupport: true,
});

/** For the header: Owner / Office staff / Supervisor / Plant staff / Read-only. */
export function roleLabel(user: AtUser) {
  if (user.isSupport) return "Read-only";
  if (user.isOwner) return "Owner";
  if (user.who.includes("office")) return "Office staff";
  if (user.who.includes("supervisor")) return "Supervisor";
  return "Plant staff";
}

export async function currentUser(): Promise<AtUser | null> {
  const who = await kit.currentSession();
  if (!who) return null;
  return who.kind === "support" ? supportUser(who.support.tenant_id, who.support.super_admin_id) : toAtUser(who.session);
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). Support views are logged. */
export async function requirePageUser(path: string): Promise<AtUser> {
  const user = await currentUser();
  if (!user) redirect(kit.platformLoginUrl(path));
  if (user.isSupport) {
    await withTenant(user.tenantId, (tx) =>
      tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: path.slice(0, 300) }),
    );
  }
  return user;
}

export async function requireApiUser(): Promise<AtUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

export const actorOf = (user: AtUser) => `user:${user.userId}`;

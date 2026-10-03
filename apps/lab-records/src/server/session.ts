// Who is using Lab Records right now, from the session cookie (session-cookie.ts).
// proxy.ts keeps it fresh (12 h shift, platform re-check every 5 minutes); every page and API checks it
// again here, so a page that the proxy somehow skipped still can't be opened without a valid session.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ModuleSession } from "@plantops/auth";
import type { RoleId } from "@plantops/types";
import { HttpError } from "./http";
import { platformLoginUrl } from "./platform";
import { readSession, SESSION_COOKIE } from "./session-cookie";

/** What a Lab Records screen needs to know about the person using it. */
export interface LabUser {
  tenantId: string;
  userId: string;
  name: string;
  roles: RoleId[];
  /** plant owner: views, approves, verifies, sets limits; does not enter test data */
  isOwner: boolean;
  /** lab lead: enters data and also approves, verifies, sets limits */
  isLead: boolean;
  /** may create batches and enter tests (lab technician or lab lead) */
  canEnter: boolean;
  /** may approve batches, release holds, verify entries, set limits (owner or lab lead) */
  canApprove: boolean;
}

export function toLabUser(s: ModuleSession): LabUser {
  const isOwner = s.roles.includes("tenant_admin");
  const isLead = s.roles.includes("lab_lead");
  return {
    tenantId: s.tenant_id,
    userId: s.user_id,
    name: s.display_name ?? "Lab user",
    roles: s.roles,
    isOwner,
    isLead,
    canEnter: isLead || s.roles.includes("lab_technician"),
    canApprove: isOwner || isLead,
  };
}

/** Current user or null (layout: never throws). */
export async function currentUser(): Promise<LabUser | null> {
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return s ? toLabUser(s) : null;
}

/** Pages: the current user, or off to the platform login (which brings them back to `path`). */
export async function requirePageUser(path: string): Promise<LabUser> {
  const user = await currentUser();
  if (!user) redirect(platformLoginUrl(path));
  return user;
}

/** API routes: the current user, or 401. */
export async function requireApiUser(): Promise<LabUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please log in again");
  return user;
}

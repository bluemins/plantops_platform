import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE, type CurrentUser } from "./auth";

export type PageAccess = { ok: true; user: CurrentUser } | { ok: false; to: string };

/**
 * For a page the server must refuse before sending anything (not only hide the link): who is looking, and where to
 * send anyone who may not see it. Owners only.
 */
export function ownerPageAccess(user: CurrentUser | null, path: string): PageAccess {
  if (!user) return { ok: false, to: `/login?next=${encodeURIComponent(path)}` };
  if (user.mustChangeSecret) return { ok: false, to: `/change-secret?next=${encodeURIComponent(path)}` };
  if (!user.roles.includes("tenant_admin")) return { ok: false, to: "/home" };
  return { ok: true, user };
}

/** The logged-in plant user of this page request, from the session cookie. */
export async function pageUser(): Promise<CurrentUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const req = new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` } });
  return getCurrentUser(req);
}

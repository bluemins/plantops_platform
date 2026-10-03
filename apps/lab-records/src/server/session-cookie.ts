// The Lab Records session cookie: signed with this module's own LAB_SESSION_SECRET (packages/auth).
// No Next.js page functions here, so proxy.ts can use it too.
import { openSession, RECHECK_GRACE_MINUTES, sealSession, SESSION_HOURS, type ModuleSession } from "@plantops/auth";
import { env } from "./env";
import { MODULE_ID } from "./platform";

export const SESSION_COOKIE = `plantops_${MODULE_ID}`; // modules on one host must not share a cookie

const sessionOpts = () => ({ secret: env.sessionSecret, moduleId: MODULE_ID });

export const sealCookie = (s: ModuleSession) => sealSession(s, sessionOpts());

/** Signature, shift and module checks only (the proxy then re-checks with the platform). */
export const openCookie = (value: string | undefined) => openSession(value, sessionOpts());

/** A valid session that was re-checked with the platform recently (the proxy does that every 5 minutes). */
export async function readSession(value: string | undefined, now = Date.now()): Promise<ModuleSession | null> {
  const s = await openCookie(value);
  if (!s || now - s.checked_at > RECHECK_GRACE_MINUTES * 60_000) return null;
  return s;
}

export function sessionCookie(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.secureCookies,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  };
}

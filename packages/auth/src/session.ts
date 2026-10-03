// Module-side login session: what every module app does after the platform hands a user over.
//   1. startModuleSession: swap the one-time code for an SSO token, verify it, check access.
//   2. sealSession / openSession: keep the session in a cookie signed with the MODULE's own secret.
//   3. refreshModuleSession: on each request; ends the session after one shift (12 h) and re-checks the user
//      with the platform every 5 minutes, so a disabled user or removed role loses access within ~5 minutes.
// Plain functions, no framework: Next.js modules and the dev placeholder use the same code.
import { jwtVerify, SignJWT } from "jose";
import { ModuleId, RoleId } from "@plantops/types";
import { AccessDeniedError, canAccessModule } from "./access";
import { exchangeCode, fetchUserStatus, PlatformRequestError, type ModuleCredentials } from "./client";
import { verifyToken, type KeySource } from "./verify";

export const SESSION_HOURS = 12;
export const RECHECK_MINUTES = 5;
/** If the platform is unreachable, keep working this long after the last successful check, then log out. */
export const RECHECK_GRACE_MINUTES = 15;

const HOUR = 3_600_000;
const MINUTE = 60_000;

export interface ModuleSession {
  tenant_id: string;
  user_id: string;
  roles: RoleId[];
  enabled_modules: ModuleId[];
  /** ms since epoch */
  login_at: number;
  /** ms since epoch: last successful status check with the platform */
  checked_at: number;
}

/** Step 1 (at /sso/callback?code=...): code -> verified token -> session. Throws if the user may not use this module. */
export async function startModuleSession(creds: ModuleCredentials, code: string, keys: KeySource, now = Date.now()): Promise<ModuleSession> {
  const token = await exchangeCode(creds, code);
  const p = await verifyToken(token, { audience: creds.moduleId, keys });
  if (!canAccessModule(p.roles, p.enabled_modules, creds.moduleId)) throw new AccessDeniedError(`No access to module ${creds.moduleId}`);
  return { tenant_id: p.tenant_id, user_id: p.user_id, roles: p.roles, enabled_modules: p.enabled_modules, login_at: now, checked_at: now };
}

function sessionKey(secret: string) {
  if (secret.length < 32) throw new Error("Module SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

/** Cookie value for the session, signed with the module's own SESSION_SECRET (never the platform's key). */
export async function sealSession(session: ModuleSession, opts: { secret: string; moduleId: ModuleId }) {
  return new SignJWT({ s: session })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`module-session:${opts.moduleId}`)
    .setExpirationTime(Math.floor((session.login_at + SESSION_HOURS * HOUR) / 1000))
    .sign(sessionKey(opts.secret));
}

const SessionShape = (moduleId: ModuleId) => ({
  parse(v: unknown): ModuleSession | null {
    const s = v as ModuleSession;
    if (!s || typeof s.tenant_id !== "string" || typeof s.user_id !== "string") return null;
    if (typeof s.login_at !== "number" || typeof s.checked_at !== "number") return null;
    const roles = RoleId.array().safeParse(s.roles);
    const mods = ModuleId.array().safeParse(s.enabled_modules);
    if (!roles.success || !mods.success || !mods.data.includes(moduleId)) return null;
    return { ...s, roles: roles.data, enabled_modules: mods.data };
  },
});

/** Reads the session cookie. Returns null for a missing, tampered, expired or other-module cookie. */
export async function openSession(value: string | undefined, opts: { secret: string; moduleId: ModuleId }): Promise<ModuleSession | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, sessionKey(opts.secret), {
      algorithms: ["HS256"],
      audience: `module-session:${opts.moduleId}`,
    });
    return SessionShape(opts.moduleId).parse(payload.s);
  } catch {
    return null;
  }
}

/**
 * Call on every request. Returns the (possibly updated) session, or null if the user must log in again:
 * shift over (12 h), user disabled, plant suspended, role or module removed, or module switched off.
 * `changed` tells the caller to write the cookie again.
 */
export async function refreshModuleSession(
  creds: ModuleCredentials,
  session: ModuleSession,
  now = Date.now(),
): Promise<{ session: ModuleSession; changed: boolean } | null> {
  if (now - session.login_at >= SESSION_HOURS * HOUR) return null;
  if (now - session.checked_at < RECHECK_MINUTES * MINUTE) return { session, changed: false };
  try {
    const status = await fetchUserStatus(creds, session.tenant_id, session.user_id);
    if (!status.active || !canAccessModule(status.roles, status.enabled_modules, creds.moduleId)) return null;
    return { session: { ...session, roles: status.roles, enabled_modules: status.enabled_modules, checked_at: now }, changed: true };
  } catch (err) {
    // The platform said no (unknown user, module switched off, wrong secret): log out now.
    if (err instanceof PlatformRequestError && err.status < 500) return null;
    // Platform unreachable or failing: keep going briefly, then fail closed.
    if (now - session.checked_at < RECHECK_GRACE_MINUTES * MINUTE) return { session, changed: false };
    return null;
  }
}

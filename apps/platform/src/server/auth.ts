import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { RoleId } from "@plantops/types";
import { audit } from "./audit";
import { burnTime, randomToken, sha256, validateSecret, verifySecret, hashSecret, type SecretKind } from "./crypto";
import { appDb, schema, withTenant, type PlatformTx } from "./db";
import { env } from "./env";
import { badRequest, cookieHeader, forbidden, getCookie, HttpError, unauthorized } from "./http";

const { users, userRoles, sessions, tenants } = schema;

export const SESSION_COOKIE = "plantops_session";
const SESSION_HOURS = 12; // one shift
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CurrentUser {
  tenantId: string;
  userId: string;
  username: string;
  displayName: string;
  roles: RoleId[];
  secretKind: SecretKind;
  mustChangeSecret: boolean;
  sessionHash: string;
}

const invalidLogin = () => new HttpError(401, "Plant code, username or PIN/password is wrong");
const lockedLogin = () =>
  new HttpError(423, `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes or ask your plant owner to unlock you.`);

export async function resolveTenant(plantCode: string): Promise<string | null> {
  const res = await appDb().execute<{ id: string | null }>(sql`select platform.resolve_tenant(${plantCode}) as id`);
  return res.rows[0]?.id ?? null;
}

export async function loadRoles(tx: PlatformTx, userId: string): Promise<RoleId[]> {
  const rows = await tx.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleId as RoleId).sort();
}

/** Plant code + username + PIN/password. Returns the session cookie value. */
export async function loginUser(input: { plantCode: string; username: string; secret: string }) {
  const tenantId = await resolveTenant(input.plantCode);
  if (!tenantId) {
    await burnTime(input.secret);
    throw invalidLogin();
  }
  // Failed-attempt counters must be saved, so the transaction returns an outcome instead of throwing.
  const outcome = await withTenant(tenantId, async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, input.username.trim().toLowerCase()));
    if (!user || user.status !== "active") {
      await burnTime(input.secret);
      return { kind: "invalid" as const };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) return { kind: "locked" as const };

    if (!(await verifySecret(user.secretHash, input.secret))) {
      const failed = user.failedAttempts + 1;
      const lock = failed >= MAX_FAILED_ATTEMPTS;
      await tx
        .update(users)
        .set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(users.id, user.id));
      if (!lock) return { kind: "invalid" as const };
      await audit(tx, { tenantId, actor: `user:${user.id}`, action: "user.locked", target: user.id });
      return { kind: "locked" as const };
    }

    await tx.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
    const token = randomToken();
    await tx.insert(sessions).values({
      idHash: sha256(token),
      tenantId,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
    });
    return { kind: "ok" as const, cookieValue: `${tenantId}.${token}`, mustChangeSecret: user.mustChangeSecret };
  });

  if (outcome.kind === "invalid") throw invalidLogin();
  if (outcome.kind === "locked") throw lockedLogin();
  return outcome;
}

export function sessionCookie(value: string) {
  return cookieHeader(SESSION_COOKIE, value, { maxAgeSeconds: SESSION_HOURS * 3600, secure: env.secureCookies });
}
export function clearedSessionCookie() {
  return cookieHeader(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: env.secureCookies });
}

/** The session cookie is "<tenantId>.<random>"; the tenant part only tells us which tenant to look in. */
function parseSessionCookie(req: Request) {
  const raw = getCookie(req, SESSION_COOKIE);
  const dot = raw?.indexOf(".") ?? -1;
  if (!raw || dot < 0) return null;
  const tenantId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  return UUID_RE.test(tenantId) && token ? { tenantId, sessionHash: sha256(token) } : null;
}

/** Valid, unexpired session of an active user in an active tenant - or null. */
export async function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  const parsed = parseSessionCookie(req);
  if (!parsed) return null;
  return withTenant(parsed.tenantId, async (tx) => {
    const [row] = await tx
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
      .where(
        and(
          eq(sessions.idHash, parsed.sessionHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, "active"),
          eq(tenants.status, "active"),
        ),
      );
    if (!row) return null;
    return {
      tenantId: parsed.tenantId,
      userId: row.user.id,
      username: row.user.username,
      displayName: row.user.displayName,
      roles: await loadRoles(tx, row.user.id),
      secretKind: row.user.secretKind,
      mustChangeSecret: row.user.mustChangeSecret,
      sessionHash: parsed.sessionHash,
    };
  });
}

/** Any logged-in plant user. Until they replace a temporary PIN/password, only change-secret is allowed. */
export async function requireUser(req: Request, opts: { allowMustChange?: boolean } = {}) {
  const user = await getCurrentUser(req);
  if (!user) throw unauthorized();
  if (user.mustChangeSecret && !opts.allowMustChange) throw forbidden("Please set your own PIN/password first");
  return user;
}

export async function requireTenantAdmin(req: Request) {
  const user = await requireUser(req);
  if (!user.roles.includes("tenant_admin")) throw forbidden();
  return user;
}

export async function logout(req: Request) {
  const parsed = parseSessionCookie(req);
  if (!parsed) return;
  await withTenant(parsed.tenantId, (tx) =>
    tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.idHash, parsed.sessionHash)),
  );
}

/** User replaces their PIN/password. Other sessions of this user are logged out. */
export async function changeSecret(user: CurrentUser, current: string, next: string) {
  await withTenant(user.tenantId, async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, user.userId));
    if (!row || !(await verifySecret(row.secretHash, current))) throw badRequest("Current PIN/password is wrong");
    const problem = validateSecret(row.secretKind, next);
    if (problem) throw badRequest(problem);
    if (next === current) throw badRequest("Choose a new PIN/password, different from the current one");
    await tx
      .update(users)
      .set({ secretHash: await hashSecret(next), mustChangeSecret: false })
      .where(eq(users.id, user.userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.userId), ne(sessions.idHash, user.sessionHash), isNull(sessions.revokedAt)));
    await audit(tx, { tenantId: user.tenantId, actor: `user:${user.userId}`, action: "user.secret_changed", target: user.userId });
  });
}

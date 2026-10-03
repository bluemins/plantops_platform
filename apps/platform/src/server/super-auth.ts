import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { audit } from "./audit";
import { burnTime, hashSecret, randomToken, sha256, validateSecret, verifySecret } from "./crypto";
import { schema, superDb } from "./db";
import { env } from "./env";
import { badRequest, cookieHeader, getCookie, HttpError, unauthorized } from "./http";
import { LOCK_MINUTES, MAX_FAILED_ATTEMPTS } from "./auth";

const { superAdmins, superAdminSessions } = schema;

export const SUPER_COOKIE = "plantops_super";
const SESSION_HOURS = 8;

export interface CurrentSuperAdmin {
  id: string;
  email: string;
  name: string;
}

export async function loginSuperAdmin(email: string, password: string) {
  const db = superDb();
  const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.email, email.trim().toLowerCase()));
  if (!admin || admin.disabledAt) {
    await burnTime(password);
    throw new HttpError(401, "Email or password is wrong");
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new HttpError(423, `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`);
  }
  if (!(await verifySecret(admin.passwordHash, password))) {
    const failed = admin.failedAttempts + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await db
      .update(superAdmins)
      .set({ failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(superAdmins.id, admin.id));
    throw lock
      ? new HttpError(423, `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`)
      : new HttpError(401, "Email or password is wrong");
  }
  const token = randomToken();
  await db.transaction(async (tx) => {
    await tx.update(superAdmins).set({ failedAttempts: 0, lockedUntil: null }).where(eq(superAdmins.id, admin.id));
    await tx.insert(superAdminSessions).values({
      idHash: sha256(token),
      superAdminId: admin.id,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
    });
    await audit(tx, { tenantId: null, actor: `super_admin:${admin.id}`, action: "super_admin.login" });
  });
  return token;
}

export function superCookie(value: string) {
  return cookieHeader(SUPER_COOKIE, value, { maxAgeSeconds: SESSION_HOURS * 3600, secure: env.secureCookies });
}
export function clearedSuperCookie() {
  return cookieHeader(SUPER_COOKIE, "", { maxAgeSeconds: 0, secure: env.secureCookies });
}

export async function getSuperAdmin(req: Request): Promise<CurrentSuperAdmin | null> {
  const token = getCookie(req, SUPER_COOKIE);
  if (!token) return null;
  const [row] = await superDb()
    .select({ id: superAdmins.id, email: superAdmins.email, name: superAdmins.name })
    .from(superAdminSessions)
    .innerJoin(superAdmins, eq(superAdmins.id, superAdminSessions.superAdminId))
    .where(
      and(
        eq(superAdminSessions.idHash, sha256(token)),
        isNull(superAdminSessions.revokedAt),
        gt(superAdminSessions.expiresAt, new Date()),
        isNull(superAdmins.disabledAt),
      ),
    );
  return row ?? null;
}

/** Gate for every /api/super/* route. Only after this may code use superDb(). */
export async function requireSuperAdmin(req: Request) {
  const admin = await getSuperAdmin(req);
  if (!admin) throw unauthorized();
  return admin;
}

export async function logoutSuperAdmin(req: Request) {
  const token = getCookie(req, SUPER_COOKIE);
  if (!token) return;
  await superDb()
    .update(superAdminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(superAdminSessions.idHash, sha256(token)));
}

/** Super_admin changes their own password. Other super_admin sessions are logged out. */
export async function changeSuperAdminPassword(req: Request, admin: CurrentSuperAdmin, current: string, next: string) {
  const db = superDb();
  const [row] = await db.select().from(superAdmins).where(eq(superAdmins.id, admin.id));
  if (!row || !(await verifySecret(row.passwordHash, current))) throw badRequest("Current password is wrong");
  const problem = validateSecret("password", next);
  if (problem) throw badRequest(problem);
  if (next === current) throw badRequest("Choose a new password, different from the current one");
  const keep = sha256(getCookie(req, SUPER_COOKIE) ?? "");
  await db.transaction(async (tx) => {
    await tx.update(superAdmins).set({ passwordHash: await hashSecret(next) }).where(eq(superAdmins.id, admin.id));
    await tx
      .update(superAdminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(superAdminSessions.superAdminId, admin.id), ne(superAdminSessions.idHash, keep), isNull(superAdminSessions.revokedAt)));
    await audit(tx, { tenantId: null, actor: `super_admin:${admin.id}`, action: "super_admin.password_changed", target: admin.id });
  });
}

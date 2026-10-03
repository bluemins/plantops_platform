import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { PlanLimits, RoleId } from "@plantops/types";
import { audit, type Actor } from "./audit";
import { hashSecret, temporarySecret, validateSecret, type SecretKind } from "./crypto";
import { schema, withTenant, type PlatformTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { CurrentUser } from "./auth";
import { loadRoles } from "./auth";

const { users, userRoles, sessions, tenantPlans } = schema;

export const Roles = z
  .array(RoleId)
  .min(1, "Choose at least one role")
  .refine((r) => new Set(r).size === r.length, "Roles must not repeat");

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,40}$/, "Username: 2-40 letters, digits, dot, dash or underscore");

/** Optional field: blank means "not set". */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const Phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{6,18}$/, "Phone: digits only, e.g. +91 98765 43210");
const Email = z.email("Email address is not valid").trim().toLowerCase();

export const NewUserInput = z.object({
  username: Username,
  display_name: z.string().trim().min(1).max(80),
  phone: z.preprocess((v) => blankToNull(v) ?? undefined, Phone.optional()),
  email: z.preprocess((v) => blankToNull(v) ?? undefined, Email.optional()),
  roles: Roles,
});
export type NewUserInput = z.infer<typeof NewUserInput>;

export const UpdateUserInput = z
  .object({
    display_name: z.string().trim().min(1).max(80),
    phone: z.preprocess(blankToNull, Phone.nullable()),
    email: z.preprocess(blankToNull, Email.nullable()),
    roles: Roles,
    status: z.enum(["active", "disabled"]),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

/** Leave `secret` blank for a random one. Either way it is temporary: the user replaces it at next login. */
export const ResetSecretInput = z.object({ secret: z.preprocess(blankToNull, z.string().nullable()).optional() });

/** tenant_admins (and anyone who is also a tenant_admin) use a password; staff use a 6-digit PIN. */
export function secretKindFor(roles: readonly RoleId[]): SecretKind {
  return roles.includes("tenant_admin") ? "password" : "pin";
}

/** Serialises user changes within one tenant, so limit and last-admin checks can't race each other. */
export async function lockTenantUsers(tx: PlatformTx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Throws if one more active user would exceed the plan's platform-wide max_users. */
export async function assertUserLimit(tx: PlatformTx, tenantId: string) {
  const [plan] = await tx.select({ limits: tenantPlans.limits }).from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId));
  const max = PlanLimits.safeParse(plan?.limits ?? {}).data?.platform.max_users;
  if (max === undefined) return;
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active")));
  if (count >= max) throw conflict(`User limit reached (${max}). Contact PlantOps to upgrade the plan.`);
}

/** Creates a user + roles with a temporary secret they must change on first login. Caller holds the tenant lock. */
export async function insertUser(tx: PlatformTx, tenantId: string, input: NewUserInput, actor: Actor) {
  await assertUserLimit(tx, tenantId);
  const kind = secretKindFor(input.roles);
  const temporary = temporarySecret(kind);
  let id: string;
  try {
    const [row] = await tx
      .insert(users)
      .values({
        tenantId,
        username: input.username,
        displayName: input.display_name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        secretHash: await hashSecret(temporary),
        secretKind: kind,
        mustChangeSecret: true,
        createdBy: actor,
      })
      .returning({ id: users.id });
    id = row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`Username "${input.username}" is already taken in this plant`);
    throw err;
  }
  await tx.insert(userRoles).values(input.roles.map((roleId) => ({ tenantId, userId: id, roleId, grantedBy: actor })));
  await audit(tx, { tenantId, actor, action: "user.created", target: id, details: { username: input.username, roles: input.roles } });
  return { id, temporary_secret: temporary, secret_kind: kind };
}

async function revokeSessions(tx: PlatformTx, userId: string) {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** At least one active tenant_admin must remain in every plant. */
async function assertAnotherAdmin(tx: PlatformTx, tenantId: string, exceptUserId: string) {
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.tenantId, tenantId),
        eq(userRoles.roleId, "tenant_admin"),
        eq(users.status, "active"),
        ne(users.id, exceptUserId),
      ),
    );
  if (count === 0) throw conflict("A plant must keep at least one active owner (tenant_admin)");
}

export function toView(u: typeof users.$inferSelect, roles: RoleId[]) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.displayName,
    phone: u.phone,
    email: u.email,
    roles,
    status: u.status,
    secret_kind: u.secretKind,
    must_change_secret: u.mustChangeSecret,
    locked: !!u.lockedUntil && u.lockedUntil > new Date(),
    created_at: u.createdAt,
  };
}

async function getUserRow(tx: PlatformTx, tenantId: string, userId: string) {
  // tenant filter matters for the super_admin login, which is not limited by row-level security
  const [row] = await tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  if (!row) throw notFound("User not found");
  return row;
}

// ---------- tenant_admin operations (always inside the admin's own tenant, via RLS) ----------

export function listUsers(admin: CurrentUser) {
  return withTenant(admin.tenantId, async (tx) => {
    const rows = await tx.select().from(users).orderBy(users.displayName);
    const roleRows = rows.length
      ? await tx.select().from(userRoles).where(inArray(userRoles.userId, rows.map((r) => r.id)))
      : [];
    return rows.map((u) =>
      toView(u, roleRows.filter((r) => r.userId === u.id).map((r) => r.roleId as RoleId).sort()),
    );
  });
}

export function getUser(admin: CurrentUser, userId: string) {
  return withTenant(admin.tenantId, async (tx) => toView(await getUserRow(tx, admin.tenantId, userId), await loadRoles(tx, userId)));
}

export function createUser(admin: CurrentUser, input: NewUserInput) {
  return withTenant(admin.tenantId, async (tx) => {
    await lockTenantUsers(tx, admin.tenantId);
    return insertUser(tx, admin.tenantId, input, `user:${admin.userId}`);
  });
}

/**
 * Changes a user's details, roles or status. Shared by the plant owner and super_admin, so the same rules apply:
 * plan user limit, at least one active owner, PIN <-> password when the owner role is added or removed.
 */
export async function applyUserUpdate(tx: PlatformTx, tenantId: string, userId: string, input: UpdateUserInput, actor: Actor) {
  await lockTenantUsers(tx, tenantId);
  const user = await getUserRow(tx, tenantId, userId);
  const currentRoles = await loadRoles(tx, userId);
  const isAdminNow = currentRoles.includes("tenant_admin") && user.status === "active";
  const nextRoles = input.roles ?? currentRoles;
  const nextStatus = input.status ?? user.status;
  if (isAdminNow && (!nextRoles.includes("tenant_admin") || nextStatus !== "active")) {
    await assertAnotherAdmin(tx, tenantId, userId);
  }
  if (user.status === "disabled" && nextStatus === "active") await assertUserLimit(tx, tenantId);

  const changes: Partial<typeof users.$inferInsert> = {};
  if (input.display_name !== undefined) changes.displayName = input.display_name;
  if (input.phone !== undefined) changes.phone = input.phone;
  if (input.email !== undefined) changes.email = input.email;
  if (input.status !== undefined) changes.status = input.status;
  // Becoming (or no longer being) an owner switches PIN <-> password; they set the new one at next login.
  const kind = secretKindFor(nextRoles);
  if (kind !== user.secretKind) Object.assign(changes, { secretKind: kind, mustChangeSecret: true });
  if (Object.keys(changes).length) await tx.update(users).set(changes).where(eq(users.id, userId));

  if (input.roles) {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(input.roles.map((roleId) => ({ tenantId, userId, roleId, grantedBy: actor })));
  }
  if (nextStatus === "disabled") await revokeSessions(tx, userId);
  await audit(tx, { tenantId, actor, action: "user.updated", target: userId, details: input });
  return toView(await getUserRow(tx, tenantId, userId), await loadRoles(tx, userId));
}

/**
 * New temporary PIN/password: typed by the admin, or random if left blank. The user must replace it at their
 * next login. Also unlocks them and logs them out everywhere. The secret itself is never written to the audit log.
 */
export async function applySecretReset(tx: PlatformTx, tenantId: string, userId: string, chosen: string | null | undefined, actor: Actor) {
  const user = await getUserRow(tx, tenantId, userId);
  if (chosen) {
    const problem = validateSecret(user.secretKind, chosen);
    if (problem) throw badRequest(problem);
  }
  const temporary = chosen || temporarySecret(user.secretKind);
  await tx
    .update(users)
    .set({ secretHash: await hashSecret(temporary), mustChangeSecret: true, failedAttempts: 0, lockedUntil: null })
    .where(eq(users.id, userId));
  await revokeSessions(tx, userId);
  await audit(tx, { tenantId, actor, action: "user.secret_reset", target: userId, details: { chosen_by_admin: !!chosen } });
  return { temporary_secret: temporary, secret_kind: user.secretKind };
}

export function updateUser(admin: CurrentUser, userId: string, input: UpdateUserInput) {
  return withTenant(admin.tenantId, (tx) => applyUserUpdate(tx, admin.tenantId, userId, input, `user:${admin.userId}`));
}

export function resetUserSecret(admin: CurrentUser, userId: string, chosen?: string | null) {
  return withTenant(admin.tenantId, (tx) => applySecretReset(tx, admin.tenantId, userId, chosen, `user:${admin.userId}`));
}

export function unlockUser(admin: CurrentUser, userId: string) {
  return withTenant(admin.tenantId, async (tx) => {
    await getUserRow(tx, admin.tenantId, userId);
    await tx.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
    await audit(tx, { tenantId: admin.tenantId, actor: `user:${admin.userId}`, action: "user.unlocked", target: userId });
  });
}

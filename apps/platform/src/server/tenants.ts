import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ModuleId, PlanLimits, type RoleId } from "@plantops/types";
import { audit } from "./audit";
import { ProfileInput, writeProfile } from "./business";
import { schema, superDb, withTenant, type PlatformTx } from "./db";
import { conflict, notFound } from "./http";
import { applySecretReset, applyUserUpdate, insertUser, lockTenantUsers, NewUserInput, toView, UpdateUserInput, Username } from "./users";
import type { CurrentSuperAdmin } from "./super-auth";

const { tenants, tenantPlans, users, userRoles, sessions } = schema;

export const PlanInput = z.object({
  plan_name: z.string().trim().min(1).max(40),
  enabled_modules: z.array(ModuleId).refine((m) => new Set(m).size === m.length, "Modules must not repeat"),
  limits: PlanLimits,
  renews_on: z.iso.date().nullable().default(null),
});
export type PlanInput = z.infer<typeof PlanInput>;

export const TenantAdminInput = NewUserInput.omit({ roles: true });

const PlantCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, "Plant code: 3-32 letters, digits, dash or underscore");

export const CreateTenantInput = z.object({
  code: PlantCode,
  name: z.string().trim().min(1).max(120),
  plan: PlanInput,
  admin: TenantAdminInput,
  business: ProfileInput.optional(),
});

/** Only super_admin may change the plant code (plant users type it at every login). */
export const UpdateTenantInput = z
  .object({ code: PlantCode, name: z.string().trim().min(1).max(120), status: z.enum(["active", "suspended"]) })
  .partial();

/** super_admin may also change the username (the owner may not). */
export const SuperUpdateUserInput = UpdateUserInput.extend({ username: Username }).partial();

const duplicateCode = (code: string) => conflict(`Plant code ${code} is already used`);

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function planView(p: typeof tenantPlans.$inferSelect | undefined) {
  if (!p) return null;
  return {
    tenant_id: p.tenantId,
    plan_name: p.planName,
    enabled_modules: p.enabledModules as ModuleId[],
    limits: PlanLimits.parse(p.limits),
    renews_on: p.renewsOn,
  };
}

const actorOf = (admin: CurrentSuperAdmin) => `super_admin:${admin.id}` as const;

// ---------- super_admin operations (platform_super login; caller has passed requireSuperAdmin) ----------

export async function listTenants() {
  const db = superDb();
  const rows = await db.select().from(tenants).leftJoin(tenantPlans, eq(tenantPlans.tenantId, tenants.id)).orderBy(tenants.name);
  const counts = await db
    .select({ tenantId: users.tenantId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, "active"))
    .groupBy(users.tenantId);
  return rows.map(({ tenants: t, tenant_plans: p }) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    status: t.status,
    hosting: t.hosting,
    plan: planView(p ?? undefined),
    active_users: counts.find((c) => c.tenantId === t.id)?.count ?? 0,
  }));
}

export async function getTenant(tenantId: string) {
  const db = superDb();
  const [row] = await db.select().from(tenants).leftJoin(tenantPlans, eq(tenantPlans.tenantId, tenants.id)).where(eq(tenants.id, tenantId));
  if (!row) throw notFound("Plant not found");
  const userRows = await db.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(users.displayName);
  const roleRows = userRows.length
    ? await db.select().from(userRoles).where(inArray(userRoles.userId, userRows.map((u) => u.id)))
    : [];
  return {
    id: row.tenants.id,
    code: row.tenants.code,
    name: row.tenants.name,
    status: row.tenants.status,
    hosting: row.tenants.hosting,
    plan: planView(row.tenant_plans ?? undefined),
    users: userRows.map((u) => toView(u, roleRows.filter((r) => r.userId === u.id).map((r) => r.roleId as RoleId).sort())),
  };
}

/** New plant + its plan + its first tenant_admin, all or nothing. Returns the admin's temporary password. */
export async function createTenant(admin: CurrentSuperAdmin, input: z.infer<typeof CreateTenantInput>) {
  const actor = actorOf(admin);
  return superDb().transaction(async (tx) => {
    let tenantId: string;
    try {
      const [row] = await tx.insert(tenants).values({ code: input.code, name: input.name }).returning({ id: tenants.id });
      tenantId = row!.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateCode(input.code);
      throw err;
    }
    await writePlan(tx, tenantId, input.plan, actor);
    await audit(tx, { tenantId, actor, action: "tenant.created", target: tenantId, details: { code: input.code } });
    if (input.business) await writeProfile(tx, tenantId, input.business, actor);
    const created = await insertUser(tx, tenantId, { ...input.admin, roles: ["tenant_admin"] }, actor);
    return { id: tenantId, code: input.code, admin_user_id: created.id, admin_temporary_password: created.temporary_secret };
  });
}

async function writePlan(tx: PlatformTx, tenantId: string, plan: PlanInput, actor: `super_admin:${string}`) {
  const values = {
    planName: plan.plan_name,
    enabledModules: plan.enabled_modules,
    limits: plan.limits,
    renewsOn: plan.renews_on,
    updatedAt: new Date(),
    updatedBy: actor,
  };
  await tx
    .insert(tenantPlans)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: tenantPlans.tenantId, set: values });
  await audit(tx, { tenantId, actor, action: "tenant.plan_set", target: tenantId, details: plan });
}

export async function updatePlan(admin: CurrentSuperAdmin, tenantId: string, plan: PlanInput) {
  await superDb().transaction(async (tx) => {
    const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw notFound("Plant not found");
    await writePlan(tx, tenantId, plan, actorOf(admin));
  });
  return getTenant(tenantId);
}

/**
 * Rename, change the plant code, or suspend/reactivate a plant. Suspending logs everyone in that plant out.
 * A new plant code applies from the next login; people already logged in stay logged in.
 */
export async function updateTenant(admin: CurrentSuperAdmin, tenantId: string, input: z.infer<typeof UpdateTenantInput>) {
  await superDb().transaction(async (tx) => {
    let t: { id: string } | undefined;
    try {
      [t] = await tx
        .update(tenants)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning({ id: tenants.id });
    } catch (err) {
      if (isUniqueViolation(err) && input.code) throw duplicateCode(input.code);
      throw err;
    }
    if (!t) throw notFound("Plant not found");
    if (input.status === "suspended") {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tenantId, tenantId), isNull(sessions.revokedAt)));
    }
    await audit(tx, { tenantId, actor: actorOf(admin), action: "tenant.updated", target: tenantId, details: input });
  });
  return getTenant(tenantId);
}

export async function createTenantAdmin(admin: CurrentSuperAdmin, tenantId: string, input: z.infer<typeof TenantAdminInput>) {
  return superDb().transaction(async (tx) => {
    const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw notFound("Plant not found");
    await lockTenantUsers(tx, tenantId);
    return insertUser(tx, tenantId, { ...input, roles: ["tenant_admin"] }, actorOf(admin));
  });
}

/**
 * super_admin edits any user of a plant: the same details/roles/status rules as the owner, plus the username.
 * A new username logs that user out; they log in again with the new name.
 */
export async function superUpdateUser(admin: CurrentSuperAdmin, tenantId: string, userId: string, input: z.infer<typeof SuperUpdateUserInput>) {
  const { username, ...details } = input;
  await superDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
    if (!user) throw notFound("User not found");
    if (username !== undefined && username !== user.username) {
      try {
        await tx.update(users).set({ username }).where(eq(users.id, userId));
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict(`Username "${username}" is already taken in this plant`);
        throw err;
      }
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await audit(tx, { tenantId, actor: actorOf(admin), action: "user.renamed", target: userId, details: { from: user.username, to: username } });
    }
    if (Object.keys(details).length) await applyUserUpdate(tx, tenantId, userId, details, actorOf(admin));
  });
  return getTenant(tenantId);
}

/** super_admin resets any user's PIN/password (typed or random; temporary either way). */
export function superResetSecret(admin: CurrentSuperAdmin, tenantId: string, userId: string, chosen?: string | null) {
  return superDb().transaction((tx) => applySecretReset(tx, tenantId, userId, chosen, actorOf(admin)));
}

/** The plan as seen by a module (GET /api/tenants/:id/plan). Read through RLS on the app login. */
export async function getPlanForTenant(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx.select().from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId));
    return planView(p);
  });
}

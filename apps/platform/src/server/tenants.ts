import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ModuleId, PlanLimits, type RoleId } from "@plantops/types";
import { audit } from "./audit";
import { hashSecret, temporarySecret } from "./crypto";
import { schema, superDb, withTenant, type PlatformTx } from "./db";
import { conflict, notFound } from "./http";
import { insertUser, lockTenantUsers, NewUserInput } from "./users";
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

export const CreateTenantInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, "Plant code: 3-32 letters, digits, dash or underscore"),
  name: z.string().trim().min(1).max(120),
  plan: PlanInput,
  admin: TenantAdminInput,
});

export const UpdateTenantInput = z
  .object({ name: z.string().trim().min(1).max(120), status: z.enum(["active", "suspended"]) })
  .partial();

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
    users: userRows.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.displayName,
      status: u.status,
      roles: roleRows.filter((r) => r.userId === u.id).map((r) => r.roleId as RoleId).sort(),
    })),
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
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === "23505" || e.cause?.code === "23505") throw conflict(`Plant code ${input.code} is already used`);
      throw err;
    }
    await writePlan(tx, tenantId, input.plan, actor);
    await audit(tx, { tenantId, actor, action: "tenant.created", target: tenantId, details: { code: input.code } });
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

/** Rename or suspend/reactivate a plant. Suspending logs everyone in that plant out. */
export async function updateTenant(admin: CurrentSuperAdmin, tenantId: string, input: z.infer<typeof UpdateTenantInput>) {
  await superDb().transaction(async (tx) => {
    const [t] = await tx
      .update(tenants)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id });
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

/** Super_admin may reset only a tenant_admin's password (staff PINs are the plant owner's job). */
export async function resetTenantAdminPassword(admin: CurrentSuperAdmin, tenantId: string, userId: string) {
  return superDb().transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId), eq(userRoles.roleId, "tenant_admin")));
    if (!role) throw notFound("Plant owner not found");
    const temporary = temporarySecret("password");
    await tx
      .update(users)
      .set({ secretHash: await hashSecret(temporary), secretKind: "password", mustChangeSecret: true, failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await audit(tx, { tenantId, actor: actorOf(admin), action: "user.secret_reset", target: userId });
    return { temporary_password: temporary };
  });
}

/** The plan as seen by a module (GET /api/tenants/:id/plan). Read through RLS on the app login. */
export async function getPlanForTenant(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx.select().from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId));
    return planView(p);
  });
}

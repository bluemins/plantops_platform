// super_admin "support view" (CLAUDE.md "Support token"): open ONE plant's module data read-only.
//   1. super_admin taps "Open read-only" -> one-time code (60 s, single use, this plant + this module only)
//   2. the module swaps it server-to-server for a 15-minute token: purpose "support", read_only: true
// The token has no user and no roles, so verifyToken (login) refuses it; modules refuse all writes with it
// and log each view for the plant owner. Each opening is also written to the platform audit log.
import { eq, sql } from "drizzle-orm";
import { SUPPORT_TOKEN_SECONDS, type ModuleId } from "@plantops/types";
import { audit } from "./audit";
import { randomToken, sha256 } from "./crypto";
import { appDb, schema, superDb } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { HANDOFF_CODE_SECONDS, enabledModules, signPlatformToken } from "./sso";
import type { CurrentSuperAdmin } from "./super-auth";

const { modules, supportHandoffCodes, tenants } = schema;

/** Step 1 (super_admin only): a one-time code and the module URL to open. */
export async function createSupportHandoff(admin: CurrentSuperAdmin, tenantId: string, moduleId: ModuleId) {
  return superDb().transaction(async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id, code: tenants.code }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound("Plant not found");
    if (!(await enabledModules(tx, tenantId)).includes(moduleId)) throw forbidden("This module is not in the plant's plan");
    const [mod] = await tx.select().from(modules).where(eq(modules.id, moduleId));
    if (!mod || mod.status !== "active" || !mod.baseUrl) throw conflict("This module is not set up or is switched off");
    const code = randomToken();
    await tx.insert(supportHandoffCodes).values({
      codeHash: sha256(code),
      superAdminId: admin.id,
      tenantId,
      moduleId,
      expiresAt: new Date(Date.now() + HANDOFF_CODE_SECONDS * 1000),
    });
    await audit(tx, { tenantId, actor: `super_admin:${admin.id}`, action: "support.opened", target: moduleId, details: { plant: tenant.code } });
    const url = new URL("/sso/support", mod.baseUrl);
    url.searchParams.set("code", code);
    return { redirect_url: url.toString() };
  });
}

/** Step 2 (module credentials): burns the code and returns the read-only support token. */
export async function exchangeSupportCode(moduleId: ModuleId, code: string) {
  const res = await appDb().execute<{ tenant_id: string; super_admin_id: string }>(
    sql`select * from platform.consume_support_code(${sha256(code)}, ${moduleId})`,
  );
  const row = res.rows[0];
  if (!row) throw badRequest("Code is invalid, expired or already used");
  const token = await signPlatformToken(
    { purpose: "support", tenant_id: row.tenant_id, super_admin_id: row.super_admin_id, read_only: true },
    moduleId,
    SUPPORT_TOKEN_SECONDS,
  );
  return { token, expires_in: SUPPORT_TOKEN_SECONDS };
}

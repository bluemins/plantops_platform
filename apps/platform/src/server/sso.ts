import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { importJWK, SignJWT, type JWK } from "jose";
import { canAccessModule } from "@plantops/auth";
import { ModuleId, TOKEN_ISSUER, type TokenPayload, type UserStatus } from "@plantops/types";
import { loadRoles, type CurrentUser } from "./auth";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { appDb, schema, withTenant, type PlatformTx } from "./db";
import { env } from "./env";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";

const { modules, tenants, tenantPlans, users, ssoHandoffCodes } = schema;

export const HANDOFF_CODE_SECONDS = 60;
export const TOKEN_MINUTES = 15;

// ---------- signing keys ----------

let signingKey: Promise<{ key: CryptoKey | Uint8Array; kid: string }> | undefined;
function getSigningKey() {
  signingKey ??= (async () => {
    const jwk = env.ssoPrivateJwk as JWK;
    if (!jwk.kid) throw new Error("SSO_PRIVATE_JWK_B64 must include a kid");
    return { key: await importJWK(jwk, "EdDSA"), kid: jwk.kid };
  })();
  return signingKey;
}

/** Public keys only (never `d`), served at /.well-known/jwks.json. Includes the previous key during rotation. */
export function publicJwks() {
  const toPublic = (k: JWK) => ({ kty: k.kty, crv: k.crv, x: k.x, kid: k.kid, alg: "EdDSA", use: "sig" });
  const keys = [toPublic(env.ssoPrivateJwk as JWK)];
  const previous = env.ssoPreviousPublicJwk as JWK | null;
  if (previous) keys.push(toPublic(previous));
  return { keys };
}

/** Signs a platform token for one module (iss, aud, iat, exp, jti are added here). */
export async function signPlatformToken(claims: Record<string, unknown>, audience: ModuleId, lifetimeSeconds: number) {
  const { key, kid } = await getSigningKey();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + lifetimeSeconds)
    .setJti(randomUUID())
    .sign(key);
}

/** The SSO login token. Contents fixed by CLAUDE.md - ask before changing. */
function signToken(claims: Omit<TokenPayload, "iss" | "iat" | "exp" | "jti" | "aud">, audience: ModuleId) {
  const { tenant_id, user_id, roles, enabled_modules } = claims;
  return signPlatformToken({ tenant_id, user_id, roles, enabled_modules }, audience, TOKEN_MINUTES * 60);
}

// ---------- module authentication (server-to-server) ----------

/** Modules call the platform with HTTP Basic auth: module id + client secret. */
export async function authenticateModule(req: Request): Promise<ModuleId> {
  const header = req.headers.get("authorization") ?? "";
  const unauthorizedModule = new HttpError(401, "Unknown module or wrong module secret");
  if (!header.startsWith("Basic ")) throw unauthorizedModule;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const moduleId = ModuleId.safeParse(decoded.slice(0, sep));
  const secret = decoded.slice(sep + 1);
  if (sep < 0 || !moduleId.success || !secret) throw unauthorizedModule;
  const [mod] = await appDb().select().from(modules).where(eq(modules.id, moduleId.data));
  if (!mod || mod.status !== "active" || !mod.clientSecretHash || !safeEqual(sha256(secret), mod.clientSecretHash)) {
    throw unauthorizedModule;
  }
  return moduleId.data;
}

// ---------- handoff + exchange ----------

export async function enabledModules(tx: PlatformTx, tenantId: string): Promise<ModuleId[]> {
  const [plan] = await tx.select({ m: tenantPlans.enabledModules }).from(tenantPlans).where(eq(tenantPlans.tenantId, tenantId));
  return (plan?.m ?? []).filter((m): m is ModuleId => ModuleId.safeParse(m).success);
}

/** Modules this user may open right now (enabled for the plant AND allowed by their roles). */
export async function accessibleModules(user: CurrentUser): Promise<ModuleId[]> {
  const enabled = await withTenant(user.tenantId, (tx) => enabledModules(tx, user.tenantId));
  return enabled.filter((m) => canAccessModule(user.roles, enabled, m));
}

/**
 * Step 1: logged-in user taps a module tile. Checks access, stores a one-time code (hash only, 60 s) and
 * returns the module's callback URL. The token itself never travels through the browser.
 */
export async function createHandoff(user: CurrentUser, moduleId: ModuleId) {
  return withTenant(user.tenantId, async (tx) => {
    const enabled = await enabledModules(tx, user.tenantId);
    if (!canAccessModule(user.roles, enabled, moduleId)) throw forbidden("This module is not available for you");
    const [mod] = await tx.select().from(modules).where(eq(modules.id, moduleId));
    if (!mod || mod.status !== "active" || !mod.baseUrl) throw conflict("This module is not set up yet");
    const code = randomToken();
    await tx.insert(ssoHandoffCodes).values({
      codeHash: sha256(code),
      tenantId: user.tenantId,
      userId: user.userId,
      moduleId,
      expiresAt: new Date(Date.now() + HANDOFF_CODE_SECONDS * 1000),
    });
    const url = new URL("/sso/callback", mod.baseUrl);
    url.searchParams.set("code", code);
    return { redirect_url: url.toString() };
  });
}

/**
 * Step 2: the module's server swaps the code for a signed token. The code is burned atomically, must have
 * been issued for this module, and the user, tenant and access rule are checked again right now.
 */
export async function exchangeHandoffCode(moduleId: ModuleId, code: string) {
  const res = await appDb().execute<{ tenant_id: string; user_id: string }>(
    sql`select * from platform.consume_handoff_code(${sha256(code)}, ${moduleId})`,
  );
  const consumed = res.rows[0];
  if (!consumed) throw badRequest("Code is invalid, expired or already used");

  const claims = await withTenant(consumed.tenant_id, async (tx) => {
    const [row] = await tx
      .select({ userStatus: users.status, tenantStatus: tenants.status })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, consumed.user_id));
    if (!row || row.userStatus !== "active" || row.tenantStatus !== "active") throw forbidden("User is no longer active");
    const roles = await loadRoles(tx, consumed.user_id);
    const enabled = await enabledModules(tx, consumed.tenant_id);
    if (!canAccessModule(roles, enabled, moduleId)) throw forbidden("This module is not available for this user");
    return { tenant_id: consumed.tenant_id, user_id: consumed.user_id, roles, enabled_modules: enabled };
  });
  return { token: await signToken(claims, moduleId), expires_in: TOKEN_MINUTES * 60 };
}

/** Modules re-check this every few minutes so a disabled user / removed role loses access quickly. */
export async function getUserStatus(tenantId: string, userId: string): Promise<UserStatus> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ userStatus: users.status, tenantStatus: tenants.status })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, userId));
    if (!row) throw notFound("User not found");
    return {
      active: row.userStatus === "active" && row.tenantStatus === "active",
      roles: await loadRoles(tx, userId),
      enabled_modules: await enabledModules(tx, tenantId),
    };
  });
}

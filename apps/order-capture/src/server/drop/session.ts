// A Drop session on every customer-API request (docs/CUSTOMER_APP_PHASE_PLAN.md "Login"): the app id names the plant,
// the bearer token names the session. Refused (401 session_ended) when it was ended or has expired, or when the shop
// is switched off for Drop, the customer is switched off, or the phone is no longer one of the shop's phones; such a
// session is marked ended with the reason, so it never comes back. "Last seen" is written at most once an hour.
import { and, eq, isNull } from "drizzle-orm";
import { schema, withTenant } from "../db";
import { appOf, DropError } from "./api";
import type { DropApp } from "./config";
import { tokenHash, TOKEN_RE } from "./login";
import { removeSessionDevices } from "./push";
import { dropAccess, sessionProblem } from "./shops";

const { appSessions, auditLog, customers } = schema;

const ENDED = new DropError(401, "session_ended", "Please log in again");
const SEEN_EVERY_MS = 60 * 60_000;

export interface AppSession {
  app: DropApp;
  sessionId: string;
  customerId: string;
  name: string;
  phone: string;
  /** the brands this shop sees: the plant's main brand first, then the ticked ones */
  brands: string[];
}

function tokenOf(req: Request) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  return m && TOKEN_RE.test(m[1]!) ? m[1]! : null;
}

export async function appSession(req: Request, now = new Date()): Promise<AppSession> {
  const app = await appOf(req);
  const token = tokenOf(req);
  if (!token) throw ENDED;
  const out = await withTenant(app.tenantId, async (tx) => {
    const [s] = await tx.select().from(appSessions).where(and(eq(appSessions.tenantId, app.tenantId), eq(appSessions.tokenSha256, tokenHash(token))));
    if (!s || s.endedAt || s.expiresAt <= now) return null;
    const problem = await sessionProblem(tx, app.tenantId, s.customerId, s.phone);
    if (problem) {
      await tx.update(appSessions).set({ endedAt: now, endReason: problem }).where(and(eq(appSessions.tenantId, app.tenantId), eq(appSessions.id, s.id), isNull(appSessions.endedAt)));
      return null;
    }
    if (now.getTime() - s.lastSeenAt.getTime() >= SEEN_EVERY_MS) {
      await tx.update(appSessions).set({ lastSeenAt: now }).where(and(eq(appSessions.tenantId, app.tenantId), eq(appSessions.id, s.id)));
    }
    const [c] = await tx.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, app.tenantId), eq(customers.id, s.customerId)));
    const access = await dropAccess(tx, app.tenantId, s.customerId);
    return { sessionId: s.id, customerId: s.customerId, name: c!.name, phone: s.phone, brands: [app.brand, ...access.brands] };
  });
  if (!out) throw ENDED;
  return { app, ...out };
}

/** Log out: the session ends now (a token already ended is fine). */
export async function logout(req: Request, now = new Date()) {
  const app = await appOf(req);
  const token = tokenOf(req);
  if (!token) return;
  await withTenant(app.tenantId, async (tx) => {
    const [s] = await tx
      .update(appSessions)
      .set({ endedAt: now, endReason: "logout" })
      .where(and(eq(appSessions.tenantId, app.tenantId), eq(appSessions.tokenSha256, tokenHash(token)), isNull(appSessions.endedAt)))
      .returning({ id: appSessions.id, customerId: appSessions.customerId });
    if (s) await removeSessionDevices(tx, app.tenantId, s.id, now);
    if (s) await tx.insert(auditLog).values({ tenantId: app.tenantId, actor: `drop-app:${s.customerId}`, action: "app.logout", target: s.customerId, details: { by: "Drop app" } });
  });
}

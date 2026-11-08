// Drop login: phone number → 6-digit code on WhatsApp → a 90-day session (docs/CUSTOMER_APP_PHASE_PLAN.md "Login").
//   * Every number gets the same answer ("if this number can use Drop, a code is on its way"), so nobody can find out
//     which numbers are customers. A code is made and sent only for the main or an extra phone of an active,
//     switched-on shop, within the limits, and only when the plant has a login template. The WhatsApp message is sent
//     after the answer, so the answer's timing doesn't tell either.
//   * Only an HMAC of the code is stored (DROP_CODE_SECRET); 10 minutes; single use; 5 wrong tries end it.
//   * Limits: per phone 3 codes per 15 minutes and 10 a day (counted in the database, so a restart doesn't reset
//     them); per connection 20 starts and 30 code checks an hour (in memory, like the bot's).
//   * A session token ("dpt_" + 32 random bytes) is shown once to the app; only its SHA-256 is stored.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { schema, withTenant, type OcTx } from "../db";
import { env } from "../env";
import { senderFor, twilioTemplate, type SendResult } from "../thanks";
import { DropError } from "./api";
import type { DropApp } from "./config";
import { shopForLogin } from "./shops";

const { appLoginCodes, appSessions, auditLog } = schema;

export const CODE_MINUTES = 10;
export const MAX_TRIES = 5;
export const SESSION_DAYS = 90;
export const PER_15_MIN = 3;
export const PER_DAY = 10;
export const RESEND_SECONDS = 60;

export const StartInput = z.object({ phone: z.string().max(30) }).strict();
export const VerifyInput = z.object({ phone: z.string().max(30), code: z.string().max(10) }).strict();

const HOUR = 60 * 60_000;
export const TOKEN_RE = /^dpt_[A-Za-z0-9_-]{43}$/;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const codeHmac = (tenantId: string, phone: string, code: string) => createHmac("sha256", env.dropCodeSecret).update(`${tenantId}|${phone}|${code}`).digest("hex");

function phoneOf(typed: string) {
  const phone = normalisePhone(typed);
  if (!phone) throw new DropError(400, "bad_phone", "Please enter a 10-digit mobile number");
  return phone;
}

/** One audit row for the app (kept out of Recent changes: actions app.*); never the phone number or the code. */
async function appAudit(tx: OcTx, tenantId: string, customerId: string, action: string, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({ tenantId, actor: `drop-app:${customerId}`, action, target: customerId, details: { by: "Drop app", ...details } });
}

export interface StartResult {
  answer: { ok: true; resend_after: number };
  /** the WhatsApp message to send after the answer; null = nothing to send (the caller can't tell from the answer) */
  send: (() => Promise<SendResult>) | null;
}

/** Ask for a code. Always the same answer; `send` is run by the route after answering. */
export async function startLogin(app: DropApp, input: z.infer<typeof StartInput>, now = new Date()): Promise<StartResult> {
  const phone = phoneOf(input.phone);
  const answer = { ok: true as const, resend_after: RESEND_SECONDS };
  const sender = senderFor(app.tenantId);
  const template = sender?.loginContentSid ?? null;
  if (!sender || !template) return { answer, send: null };
  return withTenant(app.tenantId, async (tx) => {
    // one code request per phone at a time, so two taps can't both pass the limits
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`drop-code:${app.tenantId}:${phone}`}, 0))`);
    const shop = await shopForLogin(tx, app.tenantId, phone);
    if (!shop) return { answer, send: null };
    const [counts] = await tx
      .select({
        quarter: sql<number>`count(*) filter (where ${appLoginCodes.createdAt} > ${new Date(now.getTime() - 15 * 60_000)})::int`,
        day: sql<number>`count(*)::int`,
      })
      .from(appLoginCodes)
      .where(and(eq(appLoginCodes.tenantId, app.tenantId), eq(appLoginCodes.phone, phone), gt(appLoginCodes.createdAt, new Date(now.getTime() - 24 * HOUR))));
    if ((counts?.quarter ?? 0) >= PER_15_MIN || (counts?.day ?? 0) >= PER_DAY) return { answer, send: null };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(appLoginCodes).values({
      tenantId: app.tenantId,
      customerId: shop.customer.id,
      phone,
      codeHmac: codeHmac(app.tenantId, phone, code),
      expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
      createdAt: now,
    });
    await appAudit(tx, app.tenantId, shop.customer.id, "app.code", { phone_kind: shop.customer.phone === phone ? "main" : "extra" });
    const send = async () => {
      const r = await twilioTemplate({ from: sender.from, contentSid: template }, phone, { "1": code });
      if (!r.ok) {
        console.error(`[order-capture] Drop login code not sent: ${r.error}`);
        await withTenant(app.tenantId, (t) => appAudit(t, app.tenantId, shop.customer.id, "app.code_failed", { error: r.error }));
      }
      return r;
    };
    return { answer, send };
  });
}

const WRONG = new DropError(401, "wrong_code", "That code is wrong or has expired. Ask for a new one.");

/** Check a code; the right one gives a new session (token shown once). */
export async function verifyLogin(app: DropApp, input: z.infer<typeof VerifyInput>, now = new Date()) {
  const phone = phoneOf(input.phone);
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) throw WRONG;
  const out = await withTenant(app.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(appLoginCodes)
      .where(and(eq(appLoginCodes.tenantId, app.tenantId), eq(appLoginCodes.phone, phone), isNull(appLoginCodes.usedAt), gt(appLoginCodes.expiresAt, now), lt(appLoginCodes.attempts, MAX_TRIES)))
      .orderBy(desc(appLoginCodes.createdAt), desc(appLoginCodes.id))
      .limit(1)
      .for("update");
    if (!row) return { wrong: true as const };
    const ok = timingSafeEqual(Buffer.from(row.codeHmac, "hex"), Buffer.from(codeHmac(app.tenantId, phone, code), "hex"));
    if (!ok) {
      await tx.update(appLoginCodes).set({ attempts: row.attempts + 1 }).where(and(eq(appLoginCodes.tenantId, app.tenantId), eq(appLoginCodes.id, row.id)));
      return { wrong: true as const };
    }
    await tx.update(appLoginCodes).set({ usedAt: now }).where(and(eq(appLoginCodes.tenantId, app.tenantId), eq(appLoginCodes.id, row.id)));
    const shop = await shopForLogin(tx, app.tenantId, phone);
    if (!shop || shop.customer.id !== row.customerId) return { wrong: true as const };
    const token = `dpt_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * HOUR);
    await tx.insert(appSessions).values({ tenantId: app.tenantId, customerId: shop.customer.id, phone, tokenSha256: tokenHash(token), createdAt: now, expiresAt, lastSeenAt: now });
    await appAudit(tx, app.tenantId, shop.customer.id, "app.login", { phone_kind: shop.customer.phone === phone ? "main" : "extra" });
    return { wrong: false as const, token, expiresAt, name: shop.customer.name };
  });
  // the wrong try is counted (committed) before refusing
  if (out.wrong) throw WRONG;
  return { token: out.token, expires_at: out.expiresAt.toISOString(), shop: { name: out.name } };
}

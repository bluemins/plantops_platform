// Phone calls from the order phone (docs/CALLS_PHASE_PLAN.md "Recording a call"). MacroDroid on the owner's phone sends
// every incoming and missed call to POST /api/calls/v1 with one key. Rules:
//   * the plant comes from the key's entry in ORDER_CALL_KEYS, never from the request; only the key's SHA-256 is stored
//   * the key can only add call events: no reads, no customers, no orders
//   * a number on the owner's "Not an order number" list is not stored at all (no ring, no count, no alert)
//   * one ring is never counted twice: 'missed' marks the newest 'incoming' of that number in the last 3 minutes; the
//     same number + event within 60 s is a repeat send (MacroDroid retry) and is ignored
//   * stored: number, event, time, key id. Never the call audio, contacts or anything else from the phone
//   * errors, limits and the plan check are the bot API's own (bot.ts): { error: { code, message } }
//   * "Customer called" goes to the plant's Delivery staff when a number starts waiting, and again for the same waiting
//     number only 10 minutes after its last alert; worked out from the stored rings, nothing extra is stored
import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { BotError, errorResponse, limit } from "./bot";
import { findByPhone } from "./customers";
import { schema, withTenant, type OcTx } from "./db";
import { env } from "./env";
import { clientIp } from "./http";

const { callEvents, callAttended, ignoredNumberChanges } = schema;

// ---------- keys ----------
const KeyEntry = z
  .object({
    id: z.uuid(),
    tenant_id: z.uuid(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    label: z.string().min(1).max(80),
  })
  .strict();
export type CallKey = z.infer<typeof KeyEntry>;

/** "occ_" + 32 random bytes in base64url (43 characters). */
export const CALL_KEY_RE = /^occ_[A-Za-z0-9_-]{43}$/;
export const hashCallKey = (key: string) => createHash("sha256").update(key).digest("hex");

let parsedFrom: string | null = null;
let parsed: CallKey[] = [];
let parseProblem: string | null = null;
/** The configured keys. A broken ORDER_CALL_KEYS switches the call address off (logged, and shown by /health). */
export function callKeys(): CallKey[] {
  const raw = env.callKeys;
  if (raw === parsedFrom) return parsed;
  parsedFrom = raw;
  parsed = [];
  parseProblem = null;
  if (!raw.trim()) return parsed;
  try {
    const keys = z.array(KeyEntry).parse(JSON.parse(raw));
    if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new Error("two entries share an id");
    parsed = keys;
  } catch (err) {
    parseProblem = "ORDER_CALL_KEYS is not valid, so phone calls are off";
    console.error(`[order-capture] ${parseProblem}:`, (err as Error).message);
  }
  return parsed;
}

/** What is wrong with ORDER_CALL_KEYS (for /health); null = fine or not set. */
export function callKeysProblem(): string | null {
  callKeys();
  return parseProblem;
}

/** Which key sent this. Unknown / missing / removed key = 401; more than 10 failures a minute from one address = 429. */
export function authenticateCall(req: Request): CallKey {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  const given = m && CALL_KEY_RE.test(m[1]!) ? Buffer.from(hashCallKey(m[1]!), "hex") : null;
  const key = given ? callKeys().find((k) => timingSafeEqual(Buffer.from(k.sha256, "hex"), given)) : undefined;
  if (key) return key;
  console.warn("[order-capture] call address: refused an unknown or missing key");
  limit(`call-auth:${clientIp(req)}`, 10);
  throw new BotError(401, "unauthorized", "Unknown or missing phone key");
}

/** 30 events a minute per key. */
export const limitKey = (key: CallKey) => limit(`call-key:${key.id}`, 30);

export const CallInput = z.object({ phone: z.string().max(40), event: z.enum(["incoming", "missed"]) }).strict();

/** Anything unexpected (database, platform) is logged and answered 503, so MacroDroid tries again later. */
export function callError(err: unknown) {
  if (err instanceof BotError) return errorResponse(err);
  console.error("[order-capture] call address:", err);
  return errorResponse(new BotError(503, "unavailable", "Order Capture can't answer right now; try again later"));
}

// ---------- numbers ----------
/**
 * How a number is stored: an Indian mobile as its 10 digits (normalisePhone, any spelling), a landline as its digits
 * (at most 15), an empty / hidden number as "hidden". Only mobiles can become customers.
 */
export function callNumber(typed: string): string {
  const mobile = normalisePhone(typed);
  if (mobile) return mobile;
  const digits = typed.replace(/\D/g, "");
  if (!digits) return "hidden";
  if (digits.length > 15) throw new BotError(400, "bad_phone", "A phone number has at most 15 digits");
  return digits;
}
export const isMobile = (phone: string) => /^[6-9]\d{9}$/.test(phone);

// ---------- recording ----------
const REPEAT_MS = 60_000;
const JOIN_MS = 3 * 60_000;
export const REALERT_MS = 10 * 60_000;

/** What the alert says about one waiting number (src/server/notify.ts callNotification writes the text). */
export interface CallAlert {
  phone: string;
  missed: boolean;
  customer: { name: string; place: string } | null;
  /** waiting rings so far, this one included */
  rings: number;
  /** 1 = the first alert for this waiting number, 2 = the next one 10 minutes later … */
  n: number;
  firstRingId: string;
}

export type CallResult =
  | { status: 200; body: { ignored: true } }
  | { status: 200; body: { recorded: false; repeat: true } }
  | { status: 201; body: { recorded: true }; alert: CallAlert | null };

/** Is this number on the owner's "Not an order number" list (its newest row is 'add')? */
export async function isIgnored(tx: OcTx, tenantId: string, phone: string) {
  if (phone === "hidden") return false;
  const [last] = await tx
    .select({ action: ignoredNumberChanges.action })
    .from(ignoredNumberChanges)
    .where(and(eq(ignoredNumberChanges.tenantId, tenantId), eq(ignoredNumberChanges.phone, phone)))
    .orderBy(desc(ignoredNumberChanges.createdAt), desc(ignoredNumberChanges.id))
    .limit(1);
  return last?.action === "add";
}

/**
 * One number at a time: two quick sends (incoming + missed, a retry) and an Attended tap for the same number are
 * handled one after the other, never interleaved.
 */
export async function lockNumber(tx: OcTx, tenantId: string, phone: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.call'), hashtext(${`${tenantId}:${phone}`}))`);
}

/** A ring = an incoming event, or a missed one with no ring_id. */
const isRing = or(eq(callEvents.event, "incoming"), isNull(callEvents.ringId));

/** Records one event from the order phone (the rules at the top). `at` is now, except in tests. */
export async function recordCall(key: CallKey, input: z.infer<typeof CallInput>, at = new Date()): Promise<CallResult> {
  const phone = callNumber(input.phone);
  const tenantId = key.tenant_id;
  return withTenant(tenantId, async (tx) => {
    await lockNumber(tx, tenantId, phone);
    if (await isIgnored(tx, tenantId, phone)) return { status: 200, body: { ignored: true } } as const;

    const [repeat] = await tx
      .select({ id: callEvents.id })
      .from(callEvents)
      .where(and(eq(callEvents.tenantId, tenantId), eq(callEvents.phone, phone), eq(callEvents.event, input.event), gt(callEvents.createdAt, new Date(at.getTime() - REPEAT_MS))))
      .limit(1);
    if (repeat) return { status: 200, body: { recorded: false, repeat: true } } as const;

    let ringId: string | null = null;
    if (input.event === "missed") {
      const [ring] = await tx
        .select({ id: callEvents.id })
        .from(callEvents)
        .where(
          and(
            eq(callEvents.tenantId, tenantId),
            eq(callEvents.phone, phone),
            eq(callEvents.event, "incoming"),
            gt(callEvents.createdAt, new Date(at.getTime() - JOIN_MS)),
            // not already marked missed by an earlier 'missed'
            sql`not exists (select 1 from order_capture.call_events m where m.tenant_id = ${tenantId} and m.ring_id = ${callEvents.id})`,
          ),
        )
        .orderBy(desc(callEvents.createdAt))
        .limit(1);
      ringId = ring?.id ?? null;
    }
    const [row] = await tx.insert(callEvents).values({ tenantId, keyId: key.id, phone, event: input.event, ringId, createdAt: at }).returning({ id: callEvents.id });
    // a missed that marks its incoming ring is not a new ring: nobody is told again
    const alert = ringId ? null : await alertFor(tx, tenantId, phone, row!.id, input.event === "missed");
    return { status: 201, body: { recorded: true }, alert } as const;
  });
}

/**
 * Should this new ring alert? The number's waiting rings are those after its newest Attended. The first one alerts;
 * a later one alerts only when 10 minutes have passed since the last ring that alerted.
 */
async function alertFor(tx: OcTx, tenantId: string, phone: string, ringId: string, missed: boolean): Promise<CallAlert | null> {
  const [att] = await tx.select({ upto: max(callAttended.upto) }).from(callAttended).where(and(eq(callAttended.tenantId, tenantId), eq(callAttended.phone, phone)));
  const rings = await tx
    .select({ id: callEvents.id, at: callEvents.createdAt })
    .from(callEvents)
    .where(and(eq(callEvents.tenantId, tenantId), eq(callEvents.phone, phone), isRing, ...(att?.upto ? [gt(callEvents.createdAt, att.upto)] : [])))
    .orderBy(asc(callEvents.createdAt), asc(callEvents.id));
  let n = 0;
  let lastAlert = -Infinity;
  let thisAlerts = false;
  for (const r of rings) {
    const alerts = r.at.getTime() - lastAlert >= REALERT_MS;
    if (alerts) {
      n += 1;
      lastAlert = r.at.getTime();
    }
    if (r.id === ringId) thisAlerts = alerts;
  }
  if (!thisAlerts || !rings.length) return null;
  const c = isMobile(phone) ? await findByPhone(tx, tenantId, phone) : null;
  return { phone, missed, customer: c ? { name: c.name, place: c.place } : null, rings: rings.length, n, firstRingId: rings[0]!.id };
}

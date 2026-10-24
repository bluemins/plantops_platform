// The WhatsApp bot's API (docs/WHATSAPP_CONTRACT.md 3.1–3.11; Step 2 of docs/WHATSAPP_BUILD_PLAN.md). Server to
// server only: the bot holds one key, never a staff session, a module secret or a database login. Rules:
//   * the plant comes from the key's entry in ORDER_BOT_KEYS, never from the request; only the key's SHA-256 is stored
//   * Step 2: customer context by phone (3.2) and the two alerts (3.11)
//   * Step 3: a confirmed order (3.3) through the staff form's own save (`saveOrder`): existing switched-on customers
//     only, the key's products only, 1–200 boxes each, the Rates default rate (else ₹0; staff agree the price by
//     phone), the idempotency key as the order's request key; the order by key (3.4) for this key's orders only.
//     ORDER_BOT_ORDERS=off refuses new orders (403 ordering_off) while reads keep working
//   * Step 4: the customer's answer about reorder reminders (consent.ts): asked after an order, STOP / START, the
//     reminder's "Stop reminders" button; the context answer says the newest answer so the bot asks at most once
//   * the answers carry only the agreed fields: no rates, amounts, notes, staff names or other customers
//   * an unknown or switched-off phone gets `customer: null` and nothing else
//   * every call is one audit row (actor whatsapp-bot:<key id>, no phone number, message text or key); these rows stay
//     out of Recent changes
//   * limits per key and per phone (3.6); every error is { error: { code, message } } (3.7)
import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalisePhone } from "@plantops/module-kit/phone";
import { productLabel } from "@plantops/module-kit";
import type { NotificationInput, TenantSku } from "@plantops/types";
import { formatRef } from "@/lib/ref";
import { latestConsent, recordConsent } from "./consent";
import { findByPhone } from "./customers";
import { saveOrder, savedView, type OrderBy, type SavedOrder } from "./orders";
import { schema, withTenant, type OcTx } from "./db";
import { env } from "./env";
import { clientIp, HttpError, rateLimit, readBody } from "./http";
import { kit } from "./kit";
import { newOrderNotification } from "./notify";
import { effectiveRates } from "./rates";

const { orders, orderLines } = schema;

/** The name a bot order carries as "Entered by" (list, order page, CSV, notification). */
export const BOT_NAME = "WhatsApp";
const botBy = (key: BotKey): OrderBy => ({ userId: key.id, name: BOT_NAME });

// ---------- keys ----------
const KeyEntry = z
  .object({
    id: z.uuid(),
    tenant_id: z.uuid(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    label: z.string().min(1).max(80),
    /** the PlantOps sku_codes this bot may show (contract 3.1a); exact codes, never a prefix */
    products: z.array(z.string().min(1).max(40)).min(1).max(50),
  })
  .strict();
export type BotKey = z.infer<typeof KeyEntry>;

/** "ocb_" + 32 random bytes in base64url (43 characters). */
export const BOT_KEY_RE = /^ocb_[A-Za-z0-9_-]{43}$/;
export const hashBotKey = (key: string) => createHash("sha256").update(key).digest("hex");

let parsedFrom: string | null = null;
let parsed: BotKey[] = [];
/** The configured keys. A broken ORDER_BOT_KEYS switches the bot API off (logged), never half on. */
export function botKeys(): BotKey[] {
  const raw = env.botKeys;
  if (raw === parsedFrom) return parsed;
  parsedFrom = raw;
  parsed = [];
  if (!raw.trim()) return parsed;
  try {
    const keys = z.array(KeyEntry).parse(JSON.parse(raw));
    if (new Set(keys.map((k) => k.id)).size !== keys.length) throw new Error("two entries share an id");
    parsed = keys;
  } catch (err) {
    console.error("[order-capture] ORDER_BOT_KEYS is not valid, so the WhatsApp bot API is off:", (err as Error).message);
  }
  return parsed;
}

/** Orders entered by a bot carry the key id as entered_by (Step 3); such an order has no staff "taker". */
const isBotId = (userId: string) => botKeys().some((k) => k.id === userId);

// ---------- errors (contract 3.7) ----------
export type BotCode =
  | "bad_request"
  | "bad_phone"
  | "bad_lines"
  | "unauthorized"
  | "ordering_off"
  | "module_off"
  | "not_found"
  | "customer_mismatch"
  | "customer_off"
  | "product_unavailable"
  | "rate_limited"
  | "unavailable";

export class BotError extends Error {
  constructor(
    public status: number,
    public code: BotCode,
    message: string,
  ) {
    super(message);
  }
}

const WINDOW_MS = 60_000;
/** A per-minute limit; over it = 429 rate_limited. */
function limit(key: string, max: number) {
  try {
    rateLimit(key, max, WINDOW_MS);
  } catch (err) {
    if (err instanceof HttpError) throw new BotError(429, "rate_limited", "Too many requests; try again in a minute");
    throw err;
  }
}

function errorResponse(e: BotError) {
  const headers = e.status === 429 ? { "retry-after": "60" } : undefined;
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers });
}

/** Which key sent this. Unknown / missing / removed key = 401; more than 10 failures a minute from one address = 429. */
export function authenticate(req: Request): BotKey {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "");
  const given = m && BOT_KEY_RE.test(m[1]!) ? Buffer.from(hashBotKey(m[1]!), "hex") : null;
  const key = given ? botKeys().find((k) => timingSafeEqual(Buffer.from(k.sha256, "hex"), given)) : undefined;
  if (key) return key;
  limit(`bot-auth:${clientIp(req)}`, 10);
  throw new BotError(401, "unauthorized", "Unknown or missing bot key");
}

const BODY_MAX = 8 * 1024;

/**
 * Wraps a bot route: key, JSON body (≤ 8 KB, strict schema), plant has Order Capture switched on. Anything unexpected
 * (database, platform) is logged and answered 503 `unavailable`, which the bot treats like a timeout.
 */
export function botRoute<T extends z.ZodType>(schema: T, fn: (key: BotKey, input: z.infer<T>) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const key = authenticate(req);
      if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new BotError(400, "bad_request", "Expected a JSON request");
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, BODY_MAX, "too big")).toString("utf8"));
      } catch {
        throw new BotError(400, "bad_request", "The body must be JSON of at most 8 KB");
      }
      const input = schema.safeParse(body);
      if (!input.success) {
        const issue = input.error.issues[0];
        throw new BotError(400, issue?.path[0] === "lines" ? "bad_lines" : "bad_request", issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request");
      }
      await checkPlant(key);
      return await fn(key, input.data);
    } catch (err) {
      return caught(err);
    }
  };
}

/** A bot GET (no body): key and plant checked like botRoute. */
export function botGet<P>(fn: (key: BotKey, params: P) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const key = authenticate(req);
      await checkPlant(key);
      return await fn(key, await ctx.params);
    } catch (err) {
      return caught(err);
    }
  };
}

function caught(err: unknown) {
  if (err instanceof BotError) return errorResponse(err);
  console.error("[order-capture] bot API:", err);
  return errorResponse(new BotError(503, "unavailable", "Order Capture can't answer right now; try again later"));
}

/** The key's plant must have Order Capture switched on (its plan, read through the platform). */
async function checkPlant(key: BotKey) {
  const plan = await kit.plan(key.tenant_id);
  if (!plan) throw new BotError(503, "unavailable", "The plant's plan can't be read right now");
  if (!plan.enabled_modules.includes("order_capture")) throw new BotError(403, "module_off", "Order Capture is switched off for this plant");
}

async function botAudit(tx: OcTx, key: BotKey, action: string, target: string | null, details: Record<string, unknown>) {
  await tx.insert(schema.auditLog).values({ tenantId: key.tenant_id, actor: `whatsapp-bot:${key.id}`, action, target, details: { by: "WhatsApp", ...details } });
}

function phoneOf(typed: string) {
  const phone = normalisePhone(typed);
  if (!phone) throw new BotError(400, "bad_phone", "Expected a 10-digit Indian mobile number");
  return phone;
}

// ---------- (a) customer + product context (contract 3.2) ----------
export const ContextInput = z.object({ phone: z.string().max(20) }).strict();

export interface BotProduct {
  sku_id: string;
  code: string;
  label: string;
  unit: string;
}
export type ContextAnswer =
  | { customer: null; reason: "not_found" | "switched_off" }
  | {
      customer: { id: string; name: string; place: string };
      products: BotProduct[];
      support: { phone: string; hours: string | null } | null;
      last_delivered: { ref: string; delivered_on: string; lines: { sku_id: string; quantity: number }[] } | null;
      has_pending_order: boolean;
      areas: null;
      /** reorder reminders: the newest answer and its India day (null = never asked) */
      reminders: "granted" | "declined" | "withdrawn" | null;
      reminders_on: string | null;
    };

/** The plant's active products whose code is on the key's list, in PlantOps order. None = 503 (the bot falls back). */
async function keyProducts(key: BotKey): Promise<TenantSku[]> {
  const listed = new Set(key.products);
  const found = (await kit.products(key.tenant_id)).filter((p) => p.status === "active" && p.sku_code !== null && listed.has(p.sku_code));
  if (!found.length) throw new BotError(503, "unavailable", "No products to offer right now");
  return found;
}

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export async function botContext(key: BotKey, input: z.infer<typeof ContextInput>): Promise<ContextAnswer> {
  limit(`bot-context:${key.id}`, 60);
  const phone = phoneOf(input.phone);
  limit(`bot-context:${key.id}:${phone}`, 10);
  const products = await keyProducts(key);
  const branding = await kit.branding(key.tenant_id);
  return withTenant(key.tenant_id, async (tx) => {
    const c = await findByPhone(tx, key.tenant_id, phone);
    if (!c || !c.active) {
      const reason = c ? "switched_off" : "not_found";
      await botAudit(tx, key, "bot.context", c?.id ?? null, { result: reason });
      return { customer: null, reason };
    }
    const units = new Map((await effectiveRates(tx, key.tenant_id, products)).map((r) => [r.sku_id, r.unit]));
    const shown = new Set(products.map((p) => p.id));

    const [last] = await tx
      .select({ id: orders.id, refNo: orders.refNo, version: orders.version, deliveredAt: orders.deliveredAt, changedAt: orders.statusChangedAt })
      .from(orders)
      .where(and(eq(orders.tenantId, key.tenant_id), eq(orders.customerId, c.id), eq(orders.status, "delivered")))
      .orderBy(desc(sql`coalesce(${orders.deliveredAt}, ${orders.statusChangedAt})`), desc(orders.refNo))
      .limit(1);
    let lastDelivered: Extract<ContextAnswer, { customer: object }>["last_delivered"] = null;
    if (last) {
      const lines = (
        await tx
          .select({ sku_id: orderLines.skuId, quantity: orderLines.quantity })
          .from(orderLines)
          .where(and(eq(orderLines.tenantId, key.tenant_id), eq(orderLines.orderId, last.id), eq(orderLines.version, last.version)))
          .orderBy(orderLines.lineNo)
      ).filter((l) => shown.has(l.sku_id));
      // nothing left the bot can offer (every product switched off or not on the key's list): no "repeat"
      if (lines.length) lastDelivered = { ref: formatRef(last.refNo), delivered_on: istDay(last.deliveredAt ?? last.changedAt), lines };
    }
    const [pending] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, key.tenant_id), eq(orders.customerId, c.id), eq(orders.status, "pending")))
      .limit(1);

    const consent = await latestConsent(tx, key.tenant_id, c.id);
    await botAudit(tx, key, "bot.context", c.id, { result: "ok", last_delivered: lastDelivered?.ref ?? null });
    return {
      customer: { id: c.id, name: c.name, place: c.place },
      products: products.map((p) => ({ sku_id: p.id, code: p.sku_code!, label: productLabel(p), unit: units.get(p.id)! })),
      support: branding?.support_phone ? { phone: branding.support_phone, hours: branding.support_hours ?? null } : null,
      last_delivered: lastDelivered,
      has_pending_order: !!pending,
      areas: null,
      reminders: consent?.status ?? null,
      reminders_on: consent ? istDay(consent.at) : null,
    };
  });
}

// ---------- alerts: "Not great" feedback and "talk to a person" (contract 3.11) ----------
export const AlertInput = z
  .object({
    kind: z.enum(["feedback_not_great", "handoff"]),
    phone: z.string().max(20),
    feedback_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    comment: z.string().max(300).nullable().optional(),
  })
  .strict()
  .refine((a) => a.kind !== "feedback_not_great" || !!a.feedback_id, { message: "feedback_id is required for feedback_not_great", path: ["feedback_id"] });

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * What to send for one alert. Recipients: the plant's owners (always, through the platform) + the person who entered
 * the customer's newest non-cancelled order (re-checked by the platform: active, works in Order Capture); nobody extra
 * when that order came from the bot or the phone is not a customer. The customer's number is never in it: a known
 * customer is named, an unknown one shows the last 4 digits only.
 */
export async function botAlert(key: BotKey, input: z.infer<typeof AlertInput>, now = new Date()): Promise<NotificationInput> {
  limit(`bot-alert:${key.id}`, 10);
  const phone = phoneOf(input.phone);
  return withTenant(key.tenant_id, async (tx) => {
    const c = await findByPhone(tx, key.tenant_id, phone);
    const [last] = c
      ? await tx
          .select({ id: orders.id, refNo: orders.refNo, enteredBy: orders.enteredBy })
          .from(orders)
          .where(and(eq(orders.tenantId, key.tenant_id), eq(orders.customerId, c.id), sql`${orders.status} <> 'cancelled'`))
          .orderBy(desc(orders.createdAt), desc(orders.refNo))
          .limit(1)
      : [];
    const taker = last && !isBotId(last.enteredBy) ? last.enteredBy : null;
    await botAudit(tx, key, "bot.alert", c?.id ?? null, { kind: input.kind, customer: c ? "known" : "unknown", to_taker: !!taker });

    const who = c ? `${c.name}, ${c.place}` : null;
    const ending = `number ending ${phone.slice(-4)}`;
    const lastText = last ? ` Last order ${formatRef(last.refNo)}.` : "";
    const link = last ? `/o/${last.id}` : c ? `/customers?q=${encodeURIComponent(c.name)}` : "/";
    const comment = input.comment ? ` Comment: ${oneLine(input.comment)}` : "";
    const base = { link, level: "push" as const, ...(taker ? { also_user_ids: [taker] } : {}) };
    if (input.kind === "feedback_not_great") {
      return {
        ...base,
        kind: "order_capture.feedback_low",
        title: clip(who ? `Unhappy customer: ${who}` : "Unhappy customer on WhatsApp", 80),
        body: clip(oneLine(who ? `Rated 'Not great' on WhatsApp.${lastText}${comment}` : `Rated 'Not great' on WhatsApp (${ending}).${comment}`), 300),
        dedupe_key: `feedback:${input.feedback_id}`,
      };
    }
    // at most one per customer (or unknown number) per hour; the number itself is not kept in the key
    const whoKey = c?.id ?? createHash("sha256").update(`${key.tenant_id}:${phone}`).digest("hex").slice(0, 16);
    return {
      ...base,
      kind: "order_capture.handoff",
      title: clip(who ? `Wants to talk: ${who}` : "WhatsApp customer asks for a person", 80),
      body: clip(
        oneLine(
          who
            ? `Asked for a person on WhatsApp. Please call them.${lastText}`
            : `Asked for a person on WhatsApp (${ending}). Not in the customer list: the full number is in the bot's Sessions_Log.`,
        ),
        300,
      ),
      dedupe_key: `handoff:${whoKey}:${now.toISOString().slice(0, 13)}`,
    };
  });
}

// ---------- (b) a confirmed order (contract 3.3) and (3.4) the order by key ----------
/** Boxes per product on one WhatsApp order (owner, 2026-10-20); more goes to staff. */
export const BOT_QTY_MAX = 200;
export const DELIVERY_NOTE_MAX = 200;
const IDEMPOTENCY_RE = /^wa_[0-9a-f]{32}$/;

export const OrderCreateInput = z
  .object({
    idempotency_key: z.string().regex(IDEMPOTENCY_RE, "expected wa_ + 32 hex characters"),
    phone: z.string().max(20),
    customer_id: z.uuid(),
    lines: z
      .array(z.object({ sku_id: z.uuid(), quantity: z.number().int().min(1).max(BOT_QTY_MAX) }).strict())
      .min(1)
      .max(50)
      .refine((ls) => new Set(ls.map((l) => l.sku_id)).size === ls.length, "each product at most once"),
    delivery_note: z.string().max(DELIVERY_NOTE_MAX).nullable().optional(),
    /** the area list comes after the pilot (owner, 2026-10-23); until then only null */
    area_id: z.null().optional(),
    confirmed_at: z.iso.datetime({ offset: true }).optional(),
    confirmation: z.object({ message_sid: z.string().regex(/^[A-Za-z0-9]{1,64}$/), word: z.string().max(20) }).strict(),
  })
  .strict();

export interface BotOrderAnswer {
  created: boolean;
  order: { ref: string; status: string; lines: { sku_id: string; label: string; unit: string; quantity: number }[] };
}
/** No rates or totals, so the bot can never show one by mistake. */
const answer = (o: SavedOrder): BotOrderAnswer => ({
  created: o.created,
  order: { ref: o.ref, status: o.status, lines: o.lines.map((l) => ({ sku_id: l.sku_id, label: l.product, unit: l.unit, quantity: l.quantity })) },
});

/** The order note of a bot order: staff see where it came from, that the price is still open, and the landmark. */
export function botOrderNote(deliveryNote: string | null | undefined) {
  const where = oneLine(deliveryNote ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  return `WhatsApp order. Price to agree by phone.${where ? ` Deliver to: ${where}` : ""}`;
}

/**
 * Save a confirmed WhatsApp order. Same key again (a retry, a duplicate webhook, two calls at once) = the same order,
 * `created: false`, nothing new told to anyone. The customer and product checks run only for a new order, inside the
 * save's transaction, so a retry still finds an order whose customer was switched off since.
 */
export async function botCreateOrder(key: BotKey, input: z.infer<typeof OrderCreateInput>): Promise<{ order: SavedOrder; answer: BotOrderAnswer }> {
  limit(`bot-order:${key.id}`, 20);
  if (env.botOrdersOff) throw new BotError(403, "ordering_off", "Ordering on WhatsApp is switched off; a person will call");
  const phone = phoneOf(input.phone);
  limit(`bot-order:${key.id}:${phone}`, 3);
  const products = await keyProducts(key);
  const offered = new Set(products.map((p) => p.id));
  const rates = new Map((await withTenant(key.tenant_id, (tx) => effectiveRates(tx, key.tenant_id, products))).map((r) => [r.sku_id, r.default_rate]));

  const order = await saveOrder({
    tenantId: key.tenant_id,
    by: botBy(key),
    requestKey: input.idempotency_key,
    products,
    lines: input.lines.map((l) => ({ sku_id: l.sku_id, quantity: l.quantity, rate: offered.has(l.sku_id) ? (rates.get(l.sku_id) ?? "0") : "0" })),
    note: botOrderNote(input.delivery_note),
    customer: async (tx) => {
      for (const l of input.lines) if (!offered.has(l.sku_id)) throw new BotError(409, "product_unavailable", "A product is not available on WhatsApp right now");
      const c = await findByPhone(tx, key.tenant_id, phone);
      if (!c || c.id !== input.customer_id) throw new BotError(409, "customer_mismatch", "This phone and customer don't belong together");
      if (!c.active) throw new BotError(409, "customer_off", "This customer is switched off");
      return c;
    },
    repeat: async (_tx, enteredBy) => {
      if (enteredBy !== key.id) throw new BotError(400, "bad_request", "This idempotency key belongs to another order");
    },
    saved: (tx, o) =>
      botAudit(tx, key, "bot.order", o.id, { ref: o.ref, customer: o.customer.name, place: o.customer.place, lines: o.lines.length, message_sid: input.confirmation.message_sid, word: input.confirmation.word }),
  });
  if (!order.created) await withTenant(key.tenant_id, (tx) => botAudit(tx, key, "bot.order_repeat", order.id, { ref: order.ref }));
  return { order, answer: answer(order) };
}

export const notifyBotOrder = (key: BotKey, order: SavedOrder) => newOrderNotification(botBy(key), order);

/** After a timeout: did my create go through? Only orders made with this key are found. */
export async function botOrderByKey(key: BotKey, idempotencyKey: string): Promise<BotOrderAnswer> {
  limit(`bot-by-key:${key.id}`, 60);
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new BotError(400, "bad_request", "expected wa_ + 32 hex characters");
  return withTenant(key.tenant_id, async (tx) => {
    const [o] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, key.tenant_id), eq(orders.requestKey, idempotencyKey), eq(orders.enteredBy, key.id)));
    await botAudit(tx, key, "bot.by_key", o?.id ?? null, { result: o ? "found" : "not_found" });
    if (!o) throw new BotError(404, "not_found", "No order with this key");
    return answer(await savedView(tx, key.tenant_id, o.id, false));
  });
}

// ---------- reorder reminders: the customer's answer (Step 4, contract 4.8) ----------
/** Which answers each source may give: the question after an order (yes / no), STOP and the button (stop), START. */
const SOURCE_STATUS = {
  bot_after_order: ["granted", "declined"],
  whatsapp_stop: ["withdrawn"],
  reminder_button: ["withdrawn"],
  whatsapp_start: ["granted"],
} as const;

export const ConsentInput = z
  .object({
    phone: z.string().max(20),
    status: z.enum(["granted", "declined", "withdrawn"]),
    source: z.enum(["bot_after_order", "whatsapp_stop", "reminder_button", "whatsapp_start"]),
    message_sid: z.string().regex(/^[A-Za-z0-9]{1,64}$/).optional(),
  })
  .strict()
  .refine((c) => (SOURCE_STATUS[c.source] as readonly string[]).includes(c.status), { message: "this source can't give this answer", path: ["status"] });

/**
 * Record a customer's answer. Only for a customer of this plant (an unknown number: `recorded: false`). A yes needs
 * the customer switched on; a stop is always kept. START only brings back reminders that STOP (or the button) ended,
 * never a first yes. The same answer twice writes nothing.
 */
export async function botConsent(key: BotKey, input: z.infer<typeof ConsentInput>) {
  limit(`bot-consent:${key.id}`, 20);
  const phone = phoneOf(input.phone);
  limit(`bot-consent:${key.id}:${phone}`, 5);
  return withTenant(key.tenant_id, async (tx) => {
    const c = await findByPhone(tx, key.tenant_id, phone);
    if (!c) {
      await botAudit(tx, key, "bot.consent", null, { result: "not_found", source: input.source });
      return { recorded: false, reason: "not_found" as const, reminders: null };
    }
    const now = await latestConsent(tx, key.tenant_id, c.id);
    let recorded = false;
    let reason: string | null = null;
    if (input.status === "granted" && !c.active) reason = "switched_off";
    else if (input.source === "whatsapp_start" && !(now?.status === "withdrawn" && now.source !== "staff_phone")) reason = "nothing_to_restart";
    else recorded = await recordConsent(tx, key.tenant_id, c.id, { status: input.status, source: input.source, by: botBy(key), messageSid: input.message_sid ?? null });
    await botAudit(tx, key, "bot.consent", c.id, { result: recorded ? "recorded" : (reason ?? "unchanged"), status: input.status, source: input.source, message_sid: input.message_sid ?? null });
    return { recorded, reason, reminders: (await latestConsent(tx, key.tenant_id, c.id))?.status ?? null };
  });
}


// Drop points on the server (docs/CUSTOMER_APP_PHASE_PLAN.md "Points tab", Phase 3; rules: src/lib/points.ts). Points
// are completely separate from billing (owner, 2026-11-09): nothing here writes to orders, order lines or bills. A free
// box asked with points is a row of its own, linked to the order it goes on; its state comes from that order.
//   * staff: the settings (owner), the free boxes asked (owner + Order desk: add to an order, cancel with a reason),
//     a shop's balance on its Drop card
//   * the app: a shop's points (balance, rewards, record) and asking for a free box
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { NotificationInput, TenantSku } from "@plantops/types";
import { sizeLabel } from "@/lib/brand";
import { paise, rupees } from "@/lib/ledger";
import {
  canUse,
  mainValue,
  nextReward,
  pointsSummary,
  purchasePoints,
  redeemOpen,
  redeemOpensOn,
  requestState,
  settingOn,
  startDateOf,
  WHY_NOT_TEXT,
  yearEndOf,
  type PointsRequest,
  type PointsSetting,
  type PointsSummary,
} from "@/lib/points";
import { formatRef } from "@/lib/ref";
import { can, requireAccess } from "../access";
import { audit } from "../audit";
import { schema, withTenant, type OcTx } from "../db";
import { badRequest, conflict, notFound } from "../http";
import { kit } from "../kit";
import { istToday } from "../ledger";
import { activeProducts } from "../rates";
import type { OcUser } from "../session";
import { DropError } from "./api";
import { dropAppOfPlant } from "./config";
import { productMatcher } from "./products";
import type { AppSession } from "./session";

const { billLines, bills, customers, orders, paymentAllocations, payments, pointsRedemptions, pointsSettings } = schema;

const IST = "Asia/Kolkata";
const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const P = (s: string) => paise(s);

// ---------- settings ----------

export async function settingsRows(tx: OcTx, tenantId: string): Promise<PointsSetting[]> {
  const rows = await tx.select().from(pointsSettings).where(eq(pointsSettings.tenantId, tenantId)).orderBy(asc(pointsSettings.effectiveFrom), asc(pointsSettings.createdAt));
  return rows.map((r) => ({
    effective_from: r.effectiveFrom,
    start_date: r.startDate,
    rupees_per_point: P(r.rupeesPerPoint),
    late_days: r.lateDays,
    poll_points: r.pollPoints,
    redeem_months: r.redeemMonths,
    rewards: r.rewards,
  }));
}

/** Offered on a plant's first settings: the main brand's 1 L / 500 ml / 250 ml products (owner, 2026-11-09). */
const FIRST_POINTS: Record<number, number> = { 1000: 800, 500: 1250, 250: 1250 };

export async function pointsSettingsView(user: OcUser) {
  requireAccess(user, "drop_points_view");
  const products = await activeProducts(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const { products: branded } = await productMatcher(tx, user.tenantId, products);
    const main = dropAppOfPlant(user.tenantId)?.brand ?? null;
    const history = await tx.select().from(pointsSettings).where(eq(pointsSettings.tenantId, user.tenantId)).orderBy(desc(pointsSettings.createdAt));
    const today = istToday();
    const rows = await settingsRows(tx, user.tenantId);
    const now = settingOn(rows, today) ?? rows[0] ?? null;
    const suggested = branded
      .filter((p) => main && p.brand.toLowerCase() === main.toLowerCase() && FIRST_POINTS[p.volume_ml])
      .sort((a, b) => b.volume_ml - a.volume_ml)
      .map((p) => ({ sku_id: p.id, label: p.name, points: FIRST_POINTS[p.volume_ml]! }));
    return {
      main_brand: main,
      today,
      current: now
        ? { ...now, rupees_per_point: rupees(now.rupees_per_point), start_date: startDateOf(rows) }
        : { effective_from: today, start_date: null, rupees_per_point: "20.00", late_days: 5, poll_points: 10, redeem_months: [7, 8, 9, 10, 11, 12, 1], rewards: suggested },
      products: branded.map((p) => ({ id: p.id, name: p.name, brand: p.brand, size: sizeLabel(p.volume_ml) })),
      history: history.map((h) => ({
        at: h.createdAt.toISOString(),
        by: h.changedByName,
        effective_from: h.effectiveFrom,
        start_date: h.startDate,
        rupees_per_point: h.rupeesPerPoint,
        late_days: h.lateDays,
        poll_points: h.pollPoints,
        redeem_months: h.redeemMonths,
        rewards: h.rewards,
      })),
    };
  });
}

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date like 2026-12-01");
export const PointsSettingsInput = z.object({
  effective_from: YMD,
  start_date: YMD.nullable(),
  rupees_per_point: z.string().trim().regex(/^\d{1,5}(\.\d{1,2})?$/, "₹ per point: a number like 20 or 25.50"),
  late_days: z.number().int().min(0).max(60),
  poll_points: z.number().int().min(0).max(1000),
  redeem_months: z.array(z.number().int().min(1).max(12)).max(12),
  rewards: z.array(z.object({ sku_id: z.uuid(), points: z.number().int().min(1).max(1_000_000) })).max(10),
});

/** Owner: a new settings row (the history keeps every earlier one). It applies from its date, never to earlier days. */
export async function savePointsSettings(user: OcUser, input: z.infer<typeof PointsSettingsInput>) {
  requireAccess(user, "drop_points_settings");
  const today = istToday();
  if (input.effective_from < today) throw badRequest("A change applies from today or a later day, never to past days.");
  if (P(input.rupees_per_point) <= 0n) throw badRequest("₹ per point must be more than 0.");
  if (new Set(input.rewards.map((r) => r.sku_id)).size !== input.rewards.length) throw badRequest("Each product can be a free box only once.");
  const products = new Map((await activeProducts(user.tenantId)).map((p) => [p.id, p]));
  const rewards = input.rewards.map((r) => {
    const p = products.get(r.sku_id);
    if (!p) throw badRequest("One of the free boxes is not an active product. Reload the page and try again.");
    return { sku_id: r.sku_id, label: p.name, points: r.points };
  });
  const months = [...new Set(input.redeem_months)];
  return withTenant(user.tenantId, async (tx) => {
    await tx.insert(pointsSettings).values({
      tenantId: user.tenantId,
      effectiveFrom: input.effective_from,
      startDate: input.start_date,
      rupeesPerPoint: input.rupees_per_point,
      lateDays: input.late_days,
      pollPoints: input.poll_points,
      redeemMonths: months,
      rewards,
      changedBy: user.userId,
      changedByName: user.name,
    });
    await audit(tx, user, "drop.points_settings", null, {
      effective_from: input.effective_from,
      start_date: input.start_date,
      rupees_per_point: input.rupees_per_point,
      late_days: input.late_days,
      poll_points: input.poll_points,
      redeem_months: months,
      rewards: rewards.map((r) => `${r.label} ${r.points}`),
    });
    return { ok: true };
  });
}

// ---------- a shop's points ----------

/** Everything the points rules need for one shop, read in the caller's transaction. */
async function shopFacts(tx: OcTx, tenantId: string, customerId: string, skus: TenantSku[]) {
  const settings = await settingsRows(tx, tenantId);
  const requestRows = await tx
    .select({ r: pointsRedemptions, orderStatus: orders.status })
    .from(pointsRedemptions)
    .leftJoin(orders, and(eq(orders.tenantId, pointsRedemptions.tenantId), eq(orders.id, pointsRedemptions.orderId)))
    .where(and(eq(pointsRedemptions.tenantId, tenantId), eq(pointsRedemptions.customerId, customerId)))
    .orderBy(desc(pointsRedemptions.createdAt));
  const requests: (PointsRequest & { sku_id: string; order_id: string | null })[] = requestRows.map(({ r, orderStatus }) => ({
    id: r.id,
    sku_id: r.skuId,
    label: r.label,
    points: r.points,
    year_end: r.yearEnd,
    asked_on: istDate(r.createdAt),
    order_id: r.orderId,
    state: requestState({ cancelled: !!r.cancelledAt, order_status: orderStatus }),
  }));
  const start = startDateOf(settings);
  if (!start) return { settings, requests, earned: [] as { on: string; hundredths: bigint }[] };

  // PlantOps bills of this shop from the start date (Zoho bills never earn), their lines, payments and orders
  const bs = await tx
    .select()
    .from(bills)
    .where(and(eq(bills.tenantId, tenantId), eq(bills.customerId, customerId), eq(bills.source, "plantops"), sql`${bills.billDate} >= ${start}::date`));
  if (!bs.length) return { settings, requests, earned: [] };
  const ids = bs.map((b) => b.id);
  const ls = await tx.select().from(billLines).where(and(eq(billLines.tenantId, tenantId), inArray(billLines.billId, ids)));
  const al = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.tenantId, tenantId), inArray(paymentAllocations.billId, ids)));
  const ps = al.length ? await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), inArray(payments.id, [...new Set(al.map((a) => a.paymentId))]))) : [];
  const orderIds = bs.map((b) => b.orderId).filter(Boolean) as string[];
  const os = orderIds.length ? await tx.select({ id: orders.id, status: orders.status, deliveredAt: orders.deliveredAt }).from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds))) : [];
  const deliveredOn = new Map(os.filter((o) => o.status === "delivered" && o.deliveredAt).map((o) => [o.id, istDate(o.deliveredAt!)]));
  const { of } = await productMatcher(tx, tenantId, skus);
  const main = dropAppOfPlant(tenantId)?.brand ?? "";
  const earned = purchasePoints(
    bs.map((b) => ({
      id: b.id,
      source: b.source,
      bill_date: b.billDate,
      delivered_on: b.orderId ? (deliveredOn.get(b.orderId) ?? null) : null,
      total: P(b.total),
      cancelled: !!b.cancelledAt,
      main_value: mainValue(
        ls.filter((l) => l.billId === b.id).map((l) => ({ brand: of({ sku_id: l.skuId, sku_code: l.skuCode, name: l.itemName })?.brand ?? "", line_total: l.lineTotal, taxable: l.taxable, free: l.free })),
        P(b.subTotal),
        P(b.discount),
        main,
      ),
    })),
    ps.map((p) => ({ id: p.id, payment_date: p.paymentDate, cancelled: !!p.cancelledAt })),
    al.map((a) => ({ payment_id: a.paymentId, bill_id: a.billId, amount: P(a.amount), allocated_on: a.allocatedOn })),
    settings,
  );
  return { settings, requests, earned };
}

export type ShopPoints = { summary: PointsSummary; setting: PointsSetting | null; requests: Awaited<ReturnType<typeof shopFacts>>["requests"] };

export async function shopPoints(tx: OcTx, tenantId: string, customerId: string, skus: TenantSku[], today = istToday()): Promise<ShopPoints> {
  const f = await shopFacts(tx, tenantId, customerId, skus);
  // poll points: decided when each answer was saved (src/server/drop/polls.ts), kept on the answer
  const answers = await tx
    .select({ points: schema.pollAnswers.points, at: schema.pollAnswers.createdAt })
    .from(schema.pollAnswers)
    .where(and(eq(schema.pollAnswers.tenantId, tenantId), eq(schema.pollAnswers.customerId, customerId), sql`${schema.pollAnswers.points} > 0`));
  const polls = answers.map((a) => ({ on: istDate(a.at), points: a.points }));
  const summary = pointsSummary({ earned: f.earned, polls, requests: f.requests, settings: f.settings, today });
  return { summary, setting: settingOn(f.settings, today), requests: f.requests };
}

/** Staff: a shop's balance for its Drop card (owner + Order desk; support reads). */
export async function cardPoints(user: OcUser, customerId: string) {
  requireAccess(user, "drop_rewards_view");
  const skus = await kit.products(user.tenantId);
  return withTenant(user.tenantId, async (tx) => {
    const p = await shopPoints(tx, user.tenantId, customerId, skus);
    return { on: p.summary.on, balance: p.summary.balance, year_end: p.summary.year_end, open_request: p.summary.open_request };
  });
}

// ---------- the app ----------

export type AppPoints = {
  on: boolean;
  balance: number;
  ends_on: string | null;
  redeem_open: boolean;
  opens_on: string | null;
  rewards: { id: string; label: string; size: string; points: number; can_use: boolean; why_not: string | null }[];
  open_request: { label: string; state: string } | null;
  record: PointsSummary["record"];
};

function appView(p: ShopPoints, skus: TenantSku[], today: string): AppPoints {
  const size = new Map(skus.map((s) => [s.id, sizeLabel(s.volume_ml)]));
  const rewards = p.setting?.rewards ?? [];
  return {
    on: p.summary.on,
    balance: Math.max(0, p.summary.balance),
    ends_on: p.summary.year_end,
    redeem_open: redeemOpen(p.setting, today),
    opens_on: redeemOpen(p.setting, today) ? null : redeemOpensOn(p.setting, today),
    rewards: rewards.map((r) => {
      const why = canUse(p.summary, p.setting, r, today);
      return { id: r.sku_id, label: r.label, size: size.get(r.sku_id) ?? "", points: r.points, can_use: why === null, why_not: why ? WHY_NOT_TEXT[why] : null };
    }),
    open_request: p.summary.open_request ? { label: p.summary.open_request.label, state: p.summary.open_request.state } : null,
    record: p.summary.record,
  };
}

export async function appPoints(s: AppSession, now = new Date()): Promise<AppPoints> {
  const today = istDate(now);
  const skus = await kit.products(s.app.tenantId);
  return withTenant(s.app.tenantId, async (tx) => appView(await shopPoints(tx, s.app.tenantId, s.customerId, skus, today), skus, today));
}

/** Home's line: the balance and how far to the cheapest free box (null while points are off). */
export async function homePoints(tx: OcTx, s: AppSession, skus: TenantSku[], today: string) {
  const p = await shopPoints(tx, s.app.tenantId, s.customerId, skus, today);
  if (!p.summary.on) return null;
  return { balance: Math.max(0, p.summary.balance), next: nextReward(p.summary, p.setting?.rewards ?? []) };
}

export const RedeemInput = z.object({ reward: z.uuid(), request_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });

/** The app: ask for a free box. Points are held at once; one request at a time; a repeated key = the same request. */
export async function redeem(s: AppSession, input: z.infer<typeof RedeemInput>, now = new Date()) {
  const t = s.app.tenantId;
  const today = istDate(now);
  const skus = await kit.products(t);
  return withTenant(t, async (tx) => {
    // one ask at a time per shop
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('order_capture.redeem'), hashtext(${s.customerId}))`);
    const [again] = await tx.select().from(pointsRedemptions).where(and(eq(pointsRedemptions.tenantId, t), eq(pointsRedemptions.requestKey, input.request_key)));
    const p = await shopPoints(tx, t, s.customerId, skus, today);
    if (again) {
      if (again.customerId !== s.customerId) throw new DropError(409, "not_allowed", "Please try again");
      return { created: false, view: appView(p, skus, today), id: again.id, label: again.label, points: again.points };
    }
    const reward = (p.setting?.rewards ?? []).find((r) => r.sku_id === input.reward);
    if (!reward) throw new DropError(404, "not_offered", "This free box is not offered");
    const why = canUse(p.summary, p.setting, reward, today);
    if (why) throw new DropError(409, "not_allowed", WHY_NOT_TEXT[why]);
    const [row] = await tx
      .insert(pointsRedemptions)
      .values({
        tenantId: t,
        customerId: s.customerId,
        skuId: reward.sku_id,
        label: reward.label,
        points: reward.points,
        yearEnd: yearEndOf(today, p.summary.start_date!),
        askedByPhone: s.phone,
        requestKey: input.request_key,
      })
      .returning();
    const after = await shopPoints(tx, t, s.customerId, skus, today);
    return { created: true, view: appView(after, skus, today), id: row!.id, label: row!.label, points: row!.points };
  });
}

/** Owners + ticked Order desk: a shop asked for a free box. */
export function redeemNotification(shop: string, label: string, points: number, id: string): NotificationInput {
  return {
    kind: "order_capture.drop_redeem",
    title: `Free box asked: ${shop}`.slice(0, 80),
    body: `${label}, ${points.toLocaleString("en-IN")} points (Drop). Add it to their next order.`.slice(0, 300),
    link: "/customers/drop/rewards",
    level: "push",
    dedupe_key: `redeem:${id}`,
  };
}

// ---------- staff: free boxes asked ----------

export async function rewardsList(user: OcUser) {
  requireAccess(user, "drop_rewards_view");
  return withTenant(user.tenantId, async (tx) => {
    const rows = await tx
      .select({ r: pointsRedemptions, shop: customers.name, place: customers.place, orderStatus: orders.status, orderRef: orders.refNo })
      .from(pointsRedemptions)
      .innerJoin(customers, and(eq(customers.tenantId, pointsRedemptions.tenantId), eq(customers.id, pointsRedemptions.customerId)))
      .leftJoin(orders, and(eq(orders.tenantId, pointsRedemptions.tenantId), eq(orders.id, pointsRedemptions.orderId)))
      .where(eq(pointsRedemptions.tenantId, user.tenantId))
      .orderBy(desc(pointsRedemptions.createdAt))
      .limit(300);
    const all = rows.map(({ r, shop, place, orderStatus, orderRef }) => ({
      id: r.id,
      customer_id: r.customerId,
      shop,
      place,
      label: r.label,
      points: r.points,
      asked_at: r.createdAt.toISOString(),
      state: requestState({ cancelled: !!r.cancelledAt, order_status: orderStatus }),
      order: r.orderId ? { id: r.orderId, ref: formatRef(orderRef!) } : null,
      added_by: r.addedByName,
      cancelled_by: r.cancelledByName,
      cancel_reason: r.cancelReason,
    }));
    return { open: all.filter((x) => x.state === "asked" || x.state === "on_order"), done: all.filter((x) => x.state === "delivered" || x.state === "returned").slice(0, 50) };
  });
}

/** The shop's free box asked and not yet on an order (New order's banner, the order page's button). */
export async function askedFor(tx: OcTx, tenantId: string, customerId: string) {
  const [r] = await tx
    .select()
    .from(pointsRedemptions)
    .where(and(eq(pointsRedemptions.tenantId, tenantId), eq(pointsRedemptions.customerId, customerId), isNull(pointsRedemptions.orderId), isNull(pointsRedemptions.cancelledAt)))
    .orderBy(desc(pointsRedemptions.createdAt))
    .limit(1);
  return r ? { id: r.id, label: r.label, points: r.points } : null;
}

/** The points reward on an order (order page, list cards, WhatsApp copy). Never on its bill. */
export async function rewardsOnOrders(tx: OcTx, tenantId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, { label: string }[]>();
  const rows = await tx
    .select({ orderId: pointsRedemptions.orderId, label: pointsRedemptions.label })
    .from(pointsRedemptions)
    .where(and(eq(pointsRedemptions.tenantId, tenantId), inArray(pointsRedemptions.orderId, orderIds), isNull(pointsRedemptions.cancelledAt)));
  const out = new Map<string, { label: string }[]>();
  for (const r of rows) out.set(r.orderId!, [...(out.get(r.orderId!) ?? []), { label: r.label }]);
  return out;
}

/** Puts a free box asked on a pending order of the same shop (inside the caller's transaction). */
export async function attachReward(tx: OcTx, user: { tenantId: string; userId: string; name: string }, redemptionId: string, orderId: string) {
  const [r] = await tx.select().from(pointsRedemptions).where(and(eq(pointsRedemptions.tenantId, user.tenantId), eq(pointsRedemptions.id, redemptionId))).for("update");
  if (!r) throw notFound("This free box request was not found");
  if (r.cancelledAt) throw conflict("This free box request was cancelled.");
  if (r.orderId) throw conflict("This free box is already on an order.");
  const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, orderId)));
  if (!o) throw notFound("Order not found");
  if (o.customerId !== r.customerId) throw badRequest("This free box was asked for by another shop.");
  if (o.status !== "pending") throw conflict("A free box can go on a pending order only.");
  await tx
    .update(pointsRedemptions)
    .set({ orderId, addedBy: user.userId, addedByName: user.name, addedAt: new Date() })
    .where(and(eq(pointsRedemptions.tenantId, user.tenantId), eq(pointsRedemptions.id, redemptionId)));
  return { label: r.label, ref: formatRef(o.refNo), shop: o.customerName };
}

/** Owner / Order desk: put the shop's free box asked on this pending order. */
export async function addRewardToOrder(user: OcUser, redemptionId: string, orderId: string) {
  requireAccess(user, "drop_rewards");
  return withTenant(user.tenantId, async (tx) => {
    const done = await attachReward(tx, user, redemptionId, orderId);
    await audit(tx, user, "drop.reward_add", redemptionId, { name: done.shop, reward: done.label, order: done.ref });
    return done;
  });
}

export const CancelRewardInput = z.object({ reason: z.string().trim().min(3, "Reason: at least 3 letters").max(300) });

/** Owner / Order desk: cancel a free box asked (not delivered yet): the points go back to the shop. */
export async function cancelReward(user: OcUser, redemptionId: string, input: z.infer<typeof CancelRewardInput>) {
  requireAccess(user, "drop_rewards");
  return withTenant(user.tenantId, async (tx) => {
    // the request row locked first (two people cancelling at once), then its order and shop
    await tx.select({ id: pointsRedemptions.id }).from(pointsRedemptions).where(and(eq(pointsRedemptions.tenantId, user.tenantId), eq(pointsRedemptions.id, redemptionId))).for("update");
    const [row] = await tx
      .select({ r: pointsRedemptions, orderStatus: orders.status, shop: customers.name })
      .from(pointsRedemptions)
      .innerJoin(customers, and(eq(customers.tenantId, pointsRedemptions.tenantId), eq(customers.id, pointsRedemptions.customerId)))
      .leftJoin(orders, and(eq(orders.tenantId, pointsRedemptions.tenantId), eq(orders.id, pointsRedemptions.orderId)))
      .where(and(eq(pointsRedemptions.tenantId, user.tenantId), eq(pointsRedemptions.id, redemptionId)));
    if (!row) throw notFound("This free box request was not found");
    const state = requestState({ cancelled: !!row.r.cancelledAt, order_status: row.orderStatus });
    if (state === "delivered") throw conflict("This free box was delivered. Undo the delivery first if it was a mistake.");
    if (state === "returned") throw conflict("This free box request is already cancelled.");
    await tx
      .update(pointsRedemptions)
      .set({ cancelledAt: new Date(), cancelledBy: user.userId, cancelledByName: user.name, cancelReason: input.reason })
      .where(and(eq(pointsRedemptions.tenantId, user.tenantId), eq(pointsRedemptions.id, redemptionId)));
    await audit(tx, user, "drop.reward_cancel", redemptionId, { name: row.shop, reward: row.r.label, points: row.r.points, reason: input.reason });
    return { ok: true };
  });
}

/** The order page: the points rewards on this order, and the shop's free box asked that could be added (pending only). */
export async function orderRewards(user: OcUser, orderId: string) {
  return withTenant(user.tenantId, async (tx) => {
    const [o] = await tx.select({ customerId: orders.customerId, status: orders.status }).from(orders).where(and(eq(orders.tenantId, user.tenantId), eq(orders.id, orderId)));
    if (!o) return { on: [], asked: null };
    const on = (await rewardsOnOrders(tx, user.tenantId, [orderId])).get(orderId) ?? [];
    const asked = o.status === "pending" && can(user, "drop_rewards") ? await askedFor(tx, user.tenantId, o.customerId) : null;
    return { on, asked };
  });
}

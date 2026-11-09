// Drop pushes to shops' phones (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 6, "Notifications → To shops"):
//   * a phone signs up after login (POST /api/app/v1/devices); logout removes it; an ended or expired session gets
//     nothing (checked when a push is queued), so a switched-off shop or removed phone hears nothing more
//   * events queue one row per phone (dedupe per phone): order received / delivered (only lines of the shop's Drop
//     brands; an order with none of them pushes nothing), new poll (open, the shop's brands, not answered yet), free
//     box on an order, points ending (1 Dec and 15 Jan, shops with points)
//   * rows are sent after the action's answer and by the push job (every 5 minutes): 200 per plant per run, a growing
//     wait after a failure, given up after 3 days; Firebase saying the phone is gone removes the phone
//   * Firebase refusing the key for an hour → owners get "Drop: pushes … are failing" (bell, once a day)
// Never amounts, bills, payments or staff names in a push.
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { brandKey, sizeLabel } from "@/lib/brand";
import { nextReward, settingOn, startDateOf } from "@/lib/points";
import { orderDb, schema, withTenant, type OcTx } from "../db";
import { kit } from "../kit";
import { dropAppOfPlant, dropApps } from "./config";
import { fcmOn, sendPush } from "./fcm";
import { settingsRows, shopPoints } from "./points";
import { productMatcher } from "./products";
import type { AppSession } from "./session";
import { dropAccess } from "./shops";
import type { PushKind, PushTab } from "../schema";

const { appDevices, appPushOutbox, appSessions, orders, orderLines, pointsRedemptions, polls, pollAnswers } = schema;

const IST = "Asia/Kolkata";
const istDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const dayMonth = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

export const BATCH = 200;
const GIVE_UP_MS = 3 * 86_400_000;
const ALERT_AFTER_MS = 60 * 60_000;

export type PushItem = { kind: PushKind; dedupe: string; title: string; body: string; tab: PushTab };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- phones ----------

export const DeviceInput = z.object({ token: z.string().trim().min(20).max(4096) });

/** The app: this phone gets pushes for this login. The same token on an older row (an earlier login) is replaced. */
export async function registerDevice(s: AppSession, input: z.infer<typeof DeviceInput>, now = new Date()) {
  const t = s.app.tenantId;
  return withTenant(t, async (tx) => {
    const live = await tx.select().from(appDevices).where(and(eq(appDevices.tenantId, t), isNull(appDevices.removedAt), sql`(${appDevices.fcmToken} = ${input.token} or ${appDevices.sessionId} = ${s.sessionId})`));
    if (live.some((d) => d.fcmToken === input.token && d.sessionId === s.sessionId)) return { ok: true as const };
    if (live.length) await tx.update(appDevices).set({ removedAt: now, removeReason: "replaced" }).where(and(eq(appDevices.tenantId, t), inArray(appDevices.id, live.map((d) => d.id))));
    await tx.insert(appDevices).values({ tenantId: t, sessionId: s.sessionId, fcmToken: input.token });
    return { ok: true as const };
  });
}

/** Logout: the session's phones get nothing more (inside the logout's transaction). */
export async function removeSessionDevices(tx: OcTx, tenantId: string, sessionId: string, now = new Date()) {
  await tx.update(appDevices).set({ removedAt: now, removeReason: "logout" }).where(and(eq(appDevices.tenantId, tenantId), eq(appDevices.sessionId, sessionId), isNull(appDevices.removedAt)));
}

/** Queues one push for every live phone of the shop (a phone that already has this dedupe key is skipped). */
export async function queueToShop(tx: OcTx, tenantId: string, customerId: string, item: PushItem, now = new Date()) {
  const devices = await tx
    .select({ id: appDevices.id })
    .from(appDevices)
    .innerJoin(appSessions, and(eq(appSessions.tenantId, appDevices.tenantId), eq(appSessions.id, appDevices.sessionId)))
    .where(and(eq(appDevices.tenantId, tenantId), isNull(appDevices.removedAt), eq(appSessions.customerId, customerId), isNull(appSessions.endedAt), sql`${appSessions.expiresAt} > ${now}`));
  if (!devices.length) return 0;
  const rows = await tx
    .insert(appPushOutbox)
    .values(devices.map((d) => ({ tenantId, deviceId: d.id, kind: item.kind, dedupeKey: item.dedupe, title: clip(item.title, 80), body: clip(item.body, 300), tab: item.tab })))
    .onConflictDoNothing()
    .returning({ id: appPushOutbox.id });
  return rows.length;
}

/** The shop's Drop brands (main brand first), or null when it isn't switched on for Drop. */
async function shopBrands(tx: OcTx, tenantId: string, customerId: string) {
  const app = dropAppOfPlant(tenantId);
  if (!app) return null;
  const access = await dropAccess(tx, tenantId, customerId);
  return access.enabled ? [app.brand, ...access.brands] : null;
}

// ---------- events ----------

/** "1L × 20 box + 2 free, 500ml × 10 box": the order's current lines of the shop's brands. */
export function linesText(lines: { size: string; unit: string; qty: number; free: number }[]) {
  return lines.map((l) => `${l.size} × ${l.qty} ${l.unit}${l.free ? ` + ${l.free} free` : ""}`.replace(` × 0 ${l.unit} + `, " × ")).join(", ");
}

/** Order received / delivered for the shop (after the save's answer; never throws). */
export async function pushOrder(tenantId: string, orderId: string, what: "received" | "delivered") {
  try {
    if (!dropAppOfPlant(tenantId)) return 0;
    const skus = await kit.products(tenantId);
    const queued = await withTenant(tenantId, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
      if (!o) return 0;
      const brands = await shopBrands(tx, tenantId, o.customerId);
      if (!brands) return 0;
      const shown = new Set(brands.map(brandKey));
      const { of } = await productMatcher(tx, tenantId, skus);
      const byProduct = new Map<string, { size: string; unit: string; qty: number; free: number; no: number }>();
      const ls = await tx.select().from(orderLines).where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, o.id), eq(orderLines.version, o.version)));
      for (const l of ls.sort((a, b) => a.lineNo - b.lineNo)) {
        const p = of({ sku_id: l.skuId, name: l.productName });
        if (!p || !shown.has(brandKey(p.brand))) continue;
        const row = byProduct.get(p.id) ?? { size: sizeLabel(p.volume_ml), unit: l.unit, qty: 0, free: 0, no: l.lineNo };
        if (l.free) row.free += l.quantity;
        else row.qty += l.quantity;
        byProduct.set(p.id, row);
      }
      if (!byProduct.size) return 0;
      const text = linesText([...byProduct.values()].sort((a, b) => a.no - b.no));
      return queueToShop(tx, tenantId, o.customerId, {
        kind: what === "received" ? "order_received" : "order_delivered",
        dedupe: `order:${o.id}:${what}`,
        title: what === "received" ? "Order received" : "Order delivered",
        body: text,
        tab: "home",
      });
    });
    if (queued) await sendWaiting(tenantId);
    return queued;
  } catch (err) {
    console.error("[order-capture] Drop push (order) failed:", (err as Error).message);
    return 0;
  }
}

/** Free boxes put on this order (after the answer; never throws). */
export async function pushFreeBoxes(tenantId: string, orderId: string) {
  try {
    if (!dropAppOfPlant(tenantId)) return 0;
    const queued = await withTenant(tenantId, async (tx) => {
      const rs = await tx.select().from(pointsRedemptions).where(and(eq(pointsRedemptions.tenantId, tenantId), eq(pointsRedemptions.orderId, orderId), isNull(pointsRedemptions.cancelledAt)));
      let n = 0;
      for (const r of rs) {
        if (!(await shopBrands(tx, tenantId, r.customerId))) continue;
        n += await queueToShop(tx, tenantId, r.customerId, { kind: "free_box", dedupe: `free_box:${r.id}`, title: "Your free box is coming", body: `Your free ${r.label} comes with your next delivery.`, tab: "points" });
      }
      return n;
    });
    if (queued) await sendWaiting(tenantId);
    return queued;
  } catch (err) {
    console.error("[order-capture] Drop push (free box) failed:", (err as Error).message);
    return 0;
  }
}

/** New polls: every open poll to the live phones of shops of its brands that haven't answered it. */
export async function queuePolls(tenantId: string, now = new Date()) {
  if (!dropAppOfPlant(tenantId)) return 0;
  return withTenant(tenantId, async (tx) => {
    const open = await tx.select().from(polls).where(and(eq(polls.tenantId, tenantId), lte(polls.opensAt, now), sql`${polls.closesAt} > ${now}`, isNull(polls.closedEarlyAt)));
    if (!open.length) return 0;
    const settings = await settingsRows(tx, tenantId);
    const start = startDateOf(settings);
    const today = istDate(now);
    const pointsEach = start && today >= start ? (settingOn(settings, today)?.poll_points ?? 0) : 0;
    // shops with a live phone
    const shops = await tx
      .selectDistinct({ customerId: appSessions.customerId })
      .from(appDevices)
      .innerJoin(appSessions, and(eq(appSessions.tenantId, appDevices.tenantId), eq(appSessions.id, appDevices.sessionId)))
      .where(and(eq(appDevices.tenantId, tenantId), isNull(appDevices.removedAt), isNull(appSessions.endedAt), sql`${appSessions.expiresAt} > ${now}`));
    let n = 0;
    for (const { customerId } of shops) {
      const brands = await shopBrands(tx, tenantId, customerId);
      if (!brands) continue;
      const keys = new Set(brands.map(brandKey));
      const answered = new Set((await tx.select({ pollId: pollAnswers.pollId }).from(pollAnswers).where(and(eq(pollAnswers.tenantId, tenantId), eq(pollAnswers.customerId, customerId)))).map((a) => a.pollId));
      for (const p of open) {
        if (answered.has(p.id) || !p.brands.some((b) => keys.has(brandKey(b)))) continue;
        n += await queueToShop(tx, tenantId, customerId, { kind: "new_poll", dedupe: `poll:${p.id}`, title: pointsEach > 0 ? `New poll: earn ${pointsEach} points` : "New poll", body: p.question, tab: "polls" }, now);
      }
    }
    return n;
  });
}

/** Points ending (1 Dec and 15 Jan, IST): shops with points and a live phone. */
export async function queuePointsEnding(tenantId: string, now = new Date()) {
  const today = istDate(now);
  if (!/-(12-01|01-15)$/.test(today) || !dropAppOfPlant(tenantId)) return 0;
  const skus = await kit.products(tenantId);
  return withTenant(tenantId, async (tx) => {
    const shops = await tx
      .selectDistinct({ customerId: appSessions.customerId })
      .from(appDevices)
      .innerJoin(appSessions, and(eq(appSessions.tenantId, appDevices.tenantId), eq(appSessions.id, appDevices.sessionId)))
      .where(and(eq(appDevices.tenantId, tenantId), isNull(appDevices.removedAt), isNull(appSessions.endedAt), sql`${appSessions.expiresAt} > ${now}`));
    let n = 0;
    for (const { customerId } of shops) {
      if (!(await shopBrands(tx, tenantId, customerId))) continue;
      const p = await shopPoints(tx, tenantId, customerId, skus, today);
      if (!p.summary.on || p.summary.balance <= 0 || !p.summary.year_end) continue;
      const next = nextReward(p.summary, p.setting?.rewards ?? []);
      const body = `${p.summary.balance.toLocaleString("en-IN")} points end on ${dayMonth(p.summary.year_end)}.${next ? (next.missing > 0 ? ` Free ${next.label} at ${(p.summary.balance + next.missing).toLocaleString("en-IN")}.` : ` Enough for a free ${next.label}.`) : ""}`;
      n += await queueToShop(tx, tenantId, customerId, { kind: "points_ending", dedupe: `points_end:${today}`, title: "Your points end soon", body, tab: "points" }, now);
    }
    return n;
  });
}

// ---------- sending ----------

const waitAfter = (tries: number) => Math.min(6 * 3_600_000, 5 * 60_000 * 2 ** Math.max(0, tries - 1));

/** Sends up to `max` waiting pushes of the plant. Never throws. */
export async function sendWaiting(tenantId: string, max = BATCH, now = new Date()) {
  const out = { sent: 0, gone: 0, failed: 0, gave_up: 0 };
  try {
    const due = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: appPushOutbox.id, deviceId: appPushOutbox.deviceId, title: appPushOutbox.title, body: appPushOutbox.body, tab: appPushOutbox.tab, tries: appPushOutbox.tries, createdAt: appPushOutbox.createdAt, token: appDevices.fcmToken, removedAt: appDevices.removedAt })
        .from(appPushOutbox)
        .innerJoin(appDevices, and(eq(appDevices.tenantId, appPushOutbox.tenantId), eq(appDevices.id, appPushOutbox.deviceId)))
        .where(and(eq(appPushOutbox.tenantId, tenantId), isNull(appPushOutbox.sentAt), isNull(appPushOutbox.gaveUpAt), lte(appPushOutbox.nextTryAt, now)))
        .orderBy(appPushOutbox.createdAt)
        .limit(max),
    );
    let alert = false;
    for (const r of due) {
      const old = now.getTime() - r.createdAt.getTime() > GIVE_UP_MS;
      if (r.removedAt || old) {
        await withTenant(tenantId, (tx) => tx.update(appPushOutbox).set({ gaveUpAt: now, lastError: r.removedAt ? "The phone was removed" : "Not sent within 3 days" }).where(and(eq(appPushOutbox.tenantId, tenantId), eq(appPushOutbox.id, r.id))));
        out.gave_up++;
        continue;
      }
      if (!fcmOn()) continue; // waits for the key (given up after 3 days)
      const res = await sendPush({ token: r.token, title: r.title, body: r.body, tab: r.tab });
      await withTenant(tenantId, async (tx) => {
        const row = and(eq(appPushOutbox.tenantId, tenantId), eq(appPushOutbox.id, r.id));
        if (res.ok) {
          await tx.update(appPushOutbox).set({ sentAt: now, tries: r.tries + 1 }).where(row);
          out.sent++;
        } else if (res.kind === "gone") {
          await tx.update(appPushOutbox).set({ gaveUpAt: now, tries: r.tries + 1, lastError: res.error }).where(row);
          await tx.update(appDevices).set({ removedAt: now, removeReason: "unregistered" }).where(and(eq(appDevices.tenantId, tenantId), eq(appDevices.id, r.deviceId), isNull(appDevices.removedAt)));
          out.gone++;
        } else if (res.kind === "bad") {
          await tx.update(appPushOutbox).set({ gaveUpAt: now, tries: r.tries + 1, lastError: res.error }).where(row);
          out.gave_up++;
        } else {
          await tx.update(appPushOutbox).set({ tries: Math.min(50, r.tries + 1), nextTryAt: new Date(now.getTime() + waitAfter(r.tries + 1)), lastError: res.error }).where(row);
          out.failed++;
          if (res.kind === "auth" && now.getTime() - r.createdAt.getTime() >= ALERT_AFTER_MS) alert = true;
        }
      });
      if (!res.ok && res.kind === "auth") break; // the key is refused: the rest would be refused too
    }
    if (alert)
      await kit.notify(tenantId, {
        kind: "order_capture.drop_push_failed",
        title: "Drop: pushes to shops' phones are failing",
        body: "Firebase has refused the push key for over an hour. Check FCM_SERVICE_ACCOUNT on order-capture.",
        link: "/customers/drop",
        dedupe_key: `drop-push-failed:${istDate(now)}`,
      });
  } catch (err) {
    console.error("[order-capture] Drop push sending failed:", (err as Error).message);
  }
  return out;
}

/** The push job (every 5 minutes): new polls queued, then each plant's waiting pushes sent. */
export async function runPushJob(now = new Date()) {
  const plants = new Set(dropApps().map((a) => a.tenantId));
  let queued = 0;
  for (const t of plants) queued += await queuePolls(t, now).catch((err) => (console.error("[order-capture] Drop poll pushes failed:", (err as Error).message), 0));
  const waiting = await orderDb().execute<{ id: string }>(sql`select t as id from order_capture.app_push_tenants() t`).catch(() => ({ rows: [] as { id: string }[] }));
  for (const r of waiting.rows) plants.add(r.id);
  const sent = { sent: 0, gone: 0, failed: 0, gave_up: 0 };
  for (const t of plants) {
    const r = await sendWaiting(t, BATCH, now);
    for (const k of Object.keys(sent) as (keyof typeof sent)[]) sent[k] += r[k];
  }
  return { queued, ...sent };
}

/** The daily job: points ending (on 1 Dec and 15 Jan only), then sent by the next push run. */
export async function runPushDaily(now = new Date()) {
  let queued = 0;
  for (const a of dropApps()) queued += await queuePointsEnding(a.tenantId, now).catch((err) => (console.error("[order-capture] Drop points-ending pushes failed:", (err as Error).message), 0));
  return { points_ending: queued };
}


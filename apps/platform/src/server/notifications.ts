// App notifications (CLAUDE.md "Notifications", docs/notifications.md): one inbox in the platform for every module.
// Modules only report events; the platform decides who receives them, stores one row per person (own read mark)
// and sends "push" level ones to the phones those people turned on. Who (N2, decided 2026-10-11):
//   the plant's active owners (always) + people the owner ticked for this module + also_user_ids (the people the
//   event is about), each active and working in the module (roleWorksIn) - minus whoever did it.
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { NOTIFICATION_KINDS, NotificationInput, NotificationMode, OWNER_ONLY_ALERTS, roleWorksIn, type ModuleId, type RoleId } from "@plantops/types";
import type { CurrentUser } from "./auth";
import { schema, withTenant, type PlatformTx } from "./db";
import { badRequest, forbidden, notFound } from "./http";
import { safeNext } from "@/lib/safe-next";
import { later } from "./http";
import { configuredSender, pushToUsers, type PushMessage, type PushSender } from "./push";
import { enabledModules } from "./sso";

const { alertRecipients, notificationPrefs, notifications, pushSubscriptions, tenants, userRoles, users } = schema;

export const INBOX_LIMIT = 30;
type Input = z.output<typeof NotificationInput>;

/**
 * Where tapping a notification goes: a module page through the normal login + one-time-code handoff, or (an event
 * from PlantOps itself, no module) a platform page.
 */
export function targetUrl(moduleId: string | null, link: string | null) {
  if (!moduleId) return safeNext(link) ?? "/home?launcher=1";
  const url = `/sso/start?module=${encodeURIComponent(moduleId)}`;
  return link ? `${url}&next=${encodeURIComponent(link)}` : url;
}

/** Who gets this module's event in this plant (the rule above). Inside the plant's transaction. */
async function recipientsFor(tx: PlatformTx, tenantId: string, moduleId: ModuleId, alsoUserIds: string[] = [], onlyListed = false) {
  if (onlyListed && !alsoUserIds.length) return [];
  // owner-only modules (Attendance): ticks are never used, even if a row exists
  const ticked = onlyListed || OWNER_ONLY_ALERTS.includes(moduleId)
    ? []
    : await tx.select({ id: alertRecipients.userId }).from(alertRecipients).where(and(eq(alertRecipients.tenantId, tenantId), eq(alertRecipients.moduleId, moduleId)));
  const candidates = [...new Set([...ticked.map((t) => t.id), ...alsoUserIds])];
  const rows = await tx
    .select({ id: users.id, role: userRoles.roleId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.status, "active"),
        eq(tenants.status, "active"),
        onlyListed
          ? inArray(users.id, candidates)
          : candidates.length
            ? or(eq(userRoles.roleId, "tenant_admin"), inArray(users.id, candidates))
            : eq(userRoles.roleId, "tenant_admin"),
      ),
    );
  const people = new Set<string>();
  for (const r of rows) {
    if (r.role === "tenant_admin" || roleWorksIn(r.role as RoleId, moduleId)) people.add(r.id);
  }
  return [...people];
}

/**
 * Each person's own choice for this kind (N4): 'off' -> left out, 'bell' -> stored without a phone message.
 * Urgent kinds ignore it. A choice can lower the level, never raise it.
 */
async function withPrefs(tx: PlatformTx, tenantId: string, kind: string, people: string[], level: "push" | "bell") {
  if (!people.length) return [];
  if (NOTIFICATION_KINDS[kind]?.urgent) return people.map((userId) => ({ userId, level }));
  const prefs = await tx
    .select({ userId: notificationPrefs.userId, mode: notificationPrefs.mode })
    .from(notificationPrefs)
    .where(and(eq(notificationPrefs.tenantId, tenantId), eq(notificationPrefs.kind, kind), inArray(notificationPrefs.userId, people)));
  const mode = new Map(prefs.map((p) => [p.userId, p.mode]));
  return people
    .filter((userId) => mode.get(userId) !== "off")
    .map((userId) => ({ userId, level: mode.get(userId) === "bell" ? ("bell" as const) : level }));
}

const pushMessages = (rows: { id: string; userId: string; level: string }[], title: string, body: string) => {
  const messages = new Map<string, PushMessage>();
  for (const r of rows) if (r.level === "push") messages.set(r.userId, { id: r.id, title, body });
  return messages;
};

/**
 * A module's event for one plant -> one notification per recipient (minus whoever did it). The same
 * module + dedupe_key is stored once per person, so a retry adds nothing. Returns the new rows' push messages;
 * the caller sends them (after the answer, so a slow push service never holds up the module).
 */
export async function notifyPlant(moduleId: ModuleId, tenantId: string, input: Input) {
  const rows = await withTenant(tenantId, async (tx) => {
    const enabled = await enabledModules(tx, tenantId);
    if (!enabled.includes(moduleId)) throw forbidden("This module is not enabled for this plant");
    const recipients = (await recipientsFor(tx, tenantId, moduleId, input.also_user_ids, input.only_listed)).filter((id) => id !== input.exclude_user_id);
    const people = await withPrefs(tx, tenantId, input.kind, recipients, input.level);
    if (!people.length) return { recipients: 0, created: [] as { id: string; userId: string; level: string }[] };
    const created = await tx
      .insert(notifications)
      .values(
        people.map((p) => ({
          tenantId,
          userId: p.userId,
          moduleId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          link: input.link,
          level: p.level,
          dedupeKey: input.dedupe_key,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id, userId: notifications.userId, level: notifications.level });
    return { recipients: people.length, created };
  });
  return { recipients: rows.recipients, created: rows.created.length, messages: pushMessages(rows.created, input.title, input.body) };
}

/** Sends the phone notifications prepared by notifyPlant. Never throws (logged instead). */
export async function sendPrepared(tenantId: string, messages: Map<string, PushMessage>, send?: PushSender | null) {
  try {
    return await pushToUsers(tenantId, messages, send);
  } catch (err) {
    console.error("[notifications] push failed:", (err as Error).message);
    return { sent: 0, removed: 0, failed: messages.size };
  }
}

// ---------- events from PlantOps itself (N3) ----------

export interface DirectEvent {
  /** the module it is about (opens that module), or null: a PlantOps event opening a platform page */
  module: ModuleId | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  level: "push" | "bell";
  dedupe_key: string;
  exclude_user_id?: string | null;
}

/**
 * The platform writes an event straight into the inbox of the plant's active OWNERS (never ticked people): a staff
 * member locked out, support opened a module, plan changes, renewal. Runs on the app login (row-level security),
 * also after a super_admin action. Phones are notified after the answer. Never throws into the action.
 */
export async function notifyOwnersDirect(tenantId: string, e: DirectEvent, send?: PushSender | null) {
  try {
    const created = await withTenant(tenantId, async (tx) => {
      const owners = await tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), eq(tenants.status, "active"), eq(userRoles.roleId, "tenant_admin")));
      const people = await withPrefs(tx, tenantId, e.kind, owners.map((o) => o.id).filter((id) => id !== e.exclude_user_id), e.level);
      if (!people.length) return [];
      return tx
        .insert(notifications)
        .values(
          people.map((p) => ({
            tenantId,
            userId: p.userId,
            moduleId: e.module,
            kind: e.kind,
            title: e.title.slice(0, 80),
            body: e.body.slice(0, 300),
            link: e.link,
            level: p.level,
            dedupeKey: e.dedupe_key,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notifications.id, userId: notifications.userId, level: notifications.level });
    });
    const messages = pushMessages(created, e.title, e.body);
    if (messages.size) later(() => sendPrepared(tenantId, messages, send));
    return created.length;
  } catch (err) {
    console.error("[notifications] direct event failed:", (err as Error).message);
    return 0;
  }
}

// ---------- the user's own inbox ----------

export async function listFor(user: CurrentUser) {
  return withTenant(user.tenantId, async (tx) => {
    const mine = and(eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.userId));
    const items = await tx.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt)).limit(INBOX_LIMIT);
    const [unread] = await tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(mine, isNull(notifications.readAt)));
    return {
      unread: unread?.n ?? 0,
      items: items.map((n) => ({
        id: n.id,
        module: n.moduleId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        level: n.level,
        created_at: n.createdAt.toISOString(),
        read: n.readAt !== null,
        open_url: `/n/${n.id}`,
      })),
    };
  });
}

export const MarkReadInput = z.object({ ids: z.array(z.uuid()).max(100).optional(), all: z.literal(true).optional() }).refine((v) => v.all || v.ids?.length, "Give ids or all: true");

/** Marks the user's own notifications read (never anyone else's). Returns how many changed. */
export async function markRead(user: CurrentUser, input: z.infer<typeof MarkReadInput>) {
  return withTenant(user.tenantId, async (tx) => {
    const where = and(
      eq(notifications.tenantId, user.tenantId),
      eq(notifications.userId, user.userId),
      isNull(notifications.readAt),
      input.all ? undefined : inArray(notifications.id, input.ids!),
    );
    const changed = await tx.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
    return changed.length;
  });
}

/** Tap on a notification (bell list or phone): mark it read and return where to go. Someone else's -> 404. */
export async function openNotification(user: CurrentUser, id: string) {
  return withTenant(user.tenantId, async (tx) => {
    const [n] = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.userId)));
    if (!n) throw notFound("Notification not found");
    if (!n.readAt) await tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, n.id));
    return targetUrl(n.moduleId, n.link);
  });
}

/** Unread count for one person (module header bell). Unknown or other-plant user -> 0 (RLS). */
export async function unreadCount(tenantId: string, userId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  });
}

// ---------- each person's settings (N4) ----------

/**
 * The kinds this person can receive: owners all of their plant's (and PlantOps'), others their modules' only; in an
 * owner-only module (Attendance) a non-owner only the kinds about themselves.
 */
async function kindsFor(tx: PlatformTx, user: CurrentUser) {
  const enabled = await enabledModules(tx, user.tenantId);
  const owner = user.roles.includes("tenant_admin");
  return Object.entries(NOTIFICATION_KINDS).filter(([, k]) => {
    if (k.module === null) return owner;
    if (!enabled.includes(k.module)) return false;
    if (owner) return true;
    if (OWNER_ONLY_ALERTS.includes(k.module) && !k.aboutYou) return false;
    return user.roles.some((r) => roleWorksIn(r, k.module!));
  });
}

/** The settings screen: every kind this person can receive, grouped by module, with their choice. */
export async function settingsFor(user: CurrentUser) {
  return withTenant(user.tenantId, async (tx) => {
    const kinds = await kindsFor(tx, user);
    const prefs = await tx
      .select({ kind: notificationPrefs.kind, mode: notificationPrefs.mode })
      .from(notificationPrefs)
      .where(and(eq(notificationPrefs.tenantId, user.tenantId), eq(notificationPrefs.userId, user.userId)));
    const mode = new Map(prefs.map((p) => [p.kind, p.mode]));
    return kinds.map(([kind, k]) => ({
      kind,
      module: k.module,
      label: k.label,
      urgent: !!k.urgent,
      bell_only: !!k.bellOnly,
      mode: k.urgent ? "push" : (mode.get(kind) ?? "push"),
    }));
  });
}

export const SettingInput = z.object({ kind: z.string().min(1).max(60), mode: NotificationMode });

/** Changes one of this person's own choices. Urgent kinds, and kinds they never get, can't be changed. */
export async function setSetting(user: CurrentUser, input: z.infer<typeof SettingInput>) {
  return withTenant(user.tenantId, async (tx) => {
    const k = (await kindsFor(tx, user)).find(([kind]) => kind === input.kind)?.[1];
    if (!k) throw badRequest("You don't get this notification");
    if (k.urgent) throw badRequest("This notification is urgent and always on");
    const mine = and(eq(notificationPrefs.tenantId, user.tenantId), eq(notificationPrefs.userId, user.userId), eq(notificationPrefs.kind, input.kind));
    if (input.mode === "push") {
      await tx.delete(notificationPrefs).where(mine); // back to normal
    } else {
      await tx
        .insert(notificationPrefs)
        .values({ tenantId: user.tenantId, userId: user.userId, kind: input.kind, mode: input.mode })
        .onConflictDoUpdate({ target: [notificationPrefs.tenantId, notificationPrefs.userId, notificationPrefs.kind], set: { mode: input.mode, updatedAt: new Date() } });
    }
    return { kind: input.kind, mode: input.mode };
  });
}

// ---------- phones ----------

/** What the browser's PushSubscription.toJSON() gives. Real push services always use https. */
export const SubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** This phone now gets this user's notifications. A phone used by someone else in this plant moves to this user. */
export async function subscribe(user: CurrentUser, input: z.infer<typeof SubscriptionInput>, userAgent: string | null) {
  await withTenant(user.tenantId, async (tx) => {
    await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, user.tenantId), eq(pushSubscriptions.endpoint, input.endpoint)));
    await tx.insert(pushSubscriptions).values({
      tenantId: user.tenantId,
      userId: user.userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
  });
}

/** This phone stops getting this user's notifications (turn off, or logout). */
export async function unsubscribe(user: CurrentUser, endpoint: string) {
  return withTenant(user.tenantId, async (tx) => {
    const gone = await tx
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, user.tenantId), eq(pushSubscriptions.userId, user.userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return gone.length;
  });
}

/** Whether this phone is on for this user (the launcher card shows "On for this phone"). */
export async function isSubscribed(user: CurrentUser, endpoint: string) {
  return withTenant(user.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, user.tenantId), eq(pushSubscriptions.userId, user.userId), eq(pushSubscriptions.endpoint, endpoint)));
    return Boolean(row);
  });
}

export type TestResult = "sent" | "gone" | "failed" | "not_set_up" | "not_found";

/**
 * "Send a test to this phone" on /notifications: one push to the device asking, nothing in the bell. A phone the
 * push service says is gone (404 / 410) is removed, so the page shows it as Off and the person can turn it on again.
 */
export async function sendTestPush(user: CurrentUser, endpoint: string, send: PushSender | null = configuredSender()): Promise<TestResult> {
  if (!send) return "not_set_up";
  const [sub] = await withTenant(user.tenantId, (tx) =>
    tx
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, user.tenantId), eq(pushSubscriptions.userId, user.userId), eq(pushSubscriptions.endpoint, endpoint))),
  );
  if (!sub) return "not_found";
  const payload = JSON.stringify({ title: "PlantOps test", body: "Phone notifications work on this device.", url: "/notifications", tag: `test-${sub.id}` });
  const status = await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) {
    await withTenant(user.tenantId, (tx) => tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)));
    return "gone";
  }
  console.error(`[push] test to ${new URL(sub.endpoint).host} answered ${status}`);
  return "failed";
}

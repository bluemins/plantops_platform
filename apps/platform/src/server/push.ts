// Phone notifications through Web Push (CLAUDE.md "Notifications"). Free: the phone's own browser push service
// (Google, Apple, Mozilla) delivers an encrypted message; we only hold a key pair (VAPID_*). Best effort: a phone
// that is gone (404/410) is removed, any other failure is logged and the bell still has the notification.
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { schema, withTenant } from "./db";
import { env } from "./env";

const { pushSubscriptions } = schema;

export interface PushMessage {
  /** this person's notification id: the tap opens /n/<id> (marks it read, then opens the module page) */
  id: string;
  title: string;
  body: string;
}
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
/** Sends one encrypted message; resolves with the push service's HTTP status (never throws). */
export type PushSender = (target: PushTarget, payload: string) => Promise<number>;

/** The real sender, or null while VAPID_* is not set (push quietly off). */
export function configuredSender(): PushSender | null {
  const v = env.vapid;
  if (!v) return null;
  return async (target, payload) => {
    try {
      const res = await webpush.sendNotification(target, payload, {
        vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 24 * 3600, // a phone that is off for a day still gets it when it comes back
        urgency: "normal",
        timeout: 10_000,
      });
      return res.statusCode;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status) return status;
      console.error("[push] send failed:", (err as Error).message);
      return 0;
    }
  };
}

/**
 * Sends each person's message to every phone they turned notifications on. `messages` maps user id -> message
 * (each person has their own notification id). Returns how many phones got it and how many were removed.
 */
export async function pushToUsers(tenantId: string, messages: Map<string, PushMessage>, send: PushSender | null = configuredSender()) {
  const result = { sent: 0, removed: 0, failed: 0 };
  if (!send || !messages.size) return result;
  const subs = await withTenant(tenantId, (tx) =>
    tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), inArray(pushSubscriptions.userId, [...messages.keys()]))),
  );
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const m = messages.get(s.userId)!;
      const payload = JSON.stringify({ title: m.title, body: m.body, url: `/n/${m.id}`, tag: m.id });
      const status = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      if (status >= 200 && status < 300) result.sent++;
      else if (status === 404 || status === 410) gone.push(s.id);
      else result.failed++;
    }),
  );
  if (gone.length) {
    await withTenant(tenantId, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)));
    result.removed = gone.length;
  }
  return result;
}

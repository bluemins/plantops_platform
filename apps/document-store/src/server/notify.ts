// App notifications from Document Store (docs/notifications.md N3). The platform picks the people: the owners
// (always) + people ticked for Document Store (+ also_user_ids), minus whoever did it. The texts live here; the email
// reminders are unchanged and run alongside. Sending never throws and never breaks a save (kit.notify logs).
import type { NotificationInput } from "@plantops/types";
import { fmtDate } from "@plantops/module-kit/format";
import { kit } from "./kit";
import type { DocUser } from "./session";

const BODY_MAX = 300;
const clip = (s: string) => (s.length <= BODY_MAX ? s : `${s.slice(0, BODY_MAX - 1)}…`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const validUntil = (expiresOn: string | null) => (expiresOn ? `valid until ${fmtDate(expiresOn)}` : "no expiry date");

/** Sends one notification; never throws. */
export const send = (tenantId: string, input: NotificationInput) => kit.notify(tenantId, input);

/** Storage warning thresholds (% of the plan's storage). */
export const STORAGE_STEPS = [80, 95] as const;

type DocInfo = { id: string; name: string; certificate_no?: string | null; expires_on: string | null; responsible_user_id: string; responsible_name: string };

/**
 * Expiry stage reached (30 / 7 / 1 days before, on expiry, then weekly): to the owners, the people ticked for
 * Document Store and the responsible person. Once per version and stage, like the email.
 */
export function expiryNotification(doc: DocInfo, versionId: string, stage: string, expiryText: string): NotificationInput {
  return {
    kind: "document_store.expiry",
    title: clip(`${doc.name}: ${lower(expiryText)}`).slice(0, 80),
    body: clip(
      [doc.certificate_no ? `No. ${doc.certificate_no}.` : null, doc.expires_on ? `Expiry date ${fmtDate(doc.expires_on)}.` : null, `Responsible: ${doc.responsible_name}.`, "Renew it in Document Store."]
        .filter(Boolean)
        .join(" "),
    ),
    link: `/documents/${doc.id}`,
    level: "push",
    dedupe_key: `expiry:${versionId}:${stage}`,
    also_user_ids: [doc.responsible_user_id],
  };
}

/** The person made responsible for a document (only them; not when they chose themselves). */
export function responsibleNotification(user: DocUser, doc: DocInfo): NotificationInput | null {
  if (doc.responsible_user_id === user.userId) return null;
  return {
    kind: "document_store.responsible",
    title: clip(`You are responsible for ${doc.name}`).slice(0, 80),
    body: clip(`${user.name} made you responsible for renewing it (${validUntil(doc.expires_on)}). You will get its expiry reminders.`),
    link: `/documents/${doc.id}`,
    level: "push",
    dedupe_key: `responsible:${doc.id}:${doc.responsible_user_id}:${Date.now()}`,
    also_user_ids: [doc.responsible_user_id],
    only_listed: true,
  };
}

/** A new document was added, or one was renewed (bell only: good news, nothing to do). */
export function addedNotification(user: DocUser, doc: DocInfo, kind: "added" | "renewed", versionId: string): NotificationInput {
  return {
    kind: `document_store.${kind}`,
    title: clip(`${kind === "added" ? "New document" : "Renewed"}: ${doc.name}`).slice(0, 80),
    body: clip(`${cap(validUntil(doc.expires_on))}. ${kind === "added" ? "Added" : "Renewed"} by ${user.name}.`),
    link: `/documents/${doc.id}`,
    level: "bell",
    dedupe_key: kind === "added" ? `added:${doc.id}` : `renewed:${versionId}`,
    exclude_user_id: user.userId,
  };
}

/** The threshold (80 / 95 %) this upload crossed, or null. */
export function storageStepCrossed(before: number, after: number, limit: number | null): number | null {
  if (!limit) return null;
  const crossed = STORAGE_STEPS.filter((p) => before < (limit * p) / 100 && after >= (limit * p) / 100);
  return crossed.length ? crossed[crossed.length - 1]! : null;
}

export function storageNotification(pct: number, usedBytes: number, limitBytes: number): NotificationInput {
  const mb = (b: number) => Math.round(b / (1024 * 1024));
  return {
    kind: "document_store.storage",
    title: `Document storage ${pct}% full`,
    body: `${mb(usedBytes)} MB of ${mb(limitBytes)} MB used. Ask PlantOps for more space before uploads stop.`,
    link: "/",
    level: "push",
    dedupe_key: `storage:${pct}:${mb(limitBytes)}`,
  };
}


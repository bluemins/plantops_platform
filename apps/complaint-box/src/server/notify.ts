// Complaint Box's app notifications (docs/COMPLAINT_BOX_PHASE_PLAN.md "Notifications"). The PLATFORM picks the people
// (the plant's owners + those ticked "Gets Complaint Box alerts" + also_user_ids, each re-checked) and leaves out
// whoever acted; these functions only write the text. None of the kinds is urgent: each person can mute them.
//   * new complaint (push) · resolved: to whoever logged it only (push) · reopened (push, + whoever logged it)
//   * note added / set in progress (bell only) · storage 80% / 95% of the plan (push)
//   * still open: the daily job, 3 days after opening / reopening, then every 7 days (push)
// The customer's phone number is never put in a notification (it would show on a lock screen).
import { sql } from "drizzle-orm";
import type { NotificationInput } from "@plantops/types";
import { formatRef } from "@/lib/phone";
import { complaintDb, withTenant } from "./db";
import { kit } from "./kit";
import type { CbUser } from "./session";

const TITLE_MAX = 80;
const BODY_MAX = 300;
const DAY = 24 * 60 * 60 * 1000;
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const title = (s: string) => clip(s, TITLE_MAX);
const body = (s: string) => clip(s.replace(/\s+/g, " ").trim(), BODY_MAX);
const link = (complaintId: string) => `/c/${complaintId}`;

// ---------- events from people's actions ----------
export interface SavedComplaint {
  id: string;
  ref: string;
  item_name: string;
  customer_name: string;
  place: string;
  description: string;
}

/** A new complaint: owners + ticked people, not whoever logged it. */
export function newNotification(user: CbUser, c: SavedComplaint): NotificationInput {
  return {
    kind: "complaint_box.new",
    title: title(`New complaint ${c.ref}: ${c.item_name}`),
    body: body(`${c.customer_name}, ${c.place}. ${clip(c.description, 160)} (by ${user.name})`),
    link: link(c.id),
    level: "push",
    dedupe_key: `new:${c.id}`,
    exclude_user_id: user.userId,
  };
}

export interface StatusChange {
  complaint_id: string;
  ref: string;
  event_id: string;
  kind: "in_progress" | "resolved" | "reopened";
  text: string | null;
  reported_by: string;
}

/** What a status change tells whom: resolved -> whoever logged it only; reopened -> + them; in progress -> bell. */
export function statusNotification(user: CbUser, s: StatusChange): NotificationInput | null {
  if (s.kind === "resolved") {
    if (s.reported_by === user.userId) return null; // they resolved their own complaint: nobody to tell
    return {
      kind: "complaint_box.resolved",
      title: title(`${s.ref} resolved`),
      body: body(s.text ?? ""),
      link: link(s.complaint_id),
      level: "push",
      dedupe_key: `resolved:${s.complaint_id}:${s.event_id}`,
      exclude_user_id: user.userId,
      also_user_ids: [s.reported_by],
      only_listed: true,
    };
  }
  if (s.kind === "reopened") {
    return {
      kind: "complaint_box.reopened",
      title: title(`${s.ref} reopened`),
      body: body(s.text ?? ""),
      link: link(s.complaint_id),
      level: "push",
      dedupe_key: `reopened:${s.complaint_id}:${s.event_id}`,
      exclude_user_id: user.userId,
      also_user_ids: [s.reported_by],
    };
  }
  return updatedNotification(user, { complaint_id: s.complaint_id, ref: s.ref, event_id: s.event_id, note: null });
}

/** A note added, or set In progress: bell only, so following a complaint up doesn't buzz the owner's phone. */
export function updatedNotification(user: CbUser, u: { complaint_id: string; ref: string; event_id: string; note: string | null }): NotificationInput {
  return {
    kind: "complaint_box.updated",
    title: title(u.note === null ? `${user.name} set ${u.ref} in progress` : `${user.name} added a note on ${u.ref}`),
    body: body(u.note ?? ""),
    link: link(u.complaint_id),
    level: "bell",
    dedupe_key: `updated:${u.complaint_id}:${u.event_id}`,
    exclude_user_id: user.userId,
  };
}

// ---------- storage ----------
export const STORAGE_STEPS = [80, 95] as const;

/** The threshold (80 / 95 %) this upload crossed, or null. */
export function storageStepCrossed(before: number, after: number, limit: number | null): number | null {
  if (!limit) return null;
  const crossed = STORAGE_STEPS.filter((p) => before < (limit * p) / 100 && after >= (limit * p) / 100);
  return crossed.length ? crossed[crossed.length - 1]! : null;
}

export function storageNotification(pct: number, usedBytes: number, limitBytes: number): NotificationInput {
  const mb = (b: number) => Math.round(b / (1024 * 1024)).toLocaleString("en-IN");
  return {
    kind: "complaint_box.storage",
    title: `Complaint Box storage ${pct}% used`,
    body: `${mb(usedBytes)} MB of ${mb(limitBytes)} MB used. Ask PlantOps for more space before photo uploads stop.`,
    link: "/",
    level: "push",
    dedupe_key: `storage:${pct}:${Math.round(limitBytes / (1024 * 1024))}`,
  };
}

// ---------- still open (daily job) ----------
/** The reminder step reached after `days` open: none before day 3, then 3, 10, 17, ... (the latest one reached). */
export function stillOpenStep(days: number): number | null {
  if (days < 3) return null;
  return 3 + Math.floor((days - 3) / 7) * 7;
}

export interface OpenComplaint {
  id: string;
  ref_no: number;
  item_name: string;
  customer_name: string;
  /** logged, or last reopened */
  opened_at: Date;
  /** the reopening's history id, or null when never reopened */
  reopened_event_id: string | null;
  last_update: string | null;
}

/** `days` = how long it has really been open (the title); `step` = the reminder step (3, 10, 17...: the key). */
export function stillOpenNotification(c: OpenComplaint, step: number, days = step): NotificationInput {
  const ref = formatRef(c.ref_no);
  return {
    kind: "complaint_box.still_open",
    title: title(`${ref} open for ${days} days`),
    body: body(`${c.item_name}, ${c.customer_name}. Last update: ${c.last_update ?? "none yet"}`),
    link: link(c.id),
    level: "push",
    dedupe_key: `open:${c.id}:${c.reopened_event_id ?? "logged"}:d${step}`,
  };
}

const EVENT_WORDS: Record<string, string> = { in_progress: "set In progress", resolved: "resolved", reopened: "reopened", note: "" };

/** The plant's open / in-progress complaints with when they were (re)opened and their latest history line. */
async function openComplaints(tenantId: string): Promise<OpenComplaint[]> {
  return withTenant(tenantId, async (tx) => {
    const { rows } = await tx.execute<{ id: string; ref_no: number; item_name: string; customer_name: string; created_at: string; reopened_at: string | null; reopened_id: string | null; last_by: string | null; last_kind: string | null; last_text: string | null }>(sql`
      select c.id, c.ref_no, c.item_name, c.customer_name, c.created_at,
             r.created_at as reopened_at, r.id as reopened_id,
             l.created_by_name as last_by, l.kind as last_kind, l.text as last_text
        from complaint_box.complaints c
        left join lateral (select e.id, e.created_at from complaint_box.complaint_events e
                            where e.complaint_id = c.id and e.kind = 'reopened' order by e.created_at desc, e.id desc limit 1) r on true
        left join lateral (select e.created_by_name, e.kind, e.text from complaint_box.complaint_events e
                            where e.complaint_id = c.id order by e.created_at desc, e.id desc limit 1) l on true
       where c.tenant_id = ${tenantId} and c.status in ('open', 'in_progress')
       order by c.ref_no`);
    return rows.map((r) => ({
      id: r.id,
      ref_no: r.ref_no,
      item_name: r.item_name,
      customer_name: r.customer_name,
      opened_at: new Date(r.reopened_at ?? r.created_at),
      reopened_event_id: r.reopened_id,
      last_update: r.last_by ? `${r.last_by}${r.last_kind === "note" ? `: ${clip(r.last_text ?? "", 120)}` : ` ${EVENT_WORDS[r.last_kind ?? ""] ?? ""}`}` : null,
    }));
  });
}

/**
 * The morning job: first resend notifications that waited in the outbox (platform briefly down), then remind about
 * complaints left open. Each step is sent once (the dedupe key), so running the job twice is harmless. Plants that
 * switched Complaint Box off are skipped quietly.
 */
export async function runDaily(now = new Date(), notify = kit.notify) {
  const outbox = await kit.retryOutbox(now.getTime());
  const { rows } = await complaintDb().execute<{ id: string }>(sql`select complaint_box.open_tenants() as id`);
  const total = { plants: rows.length, reminded: 0, skipped: 0, errors: 0, outbox };
  for (const { id: tenantId } of rows) {
    try {
      const plan = await kit.plan(tenantId);
      if (plan && !plan.enabled_modules.includes("complaint_box")) {
        total.skipped++;
        continue;
      }
      for (const c of await openComplaints(tenantId)) {
        const days = Math.floor((now.getTime() - c.opened_at.getTime()) / DAY);
        const step = stillOpenStep(days);
        if (step === null) continue;
        if (await notify(tenantId, stillOpenNotification(c, step, days))) total.reminded++;
        else total.errors++;
      }
    } catch (err) {
      total.errors++;
      console.error("[complaint-box] daily job failed for one plant:", (err as Error).message);
    }
  }
  return total;
}

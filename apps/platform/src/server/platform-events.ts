// Notifications N3: events PlantOps itself writes into the owners' inbox (docs/notifications.md). Owners only;
// never the people ticked for a module. Each call is best effort and never breaks the action that caused it.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MODULE_IDS, type ModuleId } from "@plantops/types";
import { moduleLabel } from "@/lib/modules";
import { appDb } from "./db";
import { purgeOldErrors } from "./errors";
import { notifyOwnersDirect } from "./notifications";
import type { PushSender } from "./push";

const istTime = (at: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
const istDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
const longDate = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/** A staff member (or another owner) was locked out after too many wrong PINs / passwords. */
export function notifyLockout(tenantId: string, user: { id: string; name: string; pin: boolean }, lockedUntil: Date, minutes: number, at = new Date()) {
  return notifyOwnersDirect(tenantId, {
    module: null,
    kind: "platform.user_locked",
    title: `${user.name} is locked out`,
    body: `5 wrong ${user.pin ? "PINs" : "passwords"} at ${istTime(at)}. They can try again in ${minutes} minutes, or you can unlock them now in Manage users.`,
    link: "/admin/users",
    level: "push",
    dedupe_key: `lockout:${user.id}:${lockedUntil.toISOString()}`,
    exclude_user_id: user.id,
  });
}

/** PlantOps support opened a module of this plant read-only (each opening; the module logs every page). */
export function notifySupportOpened(tenantId: string, moduleId: ModuleId, at = new Date()) {
  return notifyOwnersDirect(tenantId, {
    module: moduleId,
    kind: "platform.support_opened",
    title: `PlantOps support viewed ${moduleLabel(moduleId)}`,
    body: `Read-only, at ${istTime(at)}. Every page they open is listed under Support access.`,
    link: "/support-access",
    level: "bell",
    dedupe_key: `support:${moduleId}:${randomUUID()}`,
  });
}

type PlanState = { plan_name: string; enabled_modules: string[]; limits: unknown; renews_on: string | null } | null;

/** super_admin changed the plan: modules switched on (phone), switched off and other changes (bell). */
export async function notifyPlanChange(tenantId: string, before: PlanState, after: NonNullable<PlanState>) {
  const stamp = new Date().toISOString();
  const was = new Set(before?.enabled_modules ?? []);
  const now = new Set(after.enabled_modules);
  const on = MODULE_IDS.filter((m) => now.has(m) && !was.has(m));
  const off = MODULE_IDS.filter((m) => was.has(m) && !now.has(m));
  for (const m of on) {
    await notifyOwnersDirect(tenantId, {
      module: m,
      kind: "platform.module_on",
      title: `${moduleLabel(m)} is now switched on`,
      body: `PlantOps switched ${moduleLabel(m)} on for your plant. Give your staff the right roles in Manage users.`,
      link: "/",
      level: "push",
      dedupe_key: `plan:${m}:on:${stamp}`,
    });
  }
  for (const m of off) {
    await notifyOwnersDirect(tenantId, {
      module: null,
      kind: "platform.module_off",
      title: `${moduleLabel(m)} is switched off`,
      body: `PlantOps switched ${moduleLabel(m)} off for your plant. Its records are kept.`,
      link: "/home?launcher=1",
      level: "bell",
      dedupe_key: `plan:${m}:off:${stamp}`,
    });
  }
  const details: string[] = [];
  if (before && before.plan_name !== after.plan_name) details.push(`plan ${after.plan_name}`);
  if (before && JSON.stringify(before.limits) !== JSON.stringify(after.limits)) details.push("limits");
  if (before && before.renews_on !== after.renews_on) details.push(after.renews_on ? `renewal date ${longDate(after.renews_on)}` : "no renewal date");
  if (details.length) {
    await notifyOwnersDirect(tenantId, {
      module: null,
      kind: "platform.plan_changed",
      title: "Your PlantOps plan was updated",
      body: `Changed: ${details.join(", ")}. See the plan card on your PlantOps home.`,
      link: "/home?launcher=1",
      level: "bell",
      dedupe_key: `plan:${stamp}`,
    });
  }
}

/** 30 / 7 / 1 days before the renewal date, and on the day; null otherwise. */
export function renewalStage(renewsOn: string, today: string): string | null {
  const days = Math.round((Date.parse(`${renewsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days > 30 || days < 0) return null;
  if (days > 7) return "d30";
  if (days > 1) return "d7";
  return days === 1 ? "d1" : "d0";
}

export function renewalText(renewsOn: string, today: string) {
  const days = Math.round((Date.parse(`${renewsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? "Your PlantOps plan renews today" : `Your PlantOps plan renews in ${days} day${days === 1 ? "" : "s"}`;
}

/** The platform's daily job: plan renewal reminders (once per stage per renewal date), then old notifications go. */
export async function runPlatformDaily(now = new Date(), send?: PushSender | null) {
  const today = istDay(now);
  // notifications older than 90 days (only through the locked-down database function; N4)
  const purge = await appDb().execute<{ n: number }>(sql`select platform.purge_old_notifications() as n`);
  const removed = Number(purge.rows[0]?.n ?? 0);
  // error log rows older than 30 days (B-09)
  const errors_removed = await purgeOldErrors();
  const { rows } = await appDb().execute<{ tenant_id: string; renews_on: string }>(sql`select tenant_id, renews_on::text from platform.renewal_tenants()`);
  let reminded = 0;
  for (const r of rows) {
    const stage = renewalStage(r.renews_on, today);
    if (!stage) continue;
    const n = await notifyOwnersDirect(
      r.tenant_id,
      {
        module: null,
        kind: "platform.plan_renewal",
        title: renewalText(r.renews_on, today),
        body: `Renewal date ${longDate(r.renews_on)}. Contact PlantOps to renew, so your modules keep working.`,
        link: "/home?launcher=1",
        level: "push",
        dedupe_key: `renewal:${r.renews_on}:${stage}`,
      },
      send,
    );
    if (n) reminded++;
  }
  return { plants: rows.length, reminded, removed, errors_removed };
}

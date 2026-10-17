// The launcher tile's numbers (CLAUDE.md "Launcher tiles"; docs/ATTENDANCE_PHASE_PLAN.md "Standard pieces"). The
// platform's request names the plant and the view, never a person, so workers' tiles get no badge (owner,
// 2026-10-15): a worker sees "IN since 9:02" inside the app. The owner's numbers come from the Today board, so the
// tile and Today never disagree.
import type { ModuleSummary } from "@plantops/types";
import { waitingClaims } from "./claims";
import { withTenant } from "./db";
import { readSettings } from "./settings";
import { supportUser, type AtUser } from "./session";
import { todayBoard } from "./today";

/** "Not marked today" only counts from this hour (India time): before it, people are still coming in. */
export const NOT_MARKED_FROM_HOUR = 11;

const istHour = (at: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(at));

export async function summaryFor(tenantId: string, view: "owner" | "staff", now: Date = new Date()): Promise<ModuleSummary> {
  if (view !== "owner") return { badges: [] };
  const settings = await withTenant(tenantId, (tx) => readSettings(tx, tenantId));
  if (settings?.lat == null || !settings.qrKeyHash) return { badges: [{ text: "Set location & QR", tone: "warn" }] };
  // the platform's own read-only look at the plant (like PlantOps support: sees everyone, changes nothing)
  const viewer: AtUser = { ...supportUser(tenantId, "00000000-0000-0000-0000-000000000000"), name: "PlantOps launcher" };
  const b = await todayBoard(viewer, now);
  const badges: ModuleSummary["badges"] = [];
  if (b.inside.length) badges.push({ text: `${b.inside.length} in now`, tone: "info" });
  if (b.notMarked.length && istHour(now) >= NOT_MARKED_FROM_HOUR) badges.push({ text: `${b.notMarked.length} not marked today`, tone: "warn" });
  if (b.noExitYesterday.length) badges.push({ text: `${b.noExitYesterday.length} no exit`, tone: "warn" });
  // claims waiting for the owner (docs/SALARY_EXTRAS_PHASE_PLAN.md "Standard pieces"); never money on the launcher
  const claims = await waitingClaims(viewer);
  if (claims) badges.push({ text: `${claims} ${claims === 1 ? "claim" : "claims"} waiting`, tone: "warn" });
  // at most 3 badges (the launcher contract): "in now" makes way first
  if (badges.length > 3) badges.splice(badges.findIndex((x) => x.tone === "info"), 1);
  return { badges: badges.length ? badges.slice(0, 3) : [{ text: "All in order", tone: "ok" }] };
}

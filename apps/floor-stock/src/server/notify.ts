// Floor Stock's app notifications to the plant's owners (docs/notifications.md, N1). The platform picks the people
// (active owners) and leaves out whoever did it; these functions only write the text.
//   * one notification per saved count: low stock > check the count > corrected > saved (most serious wins the title)
//   * setup changed by a store keeper / plant staff: bell only, so building the item list doesn't flood the phone
//   * 8 pm India time: "Today's stock count is not done yet" (the evening job)
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NotificationInput } from "@plantops/types";
import { qty } from "@/lib/compare";
import { istDay, istTime } from "@/lib/days";
import { latestVersion, type SavedCount } from "./counts";
import { stockDb, withTenant } from "./db";
import { kit } from "./kit";
import type { StockUser } from "./session";

const MAX_LISTED = 3;
const BODY_MAX = 300;

/** "11 Oct" for a plant date. */
export const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const clip = (s: string) => (s.length <= BODY_MAX ? s : `${s.slice(0, BODY_MAX - 1)}…`);
function listed<T>(xs: T[], text: (x: T) => string) {
  const shown = xs.slice(0, MAX_LISTED).map(text).join(", ");
  return xs.length > MAX_LISTED ? `${shown} + ${xs.length - MAX_LISTED} more` : shown;
}

/** The one notification for a saved count or correction. */
export function countNotification(user: StockUser, saved: SavedCount): NotificationInput {
  const who =
    saved.version === 1
      ? `${user.name}, ${shortDate(saved.date)}, ${istTime(saved.entered_at)}.`
      : `Corrected by ${user.name} (v${saved.version}): ${saved.reason ?? ""}.`;
  const low = saved.low_items.length ? `Low: ${listed(saved.low_items, (i) => `${i.name} ${qty(i.qty)} (limit ${qty(i.min)})`)}.` : "";
  const check = saved.checks.length ? `Check: ${listed(saved.checks, (c) => `${c.name} (${qty(c.extra)} ${c.unit} more than possible)`)}.` : "";

  let kind = saved.version === 1 ? "floor_stock.count_saved" : "floor_stock.count_corrected";
  let title = saved.version === 1 ? "Stock count saved" : `Count corrected (v${saved.version})`;
  if (saved.checks.length) {
    kind = "floor_stock.count_check";
    title = `Check the count: ${plural(saved.checks.length, "item")}`;
  }
  if (saved.low_items.length) {
    kind = "floor_stock.low_stock";
    title = `Low stock: ${plural(saved.low_items.length, "item")}`;
  }
  return {
    kind,
    title,
    body: clip([who, low, check].filter(Boolean).join(" ")),
    link: `/day/${saved.date}`,
    level: "push",
    dedupe_key: `count:${saved.date}:v${saved.version}`,
    exclude_user_id: user.userId,
  };
}

const FIELD_WORDS: Record<string, string> = {
  name: "name",
  unit: "unit",
  second_unit: "second number",
  sku_id: "product link",
  section_id: "section",
  min_level: "limit",
};

export type SetupChange =
  | { action: "add"; name: string; section: string }
  | { action: "update"; name: string; before: string; fields: string[]; status?: string }
  | { action: "reorder"; section: string };

/** Setup changed by someone who isn't an owner (owners see their own changes; they get nothing). Bell only. */
export function setupNotification(user: StockUser, change: SetupChange): NotificationInput | null {
  if (user.isOwner || user.isSupport) return null;
  let body: string;
  if (change.action === "add") body = `${user.name} added item "${change.name}" in ${change.section}`;
  else if (change.action === "reorder") body = `${user.name} changed the order of the items in ${change.section}`;
  else {
    if (!change.fields.length) return null;
    const parts: string[] = [];
    if (change.fields.includes("status")) parts.push(change.status === "off" ? "switched it off" : "switched it on");
    if (change.fields.includes("name")) parts.push(`renamed it to "${change.name}"`);
    const other = change.fields.filter((f) => f !== "status" && f !== "name").map((f) => FIELD_WORDS[f] ?? f);
    if (other.length) parts.push(`changed the ${other.join(", ")}`);
    body = `${user.name} ${parts.join(", ")}: "${change.before}"`;
  }
  return {
    kind: "floor_stock.setup_changed",
    title: "Setup changed",
    body: clip(body),
    link: "/setup",
    level: "bell",
    dedupe_key: `setup:${randomUUID()}`,
    exclude_user_id: user.userId,
  };
}

/** The 8 pm reminder for one plant. */
export function missingCountNotification(plant: string, date: string): NotificationInput {
  return {
    kind: "floor_stock.count_missing",
    title: "Today's stock count is not done yet",
    body: `${plant}: today's production and closing stock (${shortDate(date)}) have not been entered.`,
    link: "/count",
    level: "push",
    dedupe_key: `missing:${date}`,
  };
}

/**
 * The evening job: every plant with items set up and no count for today (India date) gets the reminder, once per
 * day (the dedupe key makes a second run harmless). A plant that has switched Floor Stock off is skipped quietly.
 */
export async function runEvening(now = new Date(), notify = kit.notify) {
  const today = istDay(now);
  const { rows } = await stockDb().execute<{ id: string }>(sql`select floor_stock.counting_tenants() as id`);
  const total = { plants: rows.length, reminded: 0, counted: 0, skipped: 0, errors: 0 };
  for (const { id } of rows) {
    try {
      const plan = await kit.plan(id);
      if (plan && !plan.enabled_modules.includes("floor_stock")) {
        total.skipped++;
        continue;
      }
      if (await withTenant(id, (tx) => latestVersion(tx, id, today))) {
        total.counted++;
        continue;
      }
      const plant = (await kit.branding(id))?.name ?? "Your plant";
      const r = await notify(id, missingCountNotification(plant, today));
      if (r) total.reminded++;
      else total.errors++;
    } catch (err) {
      total.errors++;
      console.error("[floor-stock] evening job failed for one plant:", (err as Error).message);
    }
  }
  return total;
}

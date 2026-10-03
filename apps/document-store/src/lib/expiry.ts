// Expiry status and reminder stages (pure, so screens and the server use the same rules).

export type ExpiryKind = "none" | "valid" | "soon" | "today" | "expired";
export const SOON_DAYS = 30;

/** Today in India as YYYY-MM-DD. */
export const todayIst = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Whole days from `today` to `expiresOn` (both YYYY-MM-DD); negative once expired. */
export function daysLeft(expiresOn: string, today = todayIst()) {
  const ms = Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "Valid" / "Expires in 12 days" / "Expires today" / "Expired 3 days ago" / "No expiry". */
export function expiryStatus(expiresOn: string | null, today = todayIst()): { kind: ExpiryKind; days: number | null; text: string } {
  if (!expiresOn) return { kind: "none", days: null, text: "No expiry" };
  const d = daysLeft(expiresOn, today);
  if (d < 0) return { kind: "expired", days: d, text: `Expired ${-d} day${d === -1 ? "" : "s"} ago` };
  if (d === 0) return { kind: "today", days: 0, text: "Expires today" };
  if (d <= SOON_DAYS) return { kind: "soon", days: d, text: `Expires in ${d} day${d === 1 ? "" : "s"}` };
  return { kind: "valid", days: d, text: "Valid" };
}

/**
 * The reminder stage a document is in today, or null: 30 / 7 / 1 days before, the day itself, then one per week
 * while it stays expired (expired_w1 = 7-13 days after, ...). Only the current stage is ever sent, once.
 */
export function reminderStage(expiresOn: string | null, today = todayIst()): string | null {
  if (!expiresOn) return null;
  const d = daysLeft(expiresOn, today);
  if (d > 30) return null;
  if (d > 7) return "d30";
  if (d > 1) return "d7";
  if (d === 1) return "d1";
  if (d > -7) return "d0"; // the expiry day - or the first run after it (a missed day or a document added late)
  return `expired_w${Math.floor(-d / 7)}`;
}

export const STAGE_TEXT: Record<string, string> = { d30: "30 days before", d7: "7 days before", d1: "1 day before", d0: "on expiry" };
export const stageText = (stage: string) => STAGE_TEXT[stage] ?? `${stage.replace("expired_w", "")} week(s) after expiry`;

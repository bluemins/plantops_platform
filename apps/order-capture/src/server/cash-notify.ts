// The cash book's app notifications (docs/CASHBOOK_PHASE_PLAN.md section 4). The PLATFORM picks the people (the plant's
// owners + those ticked "Gets Sales alerts", each re-checked) and leaves out whoever acted; these functions only write
// the text. None is urgent: each person can mute or downgrade them.
//   cash_closed (bell)  ·  cash_short (phone, a count off by ₹100 or more)  ·  cash_expense (phone, ₹2,000 or more)
//   cash_not_closed (phone, daily job 07:00 IST)
import type { NotificationInput } from "@plantops/types";
import { BIG_EXPENSE, differenceText, KIND_LABEL, paise, SHORT_ALERT, signedMoney } from "@/lib/cash";
import type { SavedClose, SavedEntry } from "./cash";
import { cashTenantIds } from "./cash-tenants";
import { notClosedPlants } from "./cash";
import { kit } from "./kit";
import type { OcUser } from "./session";

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const sheet = (d: string) => `/cash?d=${d}`;

/** A day closed: always one bell; a count off by ₹100 or more is also a phone alert. */
export function closeNotifications(user: OcUser, c: SavedClose): NotificationInput[] {
  const diff = paise(c.difference);
  const out: NotificationInput[] = [
    {
      kind: "order_capture.cash_closed",
      title: clip(`Cash in hand ${signedMoney(paise(c.counted))} (${day(c.date)})`, 80),
      body: clip(`${c.version > 1 ? "Close corrected" : "Closed"} by ${user.name} · ${differenceText(diff)}`, 300),
      link: sheet(c.date),
      level: "bell",
      dedupe_key: `cash_closed:${c.id}`,
      exclude_user_id: user.userId,
    },
  ];
  if (diff >= SHORT_ALERT || -diff >= SHORT_ALERT)
    out.push({
      kind: "order_capture.cash_short",
      title: clip(`Cash ${differenceText(diff).toLowerCase()} on ${day(c.date)}`, 80),
      body: clip(`Expected ${signedMoney(paise(c.expected))}, counted ${signedMoney(paise(c.counted))} (by ${user.name})`, 300),
      link: sheet(c.date),
      level: "push",
      dedupe_key: `cash_short:${c.id}`,
      exclude_user_id: user.userId,
    });
  return out;
}

/** An expense of ₹2,000 or more: owners on the phone. */
export function expenseNotification(user: OcUser, e: SavedEntry): NotificationInput | null {
  if (e.kind !== "expense" || paise(e.amount) < BIG_EXPENSE) return null;
  const what = [e.paid_to, e.note].filter(Boolean).join(" · ");
  return {
    kind: "order_capture.cash_expense",
    title: clip(`Expense ${signedMoney(paise(e.amount))}: ${e.category ?? KIND_LABEL.expense}`, 80),
    body: clip(`${what ? `${what} ` : ""}(${e.ref}, by ${user.name})`, 300),
    link: sheet(e.cash_date),
    level: "push",
    dedupe_key: `cash_expense:${e.id}`,
    exclude_user_id: user.userId,
  };
}

/** Daily job: entries after the last close, up to yesterday, with no close yet. Once per plant per day. */
export async function runCashNotClosed(today?: string) {
  let sent = 0;
  for (const p of await notClosedPlants(cashTenantIds, today)) {
    const days = p.days.map(day).join(", ");
    await kit.notify(p.tenantId, {
      kind: "order_capture.cash_not_closed",
      title: clip(`Cash book not closed: ${days}`, 80),
      body: clip(`Count the cash and close the day. Last close: ${day(p.since)}.`, 300),
      link: sheet(p.days.at(-1)!),
      level: "push",
      dedupe_key: `cash_not_closed:${p.yesterday}`,
    });
    sent++;
  }
  return { plants: sent };
}

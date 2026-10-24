

### 2026-10-24 — WhatsApp reorder reminders (WhatsApp Step 4, v0.31.0)
Design `docs/WHATSAPP_BUILD_PLAN.md` section 9 (owner "build" 2026-10-24); pilot rules: contract checklist 6.
**Order Capture sends the reminder itself** (owner's choice over the delivered-event design of contract 3.5): no event
outbox, no event secret, no 15-minute job.
- **Migration `0005_reminders.sql`** (approved): `customer_consents` (append-only; newest row = the answer; sources
  bot_after_order / staff_phone / whatsapp_stop / whatsapp_start / reminder_button; wording `optin-v1`; kept forever),
  `reminder_groups` (append-only, one per customer), `customer_messages` kind `reorder_reminder`, status `skipped` +
  `skip_reason`. `order_app` SELECT + INSERT on the new tables; `reminder_tenants()`.
- **`src/server/consent.ts`:** newest answer; the same answer twice writes nothing; a stop needs a yes first.
- **Staff tick** (Customers → Edit, owner + Order desk, access row `consent`): consent row `staff_phone` + Recent
  changes line; the list shows a "Reminders" tag.
- **Bot API** `POST /api/bot/v1/consent`: source decides the possible answers; a yes needs the customer switched on;
  START only restores a WhatsApp stop (never a first yes, never a staff untick); unknown phone = `recorded: false`.
  Context answer + `reminders`, `reminders_on`.
- **`src/server/reminders.ts`** + `POST /api/cron/reminders`: orders delivered 15 India days ago (catch-up 2 days, from
  the pilot start); checked in order: pilot over, customer off, no consent, newer order, a reminder in the last 14 days,
  pilot full, holdout (30 %, drawn once), budget. The row is written `pending` before Twilio is called; never retried.
  Template `{{1}}` name, `{{2}}` "5 box Bluemins 1L, …". A Twilio 4xx stops the plant's reminders for this pilot +
  kind `order_capture.reminder_failed` (owners, phone + bell).
- **The thank-you sender only sends thank-yous** (`sendPending` filters on kind).
- **`/reminders` page** (access row `reminder_pilot`: owner, support): settings, groups, due / sent / skipped by reason,
  ordered again within 7 / 14 days per group (the reminded order itself excluded), opt-outs of pilot customers, cost,
  the stop rules.
- **Settings:** `ORDER_REMINDERS`, `REMINDER_PILOT_START`, `REMINDER_PILOT_CUSTOMERS` (100), `REMINDER_COST_PAISE`
  (100), `REMINDER_BUDGET_PAISE` (50000); `reminder_content_sid` in the plant's `TWILIO_WHATSAPP_SENDERS` entry.
- **Made while building:** an unreachable Twilio marks that reminder failed (not retried, as the thank-you's "late is
  worse than none"); the "no open complaint" check is not in the pilot (no module-to-module lookup yet).
- **Tests:** Order Capture 343 (+23: `test/reminders.test.ts`, access rows, append-only and isolation guards).

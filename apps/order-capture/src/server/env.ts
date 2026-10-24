// Settings come from environment variables only (CLAUDE.md). Read lazily, so tests can set them first.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

/** A whole number above 0 from a setting, else the default. */
function positive(v: string | undefined, fallback: number) {
  const n = Number((v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const env = {
  get platformUrl() {
    return required("PLATFORM_URL");
  },
  /** This module's client secret; the platform stores only its hash (super_admin > Modules). */
  get clientSecret() {
    return required("MODULE_SECRET_ORDER_CAPTURE");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("ORDER_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("ORDER_DATABASE_URL_APP");
  },
  get secureCookies() {
    return (process.env.MODULE_URL_ORDER_CAPTURE ?? "").startsWith("https://");
  },
  /** shared secret the scheduler sends to POST /api/cron/*; those endpoints are off without it */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  /** WhatsApp thank-you on "Delivered" (src/server/thanks.ts): the Twilio account; off without both. */
  get twilioAccountSid() {
    return process.env.TWILIO_ACCOUNT_SID ?? "";
  },
  get twilioAuthToken() {
    return process.env.TWILIO_AUTH_TOKEN ?? "";
  },
  /** JSON {"<plant id>": {"from": "whatsapp:+91…", "content_sid": "HX…"}}; a plant not listed has no tick box. */
  get twilioWhatsappSenders() {
    return process.env.TWILIO_WHATSAPP_SENDERS ?? "";
  },
  /**
   * WhatsApp bot keys (src/server/bot.ts, docs/WHATSAPP_CONTRACT.md 3.6): JSON
   * [{"id","tenant_id","sha256","label","products":["PV_BM_1",…]}]. Only the key's SHA-256 is here; empty = bot API off.
   */
  get botKeys() {
    return process.env.ORDER_BOT_KEYS ?? "";
  },
  /** "off" = the bot may not create orders (403 ordering_off); its reads and alerts keep working */
  get botOrdersOff() {
    return (process.env.ORDER_BOT_ORDERS ?? "").trim().toLowerCase() === "off";
  },
  /**
   * WhatsApp reorder reminders (src/server/reminders.ts, WhatsApp Step 4). Nothing is sent unless ORDER_REMINDERS=on,
   * REMINDER_PILOT_START is a date and the plant's TWILIO_WHATSAPP_SENDERS entry has a reminder_content_sid.
   */
  get remindersOn() {
    return (process.env.ORDER_REMINDERS ?? "").trim().toLowerCase() === "on";
  },
  /** YYYY-MM-DD: deliveries from this India day count; the pilot ends 8 weeks later */
  get reminderPilotStart() {
    const v = (process.env.REMINDER_PILOT_START ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  },
  /** customers in the pilot (both groups), default 100 */
  get reminderPilotCustomers() {
    return positive(process.env.REMINDER_PILOT_CUSTOMERS, 100);
  },
  /** Twilio's price of one reminder in paise (checked before the start), default 100 (₹1) */
  get reminderCostPaise() {
    return positive(process.env.REMINDER_COST_PAISE, 100);
  },
  /** the pilot's budget in paise, default 50000 (₹500) */
  get reminderBudgetPaise() {
    return positive(process.env.REMINDER_BUDGET_PAISE, 50_000);
  },
  /** only tests change it (a fake Twilio) */
  get twilioApiUrl() {
    return process.env.TWILIO_API_URL ?? "https://api.twilio.com";
  },
};

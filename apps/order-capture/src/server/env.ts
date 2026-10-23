// Settings come from environment variables only (CLAUDE.md). Read lazily, so tests can set them first.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
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
  /** only tests change it (a fake Twilio) */
  get twilioApiUrl() {
    return process.env.TWILIO_API_URL ?? "https://api.twilio.com";
  },
};

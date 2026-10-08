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
    return required("MODULE_SECRET_FLOOR_STOCK");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("STOCK_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("STOCK_DATABASE_URL_APP");
  },
  get secureCookies() {
    return (process.env.MODULE_URL_FLOOR_STOCK ?? "").startsWith("https://");
  },
  /** shared secret the scheduler sends to POST /api/cron/daily; the endpoint is off without it */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};

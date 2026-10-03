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
    return required("MODULE_SECRET_LAB_RECORDS");
  },
  /** Signs this module's own session cookie. Never the platform's key. */
  get sessionSecret() {
    return required("LAB_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("LAB_DATABASE_URL_APP");
  },
  /** Secure cookies when the module itself is served over https. */
  get secureCookies() {
    return (process.env.MODULE_URL_LAB_RECORDS ?? "").startsWith("https://");
  },
};

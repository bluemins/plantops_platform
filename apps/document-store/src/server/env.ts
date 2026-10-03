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
    return required("MODULE_SECRET_DOCUMENT_STORE");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("DOC_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("DOC_DATABASE_URL_APP");
  },
  get secureCookies() {
    return (process.env.MODULE_URL_DOCUMENT_STORE ?? "").startsWith("https://");
  },
  // ---------- files ----------
  /** Where uploaded files are kept on this server (development / single server). */
  get storageDir() {
    return process.env.DOC_STORAGE_DIR || new URL("../../.data/documents", `file://${process.cwd()}/`).pathname;
  },
  /** S3-compatible storage (production): bucket + endpoint + keys. When STORAGE_BUCKET is set, files go there. */
  get storageBucket() {
    return process.env.STORAGE_BUCKET ?? "";
  },
  get storageEndpoint() {
    return process.env.STORAGE_ENDPOINT ?? "https://s3.ap-south-1.amazonaws.com";
  },
  get storageRegion() {
    return process.env.STORAGE_REGION ?? "ap-south-1";
  },
  get storageAccessKey() {
    return process.env.STORAGE_ACCESS_KEY_ID ?? "";
  },
  get storageSecretKey() {
    return process.env.STORAGE_SECRET_ACCESS_KEY ?? "";
  },
  // ---------- email (optional until set up) ----------
  get smtpHost() {
    return process.env.SMTP_HOST ?? "";
  },
  get smtpPort() {
    return Number(process.env.SMTP_PORT ?? 587);
  },
  get smtpUser() {
    return process.env.SMTP_USER ?? "";
  },
  get smtpPass() {
    return process.env.SMTP_PASS ?? "";
  },
  /** e.g. "PlantOps <reminders@plantops.in>" */
  get mailFrom() {
    return process.env.MAIL_FROM ?? "";
  },
  /** shared secret the scheduler sends to POST /api/cron/daily; the endpoint is off without it */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};

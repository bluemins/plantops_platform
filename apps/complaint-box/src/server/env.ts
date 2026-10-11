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
    return required("MODULE_SECRET_COMPLAINT_BOX");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("COMPLAINT_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("COMPLAINT_DATABASE_URL_APP");
  },
  get secureCookies() {
    return (process.env.MODULE_URL_COMPLAINT_BOX ?? "").startsWith("https://");
  },
  // ---------- files (this module's OWN folder / bucket, never Document Store's) ----------
  /** Where photos and videos are kept on this server (development / a single server with a volume). */
  get storageDir() {
    return process.env.COMPLAINT_STORAGE_DIR || new URL("../../.data/complaints", `file://${process.cwd()}/`).pathname;
  },
  /** S3-compatible storage: when COMPLAINT_STORAGE_BUCKET is set, files go there (same provider settings as Document Store). */
  get storageBucket() {
    return process.env.COMPLAINT_STORAGE_BUCKET ?? "";
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
  /** shared secret the scheduler sends to POST /api/cron/*; those endpoints are off without it */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};

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
    return required("MODULE_SECRET_ATTENDANCE_SALARY");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("ATTEND_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("ATTEND_DATABASE_URL_APP");
  },
  /** This app's public address (the link inside the printed QR); blank in development = the address in use. */
  get publicUrl() {
    return process.env.MODULE_URL_ATTENDANCE_SALARY ?? "";
  },
  get secureCookies() {
    return (process.env.MODULE_URL_ATTENDANCE_SALARY ?? "").startsWith("https://");
  },
  // ---------- bill photos of expense claims (this module's OWN folder / bucket, never another module's) ----------
  /** Where bill photos are kept on this server (development / a single server with a volume at /data). */
  get storageDir() {
    return process.env.ATTEND_STORAGE_DIR || new URL("../../.data/attendance", `file://${process.cwd()}/`).pathname;
  },
  /** S3-compatible storage: when ATTEND_STORAGE_BUCKET is set, photos go there (same provider settings as Complaint Box). */
  get storageBucket() {
    return process.env.ATTEND_STORAGE_BUCKET ?? "";
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
  /** shared secret the scheduler sends to POST /api/cron/* (Phase 6); those endpoints are off without it */
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};

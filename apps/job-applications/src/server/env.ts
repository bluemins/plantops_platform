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
    return required("MODULE_SECRET_JOB_APPLICATIONS");
  },
  /** Signs this module's own cookies. Never the platform's key. */
  get sessionSecret() {
    return required("JOBS_SESSION_SECRET");
  },
  get databaseUrl() {
    return required("JOBS_DATABASE_URL_APP");
  },
  get secureCookies() {
    return (process.env.MODULE_URL_JOB_APPLICATIONS ?? "").startsWith("https://");
  },
  /** The plant whose job page is at the bare address (jobs.bluemins.life/). Unset = that address shows "not available". */
  get defaultPlant() {
    return (process.env.JOBS_DEFAULT_PLANT ?? "").trim().toUpperCase();
  },
  // ---------- resume files (this module's OWN folder / bucket, never another module's) ----------
  /** Where resumes are kept on this server (development / a single server with a volume). */
  get storageDir() {
    return process.env.JOBS_STORAGE_DIR || new URL("../../.data/jobs", `file://${process.cwd()}/`).pathname;
  },
  /** S3-compatible storage: when JOBS_STORAGE_BUCKET is set, files go there (same provider settings as Document Store). */
  get storageBucket() {
    return process.env.JOBS_STORAGE_BUCKET ?? "";
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
  // ---------- Cloudflare Turnstile (free spam check on the public form; off until both are set) ----------
  get turnstileSiteKey() {
    return process.env.TURNSTILE_SITE_KEY ?? "";
  },
  get turnstileSecret() {
    return process.env.TURNSTILE_SECRET ?? "";
  },
  /** Cloudflare's check address (tests point it at a fake server). */
  get turnstileVerifyUrl() {
    return process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  },
  /** This app's public address, for the link and QR the owner shares (falls back to the address the page was opened on). */
  get publicUrl() {
    return (process.env.MODULE_URL_JOB_APPLICATIONS ?? "").replace(/\/+$/, "");
  },
};

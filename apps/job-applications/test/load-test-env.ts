import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_JOBS_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh job_applications jobs_app JOBS 3007 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.JOBS_DATABASE_URL_APP = process.env.TEST_JOBS_DATABASE_URL_APP;
  process.env.MODULE_SECRET_JOB_APPLICATIONS = "jobs-module-test-secret";
  process.env.JOBS_SESSION_SECRET = "job-applications-test-session-secret-0123456789";
  process.env.JOBS_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "plantops-jobs-test-"));
  process.env.CRON_SECRET = "jobs-cron-test-secret";
  for (const k of ["MODULE_URL_JOB_APPLICATIONS", "JOBS_STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "JOBS_DEFAULT_PLANT", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET", "TURNSTILE_VERIFY_URL"]) delete process.env[k];
  for (const k of ["BACKUP_BUCKET", "BACKUP_ENDPOINT", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_RECIPIENT"]) delete process.env[k];
}

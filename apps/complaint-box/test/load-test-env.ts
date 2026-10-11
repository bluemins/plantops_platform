import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_COMPLAINT_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh complaint_box complaint_app COMPLAINT 3004 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.COMPLAINT_DATABASE_URL_APP = process.env.TEST_COMPLAINT_DATABASE_URL_APP;
  process.env.MODULE_SECRET_COMPLAINT_BOX = "complaint-module-test-secret";
  process.env.COMPLAINT_SESSION_SECRET = "complaint-box-test-session-secret-0123456789";
  process.env.COMPLAINT_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "plantops-complaints-test-"));
  for (const k of ["COMPLAINT_STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) delete process.env[k];
  for (const k of ["MODULE_URL_COMPLAINT_BOX", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "BREVO_API_KEY"]) delete process.env[k];
}

import { existsSync } from "node:fs";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch the dev database. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_LAB_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-lab-db.sh once (see README).`);
  }
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.LAB_DATABASE_URL_APP = process.env.TEST_LAB_DATABASE_URL_APP;
  // Tests use their own secrets and a fake platform (test/fake-platform.ts), never the dev ones.
  process.env.MODULE_SECRET_LAB_RECORDS = "lab-module-test-secret";
  process.env.LAB_SESSION_SECRET = "lab-records-test-session-secret-0123456789";
  delete process.env.MODULE_URL_LAB_RECORDS;
}

import { existsSync } from "node:fs";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_ATTEND_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh attendance_salary attendance_app ATTEND 3006 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.ATTEND_DATABASE_URL_APP = process.env.TEST_ATTEND_DATABASE_URL_APP;
  process.env.MODULE_SECRET_ATTENDANCE_SALARY = "attendance-module-test-secret";
  process.env.ATTEND_SESSION_SECRET = "attendance-test-session-secret-0123456789abc";
  delete process.env.MODULE_URL_ATTENDANCE_SALARY;
  // no real platform in tests: a closed port answers "unreachable" at once; tests that need one start the fake platform
  process.env.PLATFORM_URL = "http://127.0.0.1:9";
}

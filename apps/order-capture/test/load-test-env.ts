import { existsSync } from "node:fs";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_ORDER_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh order_capture order_app ORDER 3005 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.ORDER_DATABASE_URL_APP = process.env.TEST_ORDER_DATABASE_URL_APP;
  process.env.MODULE_SECRET_ORDER_CAPTURE = "order-module-test-secret";
  process.env.ORDER_SESSION_SECRET = "order-capture-test-session-secret-0123456789";
  delete process.env.MODULE_URL_ORDER_CAPTURE;
}

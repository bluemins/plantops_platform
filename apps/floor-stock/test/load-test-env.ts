import { existsSync } from "node:fs";
import path from "node:path";

/** Points the module at the *test* database. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_STOCK_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh floor_stock stock_app STOCK 3002 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.STOCK_DATABASE_URL_APP = process.env.TEST_STOCK_DATABASE_URL_APP;
  process.env.MODULE_SECRET_FLOOR_STOCK = "stock-module-test-secret";
  process.env.STOCK_SESSION_SECRET = "floor-stock-test-session-secret-0123456789";
  for (const k of ["MODULE_URL_FLOOR_STOCK", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "BREVO_API_KEY"]) delete process.env[k];
}

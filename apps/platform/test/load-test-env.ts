import { existsSync } from "node:fs";
import path from "node:path";

/** Points the app at the *test* database. Tests never touch the dev database. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_DATABASE_URL_APP", "TEST_DATABASE_URL_SUPER"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-local-db.sh once (see README).`);
  }
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.DATABASE_URL_APP = process.env.TEST_DATABASE_URL_APP;
  process.env.DATABASE_URL_SUPER = process.env.TEST_DATABASE_URL_SUPER;
  process.env.PLATFORM_URL ??= "http://localhost:3000";
}

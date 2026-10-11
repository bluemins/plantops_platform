import { existsSync } from "node:fs";
import path from "node:path";

// PLANTOPS_ENV_FILE (set by scripts/railway-migrate.sh) points at one hosted copy's file, read instead of the
// local .env so no local value can reach that copy.
const envFile = process.env.PLANTOPS_ENV_FILE ?? path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
else if (process.env.PLANTOPS_ENV_FILE) throw new Error(`PLANTOPS_ENV_FILE not found: ${envFile}`);

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

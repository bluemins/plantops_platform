import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root serves every app (CLAUDE.md: config via environment variables).
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  output: "standalone", // small self-contained server for the Docker image
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@plantops/auth", "@plantops/db", "@plantops/types", "@plantops/ui"],
  serverExternalPackages: ["@node-rs/argon2", "pg"],
};

export default config;

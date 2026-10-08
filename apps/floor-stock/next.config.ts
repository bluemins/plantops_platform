import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root serves every app in development (CLAUDE.md: config via environment variables).
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Phone testing on the same Wi-Fi (pnpm dev:lan): accept the PC's Wi-Fi address, taken from PLATFORM_URL.
const platformHost = process.env.PLATFORM_URL ? new URL(process.env.PLATFORM_URL).hostname : "localhost";

const config: NextConfig = {
  allowedDevOrigins: platformHost === "localhost" ? [] : [platformHost],
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@plantops/auth", "@plantops/db", "@plantops/module-kit", "@plantops/types", "@plantops/ui"],
  serverExternalPackages: ["pg"],
};

export default config;

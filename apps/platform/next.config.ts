import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root serves every app (CLAUDE.md: config via environment variables).
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Phone testing on the same Wi-Fi (pnpm dev:lan): the dev server must accept the PC's Wi-Fi address,
// taken from PLATFORM_URL (e.g. http://192.168.1.20:3000). Only affects `next dev`.
const platformHost = process.env.PLATFORM_URL ? new URL(process.env.PLATFORM_URL).hostname : "localhost";

const config: NextConfig = {
  allowedDevOrigins: platformHost === "localhost" ? [] : [platformHost],
  output: "standalone", // small self-contained server for the Docker image
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@plantops/auth", "@plantops/db", "@plantops/types", "@plantops/ui"],
  serverExternalPackages: ["@node-rs/argon2", "pg", "web-push"],
  // The notification service worker must never be served from a stale cache, or phones keep an old version.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "cache-control", value: "no-cache" }, { key: "content-type", value: "application/javascript; charset=utf-8" }] }];
  },
};

export default config;

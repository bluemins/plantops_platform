import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    setupFiles: ["test/setup-env.ts"],
    globalSetup: ["test/global-setup.ts"],
    // All tests share one real Postgres test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

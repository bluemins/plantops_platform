/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Konsta's Material colour maker isn't in its package exports; an alias reaches the file directly, so the app can
// build the full Material palette from the plant's own brand colour while it runs (no brand colour in the code).
const mdColors = fileURLToPath(new URL("./node_modules/konsta/color-utils/md-colors.js", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: { alias: { "konsta-md-colors": mdColors } },
  test: { environment: "jsdom", include: ["test/**/*.test.ts?(x)"] },
});

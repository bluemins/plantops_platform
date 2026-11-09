import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "life.bluemins.drop",
  appName: "Drop",
  webDir: "dist",
  // native HTTP: the app's calls to Sales go through Android, not the web view, so no cross-site (CORS) rule applies
  plugins: { CapacitorHttp: { enabled: true } },
  android: { allowMixedContent: false },
};

export default config;

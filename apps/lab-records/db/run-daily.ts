// Runs the morning job by hand (development, or a server cron line): pnpm --filter @plantops/lab-records daily
import { requireEnv } from "./load-env";

const res = await fetch(new URL("/api/cron/daily", requireEnv("MODULE_URL_LAB_RECORDS")), {
  method: "POST",
  headers: { "x-cron-secret": requireEnv("CRON_SECRET") },
});
console.log(res.status, await res.text());

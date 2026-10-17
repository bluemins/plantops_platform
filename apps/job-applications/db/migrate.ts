// Applies new Job applications migrations (schema job_applications) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "job_applications", path.join(import.meta.dirname, "migrations"));
console.log("Job applications migrations up to date.");

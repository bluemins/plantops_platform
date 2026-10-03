// Applies new Lab Records migrations (schema lab_records) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "lab_records", path.join(import.meta.dirname, "migrations"));
console.log("Lab Records migrations up to date.");

// Applies new Attendance migrations (schema attendance_salary) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "attendance_salary", path.join(import.meta.dirname, "migrations"));
console.log("Attendance migrations up to date.");

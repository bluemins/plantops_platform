// Applies new Complaint Box migrations (schema complaint_box) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "complaint_box", path.join(import.meta.dirname, "migrations"));
console.log("Complaint Box migrations up to date.");

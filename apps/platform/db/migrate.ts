// Applies new SQL migrations as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "platform", path.join(import.meta.dirname, "migrations"));
console.log("Migrations up to date.");

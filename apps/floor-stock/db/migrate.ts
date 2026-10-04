// Applies new Floor Stock migrations (schema floor_stock) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "floor_stock", path.join(import.meta.dirname, "migrations"));
console.log("Floor Stock migrations up to date.");

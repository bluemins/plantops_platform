// Applies new Document Store migrations (schema lab_records) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "document_store", path.join(import.meta.dirname, "migrations"));
console.log("Document Store migrations up to date.");

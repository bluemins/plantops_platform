// Applies new Order Capture migrations (schema order_capture) as the owner login. Usage: pnpm db:migrate
import path from "node:path";
import { migrate } from "@plantops/db";
import { requireEnv } from "./load-env";

await migrate(requireEnv("DATABASE_URL_OWNER"), "order_capture", path.join(import.meta.dirname, "migrations"));
console.log("Order Capture migrations up to date.");

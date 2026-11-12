import { cashbookKeysProblem } from "@/server/cashbook";
import { databaseReachable } from "@/server/db";

/** For monitoring: is the app up, and can it reach its database with the attendance_app login? Broken settings are listed under `warnings` (still 200). */
export async function GET() {
  const db = await databaseReachable();
  const warnings = [cashbookKeysProblem()].filter((w): w is string => w !== null);
  return Response.json({ ok: db, module: "attendance_salary", database: db ? "ok" : "unreachable", ...(warnings.length ? { warnings } : {}) }, { status: db ? 200 : 503 });
}

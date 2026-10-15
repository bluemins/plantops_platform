import { databaseReachable } from "@/server/db";

/** For monitoring: is the app up, and can it reach its database with the attendance_app login? */
export async function GET() {
  const db = await databaseReachable();
  return Response.json({ ok: db, module: "attendance_salary", database: db ? "ok" : "unreachable" }, { status: db ? 200 : 503 });
}

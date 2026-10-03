import { databaseReachable } from "@/server/db";

/** For monitoring: is the app up, and can it reach its database with the doc_app login? */
export async function GET() {
  const db = await databaseReachable();
  return Response.json({ ok: db, module: "document_store", database: db ? "ok" : "unreachable" }, { status: db ? 200 : 503 });
}

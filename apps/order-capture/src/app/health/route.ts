import { botKeysProblem } from "@/server/bot";
import { databaseReachable } from "@/server/db";
import { whatsappSettingsProblem } from "@/server/thanks";

/**
 * For monitoring: is the app up, and can it reach its database with the order_app login? `warnings` lists broken
 * settings (WhatsApp senders, bot keys) that switch a feature off without stopping the app; check it after any
 * Railway variable change. They never turn the answer into a 503 (the app itself is fine).
 */
export async function GET() {
  const db = await databaseReachable();
  const warnings = [whatsappSettingsProblem(), botKeysProblem()].filter((w): w is string => w !== null);
  return Response.json({ ok: db, module: "order_capture", database: db ? "ok" : "unreachable", warnings }, { status: db ? 200 : 503 });
}

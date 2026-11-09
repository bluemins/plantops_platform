import { fcmProblem } from "@/server/drop/fcm";
import { botKeysProblem } from "@/server/bot";
import { callKeysProblem } from "@/server/calls";
import { databaseReachable } from "@/server/db";
import { dropSettingsProblem } from "@/server/drop/config";
import { whatsappSettingsProblem } from "@/server/thanks";

/**
 * For monitoring: is the app up, and can it reach its database with the order_app login? `warnings` lists broken
 * settings (WhatsApp senders, bot keys, phone keys, Drop) that switch a feature off without stopping the app; check it after any
 * Railway variable change. They never turn the answer into a 503 (the app itself is fine).
 */
export async function GET() {
  const db = await databaseReachable();
  const warnings = [whatsappSettingsProblem(), botKeysProblem(), callKeysProblem(), dropSettingsProblem(), fcmProblem()].filter((w): w is string => w !== null);
  return Response.json({ ok: db, module: "order_capture", database: db ? "ok" : "unreachable", warnings }, { status: db ? 200 : 503 });
}

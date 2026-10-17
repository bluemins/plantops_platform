import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runMorning } from "@/server/notify";

/**
 * The not-marked job (hourly 08:00-11:00 IST): resends notifications that waited in the outbox, then tells each
 * plant's owners and supervisors who hasn't marked by the plant's alert hour (docs/ATTENDANCE_ROLES_PHASE_PLAN.md).
 * Called by the scheduler with CRON_SECRET - never by browsers.
 */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The morning job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runMorning());
}

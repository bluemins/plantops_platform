import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runReminders } from "@/server/reminders";

/**
 * WhatsApp reorder reminders (cron-job.org, daily 10:30 IST). Sends nothing unless ORDER_REMINDERS=on. Called by the
 * scheduler with CRON_SECRET - never by browsers.
 */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The reminder job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runReminders());
}

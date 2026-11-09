import { timingSafeEqual } from "node:crypto";
import { runPushJob } from "@/server/drop/push";
import { env } from "@/server/env";

/**
 * The Drop push job (cron-job.org, every 5 minutes): pushes for polls that have opened, then each plant's waiting pushes
 * (200 per plant per run), retries and give-ups. Called by the scheduler with CRON_SECRET - never by browsers.
 */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The push job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runPushJob());
}

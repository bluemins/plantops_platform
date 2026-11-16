import { timingSafeEqual } from "node:crypto";
import { runDayReport } from "@/server/day-report-job";
import { env } from "@/server/env";

/** The evening Day report notification (21:00 IST, cron-job.org), owners only. Called with CRON_SECRET - never by browsers. */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The day report job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDayReport());
}

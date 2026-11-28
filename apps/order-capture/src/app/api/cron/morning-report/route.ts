import { timingSafeEqual } from "node:crypto";
import { runMorningReport } from "@/server/morning-report-job";
import { env } from "@/server/env";

/** The morning report (08:30 IST, cron-job.org row 15), owners only. Safe to run twice. Called with CRON_SECRET - never by browsers. */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The morning report job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runMorningReport());
}

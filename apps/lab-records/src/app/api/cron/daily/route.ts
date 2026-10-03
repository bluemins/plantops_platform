import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDaily } from "@/server/reminders";

/** The morning job. Called by the server's scheduler (cron) with the CRON_SECRET header - never by browsers. */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The daily job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDaily());
}

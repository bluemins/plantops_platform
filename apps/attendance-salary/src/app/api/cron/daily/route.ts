import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDaily } from "@/server/notify";

/**
 * The morning job (07:00 IST): resends notifications that waited in the outbox, then tells each plant's owners who
 * didn't mark OUT yesterday.
 * Called by the scheduler with CRON_SECRET - never by browsers.
 */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The daily job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDaily());
}

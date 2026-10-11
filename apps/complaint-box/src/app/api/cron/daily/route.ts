import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { runDaily } from "@/server/notify";

/**
 * The morning job: resends notifications that waited in the outbox, then reminds about complaints still open (3 days
 * after opening / reopening, then every 7 days). Called by the scheduler with CRON_SECRET - never by browsers.
 */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The daily job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDaily());
}

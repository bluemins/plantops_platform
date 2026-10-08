import { timingSafeEqual } from "node:crypto";
import { runDaily } from "@/server/alerts";
import { env } from "@/server/env";

/** The morning job: sends low-stock emails still waiting. Called by the scheduler with CRON_SECRET - never by browsers. */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The daily job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDaily());
}

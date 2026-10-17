import { timingSafeEqual } from "node:crypto";
import { runDaily } from "@/server/daily";
import { env } from "@/server/env";

/** The daily job (GitHub Actions): only with the shared CRON_SECRET; off when it isn't set. */
export async function POST(req: Request) {
  const secret = env.cronSecret;
  if (!secret) return Response.json({ error: "The daily job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  return Response.json(await runDaily());
}

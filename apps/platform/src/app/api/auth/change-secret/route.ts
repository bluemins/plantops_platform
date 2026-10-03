import { z } from "zod";
import { changeSecret, requireUser } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

export const POST = handle(async (req) => {
  const user = await requireUser(req, { allowMustChange: true });
  const body = await readJson(req, Body);
  await changeSecret(user, body.current, body.next);
  return json({ ok: true });
});

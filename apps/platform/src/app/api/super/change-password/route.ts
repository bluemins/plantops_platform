import { z } from "zod";
import { handle, json, readJson } from "@/server/http";
import { changeSuperAdminPassword, requireSuperAdmin } from "@/server/super-auth";

const Body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const body = await readJson(req, Body);
  await changeSuperAdminPassword(req, admin, body.current, body.next);
  return json({ ok: true });
});

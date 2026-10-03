import { z } from "zod";
import { clientIp, handle, json, rateLimit, readJson } from "@/server/http";
import { loginSuperAdmin, superCookie } from "@/server/super-auth";

const Body = z.object({ email: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) });

export const POST = handle(async (req) => {
  rateLimit(`super-login:${clientIp(req)}`, 10, 5 * 60_000);
  const body = await readJson(req, Body);
  const token = await loginSuperAdmin(body.email, body.password);
  return json({ ok: true }, { headers: { "set-cookie": superCookie(token) } });
});

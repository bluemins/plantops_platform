import { z } from "zod";
import { loginUser, sessionCookie } from "@/server/auth";
import { clientIp, handle, json, rateLimit, readJson } from "@/server/http";

const Body = z.object({
  plant_code: z.string().trim().min(1).max(32),
  username: z.string().trim().min(1).max(40),
  secret: z.string().min(1).max(200),
});

export const POST = handle(async (req) => {
  rateLimit(`login:${clientIp(req)}`, 20, 5 * 60_000);
  const body = await readJson(req, Body);
  const result = await loginUser({ plantCode: body.plant_code, username: body.username, secret: body.secret });
  return json({ must_change_secret: result.mustChangeSecret }, { headers: { "set-cookie": sessionCookie(result.cookieValue) } });
});

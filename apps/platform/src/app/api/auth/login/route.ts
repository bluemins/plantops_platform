import { z } from "zod";
import { loginUser, loginVia, readSessionCookie, sessionCookie } from "@/server/auth";
import { describeClient } from "@/server/client-info";
import { clientIp, handle, json, rateLimit, readJson } from "@/server/http";

const Body = z.object({
  plant_code: z.string().trim().min(1).max(32),
  username: z.string().trim().min(1).max(40),
  secret: z.string().min(1).max(200),
  // for the login record only (B-03): the login page runs as the installed app? and the `next` it was opened with
  installed: z.boolean().optional(),
  next: z.string().max(2000).optional(),
});

export const POST = handle(async (req) => {
  rateLimit(`login:${clientIp(req)}`, 20, 5 * 60_000);
  const body = await readJson(req, Body);
  const result = await loginUser({
    plantCode: body.plant_code,
    username: body.username,
    secret: body.secret,
    context: {
      ...describeClient(req.headers.get("user-agent")),
      app: body.installed === undefined ? "unknown" : body.installed ? "installed" : "browser",
      ...loginVia(body.next),
      previous: readSessionCookie(req),
    },
  });
  return json({ must_change_secret: result.mustChangeSecret }, { headers: { "set-cookie": sessionCookie(result.cookieValue) } });
});

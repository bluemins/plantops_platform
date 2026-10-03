import { handle, json } from "@/server/http";
import { clearedSuperCookie, logoutSuperAdmin } from "@/server/super-auth";

export const POST = handle(async (req) => {
  await logoutSuperAdmin(req);
  return json({ ok: true }, { headers: { "set-cookie": clearedSuperCookie() } });
});

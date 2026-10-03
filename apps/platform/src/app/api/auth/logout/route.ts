import { clearedSessionCookie, logout } from "@/server/auth";
import { handle, json } from "@/server/http";

export const POST = handle(async (req) => {
  await logout(req);
  return json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } });
});

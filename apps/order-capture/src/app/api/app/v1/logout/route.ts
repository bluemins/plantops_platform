import { dropJson, dropRoute } from "@/server/drop/api";
import { logout } from "@/server/drop/session";

/** Drop: log out (the session ends on the server). */
export const POST = dropRoute(async (req) => {
  await logout(req);
  return dropJson({ ok: true });
});

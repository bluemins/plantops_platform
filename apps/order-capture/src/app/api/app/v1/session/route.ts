import { dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { appSession } from "@/server/drop/session";

/** Drop: who is logged in (shop name, phone, brands shown). */
export const GET = dropRoute(async (req) => {
  const s = await appSession(req);
  dropLimit(`drop-session:${s.sessionId}`, 60, 60_000);
  return dropJson({ shop: { name: s.name }, phone: s.phone, brands: s.brands });
});

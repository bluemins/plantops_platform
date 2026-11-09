import { dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { home } from "@/server/drop/home";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";

/** Drop: the shop's Home (current order, due per brand, box totals, support). No rates or bill amounts. */
export const GET = dropRoute(async (req) => {
  dropLimit(`drop-home-ip:${clientIp(req)}`, 120, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-home:${s.sessionId}`, 30, 60_000);
  return dropJson(await home(s));
});

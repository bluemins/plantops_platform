import { dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { appPoints } from "@/server/drop/points";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";

/** Drop: the shop's points (balance, free boxes, monthly record). Points only, never bills or amounts. */
export const GET = dropRoute(async (req) => {
  dropLimit(`drop-points-ip:${clientIp(req)}`, 120, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-points:${s.sessionId}`, 30, 60_000);
  return dropJson(await appPoints(s));
});

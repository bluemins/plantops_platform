import { dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { appPolls } from "@/server/drop/polls";
import { appSession } from "@/server/drop/session";
import { clientIp } from "@/server/http";

/** Drop: the open polls for this shop that it hasn't answered, and this week's poll points. Shops never see results. */
export const GET = dropRoute(async (req) => {
  dropLimit(`drop-polls-ip:${clientIp(req)}`, 120, 60_000);
  const s = await appSession(req);
  dropLimit(`drop-polls:${s.sessionId}`, 30, 60_000);
  return dropJson(await appPolls(s));
});

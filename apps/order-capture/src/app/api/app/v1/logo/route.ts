import { clientIp } from "@/server/http";
import { dropLimit, dropRoute } from "@/server/drop/api";
import { appLogo } from "@/server/drop/look";

/** Drop: the plant's logo image. */
export const GET = dropRoute(async (req) => {
  dropLimit(`drop-logo:${clientIp(req)}`, 60, 60_000);
  return appLogo(req);
});

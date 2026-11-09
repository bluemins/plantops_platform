import { clientIp } from "@/server/http";
import { dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { appLook } from "@/server/drop/look";

/** Drop: the plant's name, brand colour, logo and support contact (no login needed; public things only). */
export const GET = dropRoute(async (req) => {
  dropLimit(`drop-look:${clientIp(req)}`, 60, 60_000);
  return dropJson(await appLook(req));
});

import { clientIp } from "@/server/http";
import { appOf, dropBody, dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { verifyLogin, VerifyInput } from "@/server/drop/login";

/** Drop: check the code; the right one gives a 90-day session token (shown once). */
export const POST = dropRoute(async (req) => {
  dropLimit(`drop-verify:${clientIp(req)}`, 30, 60 * 60_000);
  const app = await appOf(req);
  return dropJson(await verifyLogin(app, await dropBody(req, VerifyInput)));
});

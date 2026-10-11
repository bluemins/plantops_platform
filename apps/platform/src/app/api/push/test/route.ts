import { z } from "zod";
import { requireUser } from "@/server/auth";
import { handle, json, rateLimit, readJson } from "@/server/http";
import { sendTestPush } from "@/server/notifications";

/** "Send a test to this phone": one push to the device asking (a few per minute at most). */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  rateLimit(`push-test:${user.userId}`, 5, 60_000);
  const { endpoint } = await readJson(req, z.object({ endpoint: z.string().max(1000) }));
  return json({ result: await sendTestPush(user, endpoint) });
});

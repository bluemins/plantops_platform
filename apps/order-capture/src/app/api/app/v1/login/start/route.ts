import { after } from "next/server";
import { clientIp } from "@/server/http";
import { appOf, dropBody, dropJson, dropLimit, dropRoute } from "@/server/drop/api";
import { startLogin, StartInput } from "@/server/drop/login";

/** Drop: ask for a login code on WhatsApp. Every number gets the same answer; the message goes out after it. */
export const POST = dropRoute(async (req) => {
  dropLimit(`drop-start:${clientIp(req)}`, 20, 60 * 60_000);
  const app = await appOf(req);
  const { answer, send } = await startLogin(app, await dropBody(req, StartInput));
  if (send) after(() => send().catch((err) => console.error("[order-capture] Drop login code:", (err as Error).message)));
  return dropJson(answer);
});

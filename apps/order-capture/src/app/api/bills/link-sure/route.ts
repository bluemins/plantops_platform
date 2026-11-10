import { SureInput, linkSure } from "@/server/bill-link";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: link the sure matches shown on Link bills to orders (each checked again). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await linkSure(user, await readJson(req, SureInput)));
});

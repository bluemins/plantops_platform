import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { MatchAction, matchAction } from "@/server/zoho-match";

/** Link a Zoho contact to a customer, unlink it, or add it as a new customer (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await matchAction(user, await readJson(req, MatchAction)));
});

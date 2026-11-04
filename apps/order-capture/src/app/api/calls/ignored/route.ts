import { IgnoredInput, setIgnored } from "@/server/calls-tab";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** The owner's "Not an order number" list: add a number (with a label) or remove it. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setIgnored(user, await readJson(req, IgnoredInput)));
});

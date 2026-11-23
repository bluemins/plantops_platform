import { handle, json, readJson } from "@/server/http";
import { addPromise, PromiseInput } from "@/server/promises";
import { requireApiUser } from "@/server/session";

/** Promise to pay (owner, Accounts): a follow-up note, never changes a bill or a payment. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addPromise(user, await readJson(req, PromiseInput)));
});

import { addCollection, CollectionInput } from "@/server/collections";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: a collection. Cash into the cash book now; each line waits in Sales until posted. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addCollection(user, await readJson(req, CollectionInput)), { status: 201 });
});

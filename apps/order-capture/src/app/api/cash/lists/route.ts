import { addListItem, ListInput } from "@/server/cash";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: add an expense category or a vehicle. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addListItem(user, await readJson(req, ListInput)), { status: 201 });
});

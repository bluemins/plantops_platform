import { removeVisit, RemoveInput } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** A wrong visit: removed with a reason, once (the person on the same day, the owner any day). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await removeVisit(user, await readJson(req, RemoveInput)), { status: 201 });
});

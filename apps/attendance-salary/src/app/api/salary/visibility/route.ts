import { handle, json, readJson } from "@/server/http";
import { saveVisibility, VisibilityInput } from "@/server/salary-edit";
import { requireApiUser } from "@/server/session";

/** Owner: "Can see own salary" on or off for a person (409 if someone changed it since the page loaded). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveVisibility(user, await readJson(req, VisibilityInput)));
});

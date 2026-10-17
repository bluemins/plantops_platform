import { handle, json, readJson } from "@/server/http";
import { saveSetting, SettingInput } from "@/server/salary-edit";
import { requireApiUser } from "@/server/session";

/** Owner: a new salary setting for a person from a month on (409 if someone saved one since the page loaded). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveSetting(user, await readJson(req, SettingInput)), { status: 201 });
});

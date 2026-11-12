import { MonthInput, monthPreview } from "@/server/jar-month";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: what the 20 L month update would do (nothing saved). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await monthPreview(user, await readJson(req, MonthInput)));
});

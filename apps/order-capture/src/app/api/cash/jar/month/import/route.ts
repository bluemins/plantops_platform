import { MonthInput, monthImport } from "@/server/jar-month";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: save the 20 L month update (month bills + a line per customer), all or nothing. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await monthImport(user, await readJson(req, MonthInput)), { status: 201 });
});

import { handle, json, readJson } from "@/server/http";
import { addDailyParameter, AddParameterInput } from "@/server/parameters";
import { requireApiUser } from "@/server/session";

/** A new daily check (owner / lab lead). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addDailyParameter(user, await readJson(req, AddParameterInput)), { status: 201 });
});

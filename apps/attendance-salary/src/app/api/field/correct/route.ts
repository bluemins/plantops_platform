import { correctStartEnd, CorrectInput } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** A wrong start / end km: a new reading with a reason (the person on the same day, the owner any day). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await correctStartEnd(user, await readJson(req, CorrectInput)), { status: 201 });
});

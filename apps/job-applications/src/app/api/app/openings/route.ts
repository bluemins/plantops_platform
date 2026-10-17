import { handle, json, readJson } from "@/server/http";
import { createOpening, OpeningInput } from "@/server/openings";
import { requireApiUser } from "@/server/session";

/** Add a position (owner only; checked in createOpening). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createOpening(user, await readJson(req, OpeningInput)), { status: 201 });
});

import { requireUser } from "@/server/auth";
import { boardSummary } from "@/server/board";
import { handle, json } from "@/server/http";

/** Numbers for the Plant board card on the launcher. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json(await boardSummary(user));
});

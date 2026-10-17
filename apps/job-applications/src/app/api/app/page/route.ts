import { handle, json, readJson } from "@/server/http";
import { MessageInput, setPageMessage } from "@/server/openings";
import { requireApiUser } from "@/server/session";

/** The text at the top of the public page (owner only; checked in setPageMessage). */
export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setPageMessage(user, (await readJson(req, MessageInput)).message));
});

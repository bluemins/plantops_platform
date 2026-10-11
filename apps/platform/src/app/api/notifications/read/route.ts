import { requireUser } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { markRead, MarkReadInput } from "@/server/notifications";

/** Marks some or all of the user's own notifications read. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  return json({ marked: await markRead(user, await readJson(req, MarkReadInput)) });
});

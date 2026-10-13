import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { confirmUpload, ConfirmInput } from "@/server/upload";

/** Save an upload exactly as previewed; 409 if the list changed since (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await confirmUpload(user, await readJson(req, ConfirmInput)));
});

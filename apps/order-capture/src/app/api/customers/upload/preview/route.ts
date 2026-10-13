import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { previewUpload, UploadInput } from "@/server/upload";

/** What an upload would do. Nothing is saved (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await previewUpload(user, await readJson(req, UploadInput)));
});

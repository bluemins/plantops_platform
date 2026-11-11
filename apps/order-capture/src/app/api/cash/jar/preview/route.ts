import { JarImportInput, jarPreview } from "@/server/collections";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: what the 20 L import would do (nothing saved). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await jarPreview(user, await readJson(req, JarImportInput)));
});

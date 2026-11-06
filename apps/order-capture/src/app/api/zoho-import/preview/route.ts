import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { previewZohoImport, ZohoImportInput } from "@/server/zoho-import";

/** What "Import from Zoho" would do. Nothing is saved (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await previewZohoImport(user, await readJson(req, ZohoImportInput)));
});

import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { confirmZohoImport, ZohoImportConfirm } from "@/server/zoho-import";

/** Save exactly what the preview showed (409 if anything changed since; refused if a due doesn't match Zoho). Owner only. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await confirmZohoImport(user, await readJson(req, ZohoImportConfirm)));
});

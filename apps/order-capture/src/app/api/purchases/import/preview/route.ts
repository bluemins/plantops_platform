import { handle, json, readJson } from "@/server/http";
import { previewPurchaseImport, PurchaseImportInput } from "@/server/purchases";
import { requireApiUser } from "@/server/session";

/** What "Import purchases from Zoho" would do. Nothing is saved (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await previewPurchaseImport(user, await readJson(req, PurchaseImportInput)));
});

import { handle, json, readJson } from "@/server/http";
import { confirmPurchaseImport, PurchaseImportConfirm } from "@/server/purchases";
import { requireApiUser } from "@/server/session";

/** Save the purchases import exactly as previewed (owner only; 409 when something changed since the preview). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await confirmPurchaseImport(user, await readJson(req, PurchaseImportConfirm)));
});

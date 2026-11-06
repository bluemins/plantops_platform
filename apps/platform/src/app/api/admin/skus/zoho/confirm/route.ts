import { requireTenantAdmin } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { confirmZohoItems, ZohoItemsConfirm } from "@/server/zoho-items";

/** Zoho Items import, step 2: save exactly what the preview showed (409 if anything changed since). Owner only. */
export const POST = handle(async (req) => {
  const admin = await requireTenantAdmin(req);
  return json(await confirmZohoItems(admin, await readJson(req, ZohoItemsConfirm)));
});

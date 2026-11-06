import { requireTenantAdmin } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { previewZohoItems, ZohoItemsInput } from "@/server/zoho-items";

/** Zoho Items import, step 1: what would change. Saves nothing. Owner only. */
export const POST = handle(async (req) => {
  const admin = await requireTenantAdmin(req);
  return json(await previewZohoItems(admin, await readJson(req, ZohoItemsInput)));
});

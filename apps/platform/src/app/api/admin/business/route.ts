import { requireTenantAdmin } from "@/server/auth";
import { BusinessInput, getBusiness, updateBusiness } from "@/server/business";
import { handle, json, readJson } from "@/server/http";

/** The owner's own business details. Plant code and usernames are not editable here (super_admin only). */
export const GET = handle(async (req) => json(await getBusiness(await requireTenantAdmin(req))));

export const PATCH = handle(async (req) => {
  const admin = await requireTenantAdmin(req);
  return json(await updateBusiness(admin, await readJson(req, BusinessInput)));
});

import { handle, json, readJson } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { CreateTenantInput, createTenant, listTenants } from "@/server/tenants";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return json(await listTenants());
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return json(await createTenant(admin, await readJson(req, CreateTenantInput)), { status: 201 });
});

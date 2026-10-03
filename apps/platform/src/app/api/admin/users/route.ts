import { requireTenantAdmin } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { createUser, listUsers, NewUserInput } from "@/server/users";

export const GET = handle(async (req) => json(await listUsers(await requireTenantAdmin(req))));

export const POST = handle(async (req) => {
  const admin = await requireTenantAdmin(req);
  return json(await createUser(admin, await readJson(req, NewUserInput)), { status: 201 });
});

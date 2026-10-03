import { requireTenantAdmin } from "@/server/auth";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { getUser, UpdateUserInput, updateUser } from "@/server/users";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  return json(await getUser(admin, uuidParam((await ctx.params).id)));
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await updateUser(admin, id, await readJson(req, UpdateUserInput)));
});

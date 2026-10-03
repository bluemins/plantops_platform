import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { SuperUpdateUserInput, superUpdateUser } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string; userId: string }> };

/** Edit any user of a plant: name, phone, email, roles, status, and (super_admin only) username. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const { id, userId } = await ctx.params;
  return json(await superUpdateUser(admin, uuidParam(id), uuidParam(userId), await readJson(req, SuperUpdateUserInput)));
});

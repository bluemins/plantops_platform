import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { superResetSecret } from "@/server/tenants";
import { ResetSecretInput } from "@/server/users";

type Ctx = { params: Promise<{ id: string; userId: string }> };

/** New temporary PIN/password for any user of the plant (owner or staff). */
export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const { id, userId } = await ctx.params;
  const { secret } = await readJson(req, ResetSecretInput);
  return json(await superResetSecret(admin, uuidParam(id), uuidParam(userId), secret));
});

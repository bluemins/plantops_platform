import { requireTenantAdmin } from "@/server/auth";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { ResetSecretInput, resetUserSecret } from "@/server/users";

type Ctx = { params: Promise<{ id: string }> };

/** New temporary PIN/password: typed by the owner, or random if `secret` is left out. */
export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  const id = uuidParam((await ctx.params).id);
  const { secret } = await readJson(req, ResetSecretInput);
  return json(await resetUserSecret(admin, id, secret));
});

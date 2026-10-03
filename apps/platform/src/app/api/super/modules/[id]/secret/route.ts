import { ModuleId } from "@plantops/types";
import { handle, json, notFound } from "@/server/http";
import { newModuleSecret } from "@/server/modules-admin";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string }> };

/** New client secret for a module, shown once; the old one stops working at once. */
export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = ModuleId.safeParse((await ctx.params).id);
  if (!id.success) throw notFound();
  return json(await newModuleSecret(admin, id.data));
});

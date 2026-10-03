import { ModuleId } from "@plantops/types";
import { handle, json, notFound, readJson } from "@/server/http";
import { UpdateModuleInput, updateModule } from "@/server/modules-admin";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string }> };

/** Change a module's URL, or switch it off/on for all plants. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = ModuleId.safeParse((await ctx.params).id);
  if (!id.success) throw notFound();
  return json(await updateModule(admin, id.data, await readJson(req, UpdateModuleInput)));
});

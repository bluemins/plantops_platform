import { setArchived, ArchiveInput } from "@/server/documents";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Archive (no reminders, hidden) or restore. Nothing is deleted (owner / document keeper). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setArchived(user, uuidParam((await ctx.params).id), await readJson(req, ArchiveInput)));
});

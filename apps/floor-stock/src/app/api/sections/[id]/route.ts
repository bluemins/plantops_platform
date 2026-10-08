import { SectionPatch, updateSection } from "@/server/setup";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Rename or switch a section off / on (owner only). Sections are never deleted. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateSection(user, uuidParam((await ctx.params).id), await readJson(req, SectionPatch)));
});

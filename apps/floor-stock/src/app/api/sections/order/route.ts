import { reorderSections, SectionOrder } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** New order of all sections (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await reorderSections(user, await readJson(req, SectionOrder)));
});

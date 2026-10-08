import { createSection, SectionInput } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Add a section (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createSection(user, await readJson(req, SectionInput)), { status: 201 });
});

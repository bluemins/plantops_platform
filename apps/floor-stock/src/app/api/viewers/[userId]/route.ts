import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { setViewerSections, ViewerSectionsInput } from "@/server/viewers";

type Ctx = { params: Promise<{ userId: string }> };

/** Owner only: the sections one Stock viewer sees (the whole list; sections left out are switched off). */
export const PUT = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setViewerSections(user, uuidParam((await ctx.params).userId), await readJson(req, ViewerSectionsInput)));
});

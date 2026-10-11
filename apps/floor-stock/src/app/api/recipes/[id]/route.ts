import { RecipeInput, setRecipe } from "@/server/recipes";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: what 1 bottle of a finished product needs (the id is the finished goods item). An empty list switches it off. */
export const PUT = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setRecipe(user, uuidParam((await ctx.params).id), await readJson(req, RecipeInput)));
});

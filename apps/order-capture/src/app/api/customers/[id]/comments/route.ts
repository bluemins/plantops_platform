import { addComment, CommentInput } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A comment on a customer (owner); never changed. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await addComment(user, uuidParam((await ctx.params).id), await readJson(req, CommentInput)));
});

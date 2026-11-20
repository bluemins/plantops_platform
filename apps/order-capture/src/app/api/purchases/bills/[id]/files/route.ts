import { handleUpload, json, uuidParam } from "@/server/http";
import { addPurchaseBillCopy, MAX_COPY_BYTES } from "@/server/purchase-files";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: one bill copy (PDF, or a photo already shrunk on the phone) as the raw body; ?name= the file name. */
export const POST = handleUpload(MAX_COPY_BYTES, async (req, body, ctx: Ctx) => {
  const user = await requireApiUser();
  const name = new URL(req.url).searchParams.get("name");
  return json(await addPurchaseBillCopy(user, uuidParam((await ctx.params).id), body, name), { status: 201 });
});

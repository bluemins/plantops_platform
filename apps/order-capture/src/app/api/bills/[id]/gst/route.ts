import { handle, json, readJson, uuidParam } from "@/server/http";
import { GstInput, setGstInvoice } from "@/server/ledger";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** The Zoho GST invoice no. made for this bill (owner, Order desk; blank removes it). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setGstInvoice(user, uuidParam((await ctx.params).id), await readJson(req, GstInput)));
});
